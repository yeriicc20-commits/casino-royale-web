/**
 * Cuántos bots tiene que haber conectados ahora.
 *
 * Tres niveles, para que el número nunca sea predecible:
 *
 *   franja  según la hora (y el día): p. ej. de 16 a 19 h, entre 26 y 50
 *   meta    un número al azar dentro de la franja, que cambia cada 8-25 min
 *   target  camina hacia la meta de 1 en 1 (a veces de 2 o 3) cada 25-110 s,
 *           con algún paso de ruido aunque ya haya llegado
 *
 * Y entrar o salir es de uno en uno, con huecos al azar entre uno y otro: nunca
 * se conectan ni se desconectan treinta de golpe. Lo único que va sin espera es
 * llegar al mínimo, que es un compromiso con BOTS_MIN_ONLINE.
 */
import { activeInstance, nextInstance, spainParts } from '../events/schedule';
import type { EventsConfig } from '../events/types';
import type { Band, BotsConfig } from './config';
import { chance, clamp, randInt, uniform, type Rng } from './random';
import type { Runtime } from './types';

/**
 * Qué evento afecta a la población: ninguno, el diario o el semanal (sábado),
 * y si está a punto de empezar (la gente llega un rato antes).
 */
export type EventPhase = { slot: 'daily' | 'weekly'; soon: boolean } | null;

/** Evento abierto ahora o que abre en menos de 20 minutos. */
export function eventPhaseAt(cfg: EventsConfig, nowMs: number): EventPhase {
  const open = activeInstance(cfg, nowMs);
  if (open) return { slot: open.slot, soon: false };
  for (const slot of ['weekly', 'daily'] as const) {
    const next = nextInstance(cfg, slot, nowMs);
    if (next && next.opensMs > nowMs && next.opensMs - nowMs <= 20 * 60_000) return { slot, soon: true };
  }
  return null;
}

/** La franja que toca a una hora. Las de un día concreto mandan sobre las generales. */
export function bandFor(cfg: BotsConfig, nowMs: number, event: EventPhase | boolean): { min: number; max: number } {
  const p = spainParts(nowMs, cfg.timeZone);
  const hour = p.hour + p.minute / 60;
  const fits = (b: Band) => hour >= b.from && hour < b.to;
  const specific = cfg.schedule.find((b) => b.days && b.days.includes(p.weekday) && fits(b));
  const general = cfg.schedule.find((b) => !b.days && fits(b));
  const band = specific ?? general ?? { min: cfg.minOnline, max: Math.max(cfg.minOnline, Math.round(cfg.maxOnline / 3)) };
  let min = band.min;
  let max = band.max;
  // Con evento hay más gente, lógicamente: el semanal más que el diario, y un
  // poco antes de abrir ya va llegando (la subida es gradual igualmente).
  const ev: EventPhase = event === true ? { slot: 'daily', soon: false } : event === false ? null : event;
  if (ev) {
    const weekly = ev.slot === 'weekly';
    const lift = ev.soon ? (weekly ? 1.15 : 1.08) : weekly ? 1.5 : 1.3;
    max = Math.min(cfg.maxOnline, Math.round(max * lift) + (ev.soon ? 2 : weekly ? 8 : 5));
    min = Math.max(min, Math.round(max * (ev.soon ? 0.55 : weekly ? 0.8 : 0.7)));
  }
  min = clamp(min, cfg.minOnline, cfg.maxOnline);
  max = clamp(max, min, cfg.maxOnline);
  return { min, max };
}

/** Mueve la meta y el objetivo. Devuelve el objetivo nuevo. */
export function stepPopulation(rt: Runtime, cfg: BotsConfig, nowMs: number, rng: Rng, event: EventPhase | boolean): number {
  const band = bandFor(cfg, nowMs, event);

  if (!rt.target) {
    // Recién encendido (o primera vez): empieza abajo y sube poco a poco.
    rt.target = clamp(cfg.minOnline + randInt(rng, 0, 2), cfg.minOnline, cfg.maxOnline);
    rt.nextStepAt = nowMs + randInt(rng, 20, 60) * 1000;
  }
  if (!rt.goal || nowMs >= rt.goalUntil || rt.goal < band.min || rt.goal > band.max) {
    rt.goal = randInt(rng, band.min, band.max);
    rt.goalUntil = nowMs + Math.round(uniform(rng, 8, 25) * 60_000);
  }
  if (nowMs >= rt.nextStepAt) {
    const diff = rt.goal - rt.target;
    if (diff !== 0) {
      const size = Math.min(Math.abs(diff), chance(rng, 0.7) ? 1 : randInt(rng, 2, 3));
      rt.target += Math.sign(diff) * size;
    } else if (chance(rng, 0.25)) {
      rt.target += chance(rng, 0.5) ? 1 : -1;
    }
    // Sin recortar a la franja: al cambiar de hora la meta cambia y el objetivo
    // CAMINA hacia ella; recortarlo aquí haría saltar quince bots de golpe.
    rt.nextStepAt = nowMs + Math.round(uniform(rng, 25, 110) * 1000);
  }
  rt.target = clamp(rt.target, cfg.minOnline, cfg.maxOnline);
  return rt.target;
}

/** Cuántos bots conectar AHORA (normalmente 0 o 1). */
export function joinsNow(rt: Runtime, cfg: BotsConfig, online: number, nowMs: number, rng: Rng): number {
  if (online >= cfg.maxOnline) return 0;
  // Por debajo del mínimo no se espera: el mínimo es un compromiso.
  if (online < cfg.minOnline) return cfg.minOnline - online;
  if (online >= rt.target || nowMs < rt.nextJoinAt) return 0;
  rt.nextJoinAt = nowMs + Math.round(uniform(rng, 2.2, 14) * 1000);
  return 1;
}

/** Cuántos bots mandar a casa AHORA porque sobran (0 o 1). Las sesiones que acaban solas van aparte. */
export function leavesNow(rt: Runtime, cfg: BotsConfig, online: number, nowMs: number, rng: Rng): number {
  if (online <= cfg.minOnline) return 0;
  if (online > cfg.maxOnline) return online - cfg.maxOnline;
  if (online <= rt.target + 1 || nowMs < rt.nextLeaveAt) return 0;
  rt.nextLeaveAt = nowMs + Math.round(uniform(rng, 4, 22) * 1000);
  return 1;
}
