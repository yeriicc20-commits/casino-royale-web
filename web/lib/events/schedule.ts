/**
 * Los horarios de los eventos, en el servidor.
 *
 * Son LOS MISMOS que ya tiene el juego (EventSchedule.cs): diario de 17:00 a
 * 18:00 y semanal los sábados de 11:00 a 14:00, en hora de España. No es un
 * calendario nuevo: el servidor necesita saberlo para decidir por su cuenta qué
 * evento hay ahora, cuándo empieza y cuándo termina, sin fiarse de la hora del
 * móvil. Si algún día cambian, se cambian en los dos sitios (config.json aquí).
 */
import type { EventsConfig } from './types';

export interface SpainParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 domingo ... 6 sábado
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** La fecha y hora de España de un instante. */
export function spainParts(utcMs: number, timeZone = 'Europe/Madrid'): SpainParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** El instante UTC de una hora de España (fecha + "HH:MM"). */
export function spainToUtc(year: number, month: number, day: number, hhmm: string, timeZone = 'Europe/Madrid'): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  // Primero como si fuera UTC, después se corrige con el desfase real de ese momento.
  let guess = Date.UTC(year, month - 1, day, h, m, 0);
  for (let i = 0; i < 2; i++) {
    const p = spainParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = asUtc - guess;
    guess = Date.UTC(year, month - 1, day, h, m, 0) - offset;
  }
  return guess;
}

export type Slot = 'daily' | 'weekly';

export interface Instance {
  /** "d-2026-10-05" o "w-2026-10-03". Único y estable: es la llave de todo. */
  id: string;
  slot: Slot;
  eventId: string;
  opensMs: number;
  closesMs: number;
  /** Fecha de España del evento, "2026-10-05". */
  date: string;
}

function pad(n: number) {
  return n < 10 ? '0' + n : String(n);
}

function dateKey(y: number, m: number, d: number) {
  return y + '-' + pad(m) + '-' + pad(d);
}

/** Suma días a una fecha de calendario (sin horas: no le afecta el cambio de hora). */
function addDays(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

export function dailyEventFor(cfg: EventsConfig, weekday: number): string {
  return cfg.dailyByWeekday[String(weekday)] ?? 'racha_mortal';
}

/** El evento de un hueco en una fecha de España dada. Null si ese día no hay (semanal fuera de sábado). */
export function instanceOn(cfg: EventsConfig, slot: Slot, y: number, m: number, d: number): Instance | null {
  const tz = cfg.schedule.timeZone;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (slot === 'weekly' && weekday !== cfg.schedule.weekly.weekday) return null;
  const times = slot === 'daily' ? cfg.schedule.daily : cfg.schedule.weekly;
  return {
    id: (slot === 'daily' ? 'd-' : 'w-') + dateKey(y, m, d),
    slot,
    eventId: slot === 'daily' ? dailyEventFor(cfg, weekday) : cfg.weeklyEvent,
    opensMs: spainToUtc(y, m, d, times.opens, tz),
    closesMs: spainToUtc(y, m, d, times.closes, tz),
    date: dateKey(y, m, d),
  };
}

/** Un evento a partir de su id ("d-2026-10-05"). Null si el id no es válido. */
export function instanceById(cfg: EventsConfig, id: string): Instance | null {
  const m = /^([dw])-(\d{4})-(\d{2})-(\d{2})$/.exec(id || '');
  if (!m) return null;
  return instanceOn(cfg, m[1] === 'd' ? 'daily' : 'weekly', Number(m[2]), Number(m[3]), Number(m[4]));
}

/** El evento abierto ahora mismo (como mucho uno: los dos horarios no se pisan). */
export function activeInstance(cfg: EventsConfig, nowMs: number): Instance | null {
  const p = spainParts(nowMs, cfg.schedule.timeZone);
  for (const slot of ['weekly', 'daily'] as Slot[]) {
    const inst = instanceOn(cfg, slot, p.year, p.month, p.day);
    if (inst && nowMs >= inst.opensMs && nowMs < inst.closesMs) return inst;
  }
  return null;
}

/** El siguiente evento de un hueco que todavía no ha terminado (puede ser el abierto). */
export function nextInstance(cfg: EventsConfig, slot: Slot, nowMs: number): Instance | null {
  const p = spainParts(nowMs, cfg.schedule.timeZone);
  for (let i = 0; i < 8; i++) {
    const day = addDays(p.year, p.month, p.day, i);
    const inst = instanceOn(cfg, slot, day.y, day.m, day.d);
    if (inst && inst.closesMs > nowMs) return inst;
  }
  return null;
}

/** El evento de un hueco del día anterior a una fecha (para el viernes antes del sábado). */
export function previousDayInstance(cfg: EventsConfig, inst: Instance): Instance | null {
  const [y, m, d] = inst.date.split('-').map((x) => Number(x));
  const prev = addDays(y, m, d, -1);
  return instanceOn(cfg, 'daily', prev.y, prev.m, prev.d);
}

/** ¿Acepta todavía resultados? (cerrado + un margen para lo que iba por el aire). */
export function acceptsReports(cfg: EventsConfig, inst: Instance, nowMs: number): boolean {
  return nowMs >= inst.opensMs && nowMs <= inst.closesMs + cfg.schedule.submitGraceSeconds * 1000;
}

/** ¿Se pueden recoger ya los premios del ranking? */
export function rewardsReady(cfg: EventsConfig, inst: Instance, nowMs: number): boolean {
  return nowMs >= inst.closesMs + cfg.schedule.claimAfterSeconds * 1000;
}
