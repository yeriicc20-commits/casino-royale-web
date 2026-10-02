/**
 * El motor de los eventos: las reglas de TODOS los eventos en un solo sitio.
 *
 * Cada evento no tiene su propio código. Tiene una configuración (config.json)
 * que enciende o apaga piezas comunes: puntos por victoria, rachas, hitos,
 * jackpots, modificadores, fases, mesas especiales, desafíos, riesgo, cofre...
 * Un evento nuevo es una entrada más en config.json, no un fichero más aquí.
 *
 * Todo se calcula EN EL SERVIDOR a partir de las rondas que manda el juego: el
 * juego nunca dice "tengo 5.000 puntos", dice "he jugado esta ronda" y aquí se
 * decide lo que vale. Los sorteos (jackpots, arriesgar) se hacen aquí con el
 * generador criptográfico, así que el móvil no puede elegir el resultado.
 *
 * Sin dependencias de base de datos: son funciones puras, y por eso se pueden
 * probar enteras (tests/eventos.test.ts).
 */
import { createHmac } from 'node:crypto';
import type {
  CoinAward, EventDef, EventsConfig, Feedback, Modifier, Objective, Phase, PlayerState, RoundIn,
} from './types';
import type { Instance } from './schedule';

export type Rng = () => number;

// ---------------------------------------------------------------------------- estado

export function newState(def: EventDef): PlayerState {
  return {
    v: 1,
    points: 0,
    banked: 0,
    potBase: 0,
    potExtra: 0,
    riskStep: 0,
    shields: def.risk?.startShields ?? 0,
    streak: 0,
    bestStreak: 0,
    wins: 0,
    losses: 0,
    rounds: 0,
    jackpots: [0, 0, 0],
    bestJackpot: -1,
    bestMultiplier: 0,
    games: [],
    featuredWins: 0,
    done: [],
    chestClaimed: false,
    unlocked: [],
    perks: { streakShields: 0, vip: false, from: [] },
    ph: emptyPhase(''),
    rate: { minute: 0, n: 0 },
    ignored: 0,
    reports: [],
  };
}

function emptyPhase(id: string) {
  return { id, wins: 0, rounds: 0, streak: 0, bestStreak: 0, jackpots: 0, featuredWins: 0, bestMultiplier: 0 };
}

/** Completa un estado guardado con una versión anterior (campos nuevos a su valor por defecto). */
export function loadState(def: EventDef, raw: unknown): PlayerState {
  const base = newState(def);
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...(raw as Partial<PlayerState>) };
  s.jackpots = Array.isArray(s.jackpots) ? [0, 1, 2].map((i) => Number(s.jackpots[i] || 0)) : [0, 0, 0];
  s.games = Array.isArray(s.games) ? s.games.map(String) : [];
  s.done = Array.isArray(s.done) ? s.done.map(String) : [];
  s.unlocked = Array.isArray(s.unlocked) ? s.unlocked.map(String) : [];
  s.perks = { ...base.perks, ...(s.perks || {}) };
  s.perks.from = Array.isArray(s.perks.from) ? s.perks.from : [];
  s.ph = { ...emptyPhase(''), ...(s.ph || {}) };
  s.rate = { ...base.rate, ...(s.rate || {}) };
  s.reports = Array.isArray(s.reports) ? s.reports.map(String).slice(-64) : [];
  return s;
}

export const isRisk = (def: EventDef) => def.kind === 'risk' && !!def.risk;

/** El multiplicador del bote en el paso de riesgo actual (1 sin arriesgar). */
export function riskMultiplier(def: EventDef, step: number): number {
  if (!def.risk || step <= 0) return 1;
  return def.risk.steps[Math.min(step, def.risk.steps.length) - 1].multiplier;
}

/** Los puntos EN RIESGO de Todo o Nada. */
export function pot(def: EventDef, st: PlayerState): number {
  return Math.floor(st.potBase * riskMultiplier(def, st.riskStep) + st.potExtra);
}

/** Lo que cuenta para el ranking mientras dura el evento. */
export function liveScore(def: EventDef, st: PlayerState): number {
  return isRisk(def) ? st.banked : st.points;
}

/** Lo que cuenta cuando el evento ya ha terminado (en Todo o Nada, el bote se cobra solo). */
export function finalScore(def: EventDef, st: PlayerState): number {
  if (!isRisk(def)) return st.points;
  return st.banked + (def.risk!.autoCashAtEnd ? pot(def, st) : 0);
}

// ---------------------------------------------------------------------------- momento del evento

export interface Context {
  minute: number;
  phase: Phase | null;
  phaseIndex: number;
  modifier: Modifier | null;
  modifierEndsMs: number;
  surprise: { startMs: number; endMs: number } | null;
  pointsMult: number;
  streakMult: number;
  jackpotScale: number;
  flat: number;
  coinScale: number;
  featured: string[];
  featuredMult: number;
  featuredEndsMs: number;
}

function hashInt(secret: string, key: string): number {
  const h = createHmac('sha256', secret).update(key).digest();
  return h.readUInt32BE(0);
}

/**
 * Cuándo estalla el CAOS TOTAL en este evento. Sale del id del evento firmado con
 * una clave del servidor: es igual para todos los jugadores y el móvil no puede
 * saberlo antes de tiempo (el servidor solo lo cuenta cuando ya ha empezado).
 */
export function surpriseWindows(def: EventDef, inst: Instance, secret: string): { startMs: number; endMs: number }[] {
  const s = def.surprise;
  if (!s || s.count <= 0) return [];
  const durMin = s.durationSeconds / 60;
  const span = Math.max(1, s.latestMinute - s.earliestMinute - durMin);
  const starts: number[] = [];
  for (let i = 0; i < s.count; i++) starts.push(s.earliestMinute + (hashInt(secret, inst.id + ':surprise:' + i) % Math.floor(span * 10)) / 10);
  starts.sort((a, b) => a - b);
  // Que no se pisen: uno detrás de otro con al menos 3 minutos de respiro.
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1] + durMin + 3) starts[i] = starts[i - 1] + durMin + 3;
  }
  return starts.map((m) => ({ startMs: inst.opensMs + m * 60000, endMs: inst.opensMs + m * 60000 + s.durationSeconds * 1000 }));
}

/** Las mesas especiales de un tramo, iguales para todos. */
export function featuredMachines(cfg: EventsConfig, inst: Instance, slot: number, count: number, secret: string): string[] {
  const pool = [...cfg.machines];
  const out: string[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = hashInt(secret, inst.id + ':table:' + slot + ':' + i) % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Lo que está pasando en el evento en un instante: fase, modificador, sorpresa, mesas. */
export function contextAt(cfg: EventsConfig, def: EventDef, inst: Instance, tMs: number, secret: string): Context {
  const minute = Math.max(0, (Math.min(tMs, inst.closesMs - 1) - inst.opensMs) / 60000);
  const ctx: Context = {
    minute,
    phase: null,
    phaseIndex: -1,
    modifier: null,
    modifierEndsMs: 0,
    surprise: null,
    pointsMult: def.pointsMultiplier ?? 1,
    streakMult: 1,
    jackpotScale: def.jackpotScale || 0,
    flat: 0,
    coinScale: 1,
    featured: [],
    featuredMult: 1,
    featuredEndsMs: 0,
  };

  if (def.phases && def.phases.length) {
    let idx = def.phases.findIndex((p) => minute >= p.fromMinute && minute < p.toMinute);
    if (idx < 0) idx = minute < def.phases[0].fromMinute ? 0 : def.phases.length - 1;
    ctx.phase = def.phases[idx];
    ctx.phaseIndex = idx;
    ctx.pointsMult *= ctx.phase.pointsMultiplier;
    ctx.jackpotScale *= ctx.phase.jackpotScale;
  }

  let tableBoost = 0;
  if (def.modifiers && def.modifiers.length) {
    const m = def.modifiers.find((x) => minute >= x.fromMinute && minute < x.toMinute) ?? null;
    ctx.modifier = m;
    if (m) {
      ctx.modifierEndsMs = inst.opensMs + m.toMinute * 60000;
      switch (m.type) {
        case 'points': ctx.pointsMult *= m.value; break;
        case 'streak': ctx.streakMult *= m.value; break;
        case 'jackpot': ctx.jackpotScale *= m.value; break;
        case 'flat': ctx.flat += m.value; break;
        case 'coins': ctx.coinScale *= m.value; break;
        case 'table': tableBoost = m.value; break;
      }
    }
  }

  const f = def.featured;
  if (f && f.count > 0 && f.everyMinutes > 0) {
    const allowed = (!f.onlyWithModifier || ctx.modifier?.id === f.onlyWithModifier) && (!ctx.phase || ctx.phase.featured);
    if (allowed) {
      const slot = Math.floor(minute / f.everyMinutes);
      ctx.featured = featuredMachines(cfg, inst, slot, f.count, secret);
      ctx.featuredMult = tableBoost || f.pointsMultiplier;
      ctx.featuredEndsMs = Math.min(inst.closesMs, inst.opensMs + (slot + 1) * f.everyMinutes * 60000);
      if (ctx.modifierEndsMs) ctx.featuredEndsMs = Math.min(ctx.featuredEndsMs, ctx.modifierEndsMs);
    }
  }

  if (def.surprise && (!ctx.phase || ctx.phase.surprise)) {
    const w = surpriseWindows(def, inst, secret).find((x) => tMs >= x.startMs && tMs < x.endMs) ?? null;
    if (w) {
      ctx.surprise = w;
      ctx.pointsMult *= def.surprise.pointsMultiplier;
      ctx.jackpotScale *= def.surprise.jackpotScale;
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------- rondas

const GOLD = '#F5C451';
const GREEN = '#35D295';
const RED = '#FF5A6E';
const PURPLE = '#B57CFF';
const BLUE = '#5CA4FF';

function fb(type: string, title: string, detail: string, extra: Partial<Feedback> = {}): Feedback {
  return { type, title, detail, tier: 0, points: 0, color: GOLD, sound: '', fx: '', ...extra };
}

export function fmtPoints(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fmtEuros(cents: number): string {
  const euros = cents / 100;
  const whole = Number.isInteger(euros);
  const s = whole ? fmtPoints(euros) : euros.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return s + ' €';
}

function addPoints(def: EventDef, st: PlayerState, pts: number) {
  pts = Math.max(0, Math.round(pts));
  if (!pts) return;
  st.points += pts;
  if (isRisk(def)) {
    if (st.riskStep === 0) st.potBase += pts;
    else st.potExtra += pts;
  }
}

export interface ApplyResult {
  feedback: Feedback[];
  awards: CoinAward[];
  counted: number;
  ignored: number;
  lowStake: number;
}

/** Valor de un desafío para pintarlo ("3/5"). */
export function objectiveProgress(o: Objective, st: PlayerState): number {
  const phaseOnly = !!o.phase;
  if (phaseOnly && st.ph.id !== o.phase) return st.done.includes(o.id) ? o.target : 0;
  const src = phaseOnly ? st.ph : null;
  let v = 0;
  switch (o.type) {
    case 'wins': v = src ? src.wins : st.wins; break;
    case 'rounds': v = src ? src.rounds : st.rounds; break;
    case 'streak': v = src ? src.bestStreak : st.bestStreak; break;
    case 'jackpot': v = src ? src.jackpots : st.jackpots.reduce((a, b) => a + b, 0); break;
    case 'games': v = st.games.length; break;
    case 'multiplier': v = Math.floor(src ? src.bestMultiplier : st.bestMultiplier); break;
    case 'featuredWins': v = src ? src.featuredWins : st.featuredWins; break;
    case 'points': v = st.points; break;
  }
  if (st.done.includes(o.id)) return o.target;
  return Math.min(o.target, Math.max(0, v));
}

function checkObjectives(def: EventDef, st: PlayerState, out: ApplyResult) {
  if (!def.objectives) return;
  let completedNow = 0;
  for (const o of def.objectives) {
    if (st.done.includes(o.id)) continue;
    if (o.phase && st.ph.id !== o.phase) continue;
    if (objectiveProgress(o, st) >= o.target) {
      st.done.push(o.id);
      addPoints(def, st, o.points);
      completedNow++;
      out.feedback.push(fb('objective', def.kind === 'treasure' ? '¡PISTA ENCONTRADA!' : '¡DESAFÍO COMPLETADO!',
        o.label + ' · +' + fmtPoints(o.points), { points: o.points, color: GREEN, sound: 'achievement.unlocked', fx: 'pulse' }));
    }
  }
  if (completedNow && def.chest && !st.chestClaimed && def.objectives.every((o) => st.done.includes(o.id))) {
    out.feedback.push(fb('chest_ready', '¡COFRE DEL TESORO!', 'Has completado el mapa. ¡Ábrelo!', { tier: 2, color: GOLD, sound: 'slot.win_mega', fx: 'rays' }));
  }
}

function checkUnlocks(def: EventDef, inst: Instance, st: PlayerState, out: ApplyResult) {
  if (!def.unlocks) return;
  for (const u of def.unlocks) {
    if (u.minPoints == null || st.unlocked.includes(u.id) || st.points < u.minPoints) continue;
    st.unlocked.push(u.id);
    out.awards.push({ claimId: inst.id + ':unlock:' + u.id, cents: 0, reason: u.label, cosmetics: u.cosmetics, perk: u.perk });
    out.feedback.push(fb('unlock', '¡' + u.label.toUpperCase() + '!', u.detail, { tier: 2, color: PURPLE, sound: 'level.up', fx: 'rays' }));
  }
}

/**
 * Aplica un lote de rondas. Cada ronda se comprueba antes de contar: máquina que
 * existe, apuesta mínima, un multiplicador posible, hecha dentro del horario del
 * evento y no en el futuro, y sin pasarse de rondas por minuto. Lo que no pasa
 * se ignora (y se cuenta, para poder investigarlo).
 */
export function applyRounds(
  cfg: EventsConfig, def: EventDef, inst: Instance, st: PlayerState,
  rounds: RoundIn[], nowMs: number, rng: Rng, secret: string, reportId: string,
): ApplyResult {
  const out: ApplyResult = { feedback: [], awards: [], counted: 0, ignored: 0, lowStake: 0 };
  const L = cfg.limits;
  const minStake = Math.max(L.minStakeCents, def.minStakeCents ?? 0);
  const sc = def.scoring;

  for (let i = 0; i < rounds.length && i < L.maxRoundsPerReport; i++) {
    const rd = rounds[i];
    const g = String(rd?.g ?? '');
    const s = Math.floor(Number(rd?.s));
    const r = Math.floor(Number(rd?.r));
    const t = Math.floor(Number(rd?.t));

    const valid = cfg.machines.includes(g) && Number.isFinite(s) && Number.isFinite(r) && Number.isFinite(t)
      && s > 0 && r >= 0 && r <= s * L.maxMultiplier
      && t >= inst.opensMs && t < inst.closesMs + 5000
      && t <= nowMs + 5000 && t >= nowMs - L.maxQueuedSeconds * 1000;
    if (!valid) { out.ignored++; st.ignored++; continue; }
    if (s < minStake) { out.lowStake++; continue; }

    const minute = Math.floor(nowMs / 60000);
    if (st.rate.minute !== minute) st.rate = { minute, n: 0 };
    if (st.rate.n >= L.maxRoundsPerMinute) { out.ignored++; st.ignored++; continue; }
    st.rate.n++;

    // El momento que decide fase y modificador no puede ir muy atrás: si no, se
    // podría guardar una ronda y mandarla "fechada" dentro de un CAOS TOTAL.
    const tEff = Math.min(Math.max(t, nowMs - L.modifierLookbackSeconds * 1000), nowMs);
    const ctx = contextAt(cfg, def, inst, tEff, secret);

    if (ctx.phase && st.ph.id !== ctx.phase.id) st.ph = emptyPhase(ctx.phase.id);
    if (!ctx.phase && st.ph.id !== '') st.ph = emptyPhase('');

    out.counted++;
    st.rounds++;
    st.ph.rounds++;
    if (!st.games.includes(g)) st.games.push(g);

    const mult = r / s;
    const featured = ctx.featured.includes(g);
    let pts = 0;

    if (mult >= sc.minWinMultiplier) {
      st.wins++;
      st.ph.wins++;
      st.streak++;
      st.ph.streak++;
      const before = st.bestStreak;
      if (st.streak > st.bestStreak) st.bestStreak = st.streak;
      if (st.ph.streak > st.ph.bestStreak) st.ph.bestStreak = st.ph.streak;
      if (mult > st.bestMultiplier) st.bestMultiplier = mult;
      if (mult > st.ph.bestMultiplier) st.ph.bestMultiplier = mult;
      if (featured) { st.featuredWins++; st.ph.featuredWins++; }

      pts = sc.winPoints + ctx.flat;
      if (st.streak > 1 && sc.streakStepPoints > 0) pts += sc.streakStepPoints * (st.streak - 1) * ctx.streakMult;
      if (mult >= sc.bigMultiplier && sc.bigMultiplierPoints > 0) {
        pts += sc.bigMultiplierPoints;
        out.feedback.push(fb('bigwin', '¡GRAN MULTIPLICADOR!', 'x' + mult.toFixed(mult >= 100 ? 0 : 1).replace('.', ',') + ' · +' + fmtPoints(sc.bigMultiplierPoints),
          { tier: 1, color: BLUE, sound: 'slot.win_big', fx: 'pulse' }));
      }

      const ms = sc.milestones.find((m) => m.streak === st.streak);
      if (ms) {
        const bonus = ms.points * ctx.streakMult;
        pts += bonus;
        out.feedback.push(fb('milestone', '¡' + ms.label + '!', 'Racha de ' + st.streak + ' · +' + fmtPoints(bonus),
          { tier: Math.min(2, sc.milestones.indexOf(ms)), points: bonus, color: '#FF7A45', sound: 'slot.win_mega', fx: 'rays' }));
      } else if (st.streak >= 2 && def.kind === 'streak') {
        out.feedback.push(fb('streak', '¡RACHA DE ' + st.streak + '!', '+' + fmtPoints(pts), { color: '#FF7A45', sound: 'slot.win_small', fx: 'pop' }));
      }

      if (sc.streakMultiplierFrom && sc.streakMultiplier && st.streak >= sc.streakMultiplierFrom) {
        pts *= sc.streakMultiplier;
        if (st.streak === sc.streakMultiplierFrom) {
          out.feedback.push(fb('streak_mult', '¡MULTIPLICADOR x' + sc.streakMultiplier + '!', 'Racha de ' + st.streak + ': todo vale x' + sc.streakMultiplier,
            { tier: 2, color: RED, sound: 'slot.jackpot', fx: 'shake' }));
        }
      }

      if (st.bestStreak > before && st.bestStreak >= 3 && def.kind === 'streak') {
        out.feedback.push(fb('record', '¡NUEVO RÉCORD!', 'Tu mejor racha: ' + st.bestStreak, { tier: 1, color: GOLD, sound: 'achievement.unlocked', fx: 'pop' }));
      }

      if (featured) pts *= ctx.featuredMult;

      if (isRisk(def) && def.risk!.shieldEveryStreak > 0 && st.streak % def.risk!.shieldEveryStreak === 0 && st.shields < def.risk!.maxShields) {
        st.shields++;
        out.feedback.push(fb('shield_gain', '+1 PROTECCIÓN', 'Racha de ' + st.streak + ': te salvará una vez', { color: BLUE, sound: 'reward.claim', fx: 'pop' }));
      }
    } else if (r < s) {
      st.losses++;
      pts = sc.lossPoints;
      if (st.streak > 0 && sc.breakOnLoss) {
        if (st.perks.streakShields > 0) {
          st.perks.streakShields--;
          out.feedback.push(fb('shield_used', '¡COMODÍN!', 'Tu racha de ' + st.streak + ' se salva', { color: PURPLE, sound: 'reward.claim', fx: 'pop' }));
        } else {
          if (st.streak >= 3) out.feedback.push(fb('streak_lost', 'RACHA PERDIDA', 'Llevabas ' + st.streak + ' seguidas', { color: RED, sound: 'ui.error' }));
          st.streak = 0;
        }
      }
      st.ph.streak = 0;
    }
    // Entre x1 y el mínimo: ni gana ni pierde. Así una apuesta segurísima (dados al
    // 98 %, retirar en Crash a x1,01) no sirve para inflar una racha.

    pts *= ctx.pointsMult;

    // Jackpot: se sortea aquí, en el servidor, en cada ronda que cuenta.
    if (ctx.jackpotScale > 0 && cfg.jackpotTiers.length) {
      const u = rng();
      let cum = 0;
      for (let k = cfg.jackpotTiers.length - 1; k >= 0; k--) {
        const tier = cfg.jackpotTiers[k];
        cum += Math.min(0.5, tier.chance * ctx.jackpotScale);
        if (u < cum) {
          const jpPts = tier.points * ctx.pointsMult;
          pts += jpPts;
          st.jackpots[k] = (st.jackpots[k] || 0) + 1;
          st.ph.jackpots++;
          if (k > st.bestJackpot) st.bestJackpot = k;
          const cents = Math.round(tier.coinsCents * ctx.coinScale);
          if (cents > 0) out.awards.push({ claimId: inst.id + ':jp:' + reportId + ':' + i, cents, reason: 'Evento ' + def.name + ' · ' + tier.name, cosmetics: [] });
          out.feedback.push(fb('jackpot', '¡' + tier.name + '!', '+' + fmtEuros(cents) + ' · +' + fmtPoints(jpPts) + ' puntos',
            { tier: k, points: jpPts, color: k === 2 ? RED : k === 1 ? PURPLE : GOLD, sound: k === 0 ? 'slot.win_mega' : 'slot.jackpot', fx: k === 0 ? 'rays' : 'shake' }));
          break;
        }
      }
    }

    addPoints(def, st, pts);
    checkObjectives(def, st, out);
  }

  checkUnlocks(def, inst, st, out);

  // Lo importante primero y como mucho ocho avisos por lote: si no, una ráfaga de
  // bolas de Plinko taparía la pantalla de carteles.
  const weight = (f: Feedback) => (f.type === 'jackpot' ? 100 + f.tier * 10 : f.type === 'unlock' || f.type === 'chest_ready' ? 90
    : f.type === 'milestone' || f.type === 'streak_mult' ? 80 : f.type === 'objective' ? 70 : f.type === 'record' ? 60 : 10);
  out.feedback = out.feedback
    .map((f, i) => ({ f, i }))
    .sort((a, b) => weight(b.f) - weight(a.f) || a.i - b.i)
    .slice(0, 8)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.f);
  // De las rachas solo interesa la última del lote.
  const lastStreak = out.feedback.map((f) => f.type).lastIndexOf('streak');
  out.feedback = out.feedback.filter((f, i) => f.type !== 'streak' || i === lastStreak);

  return out;
}

// ---------------------------------------------------------------------------- todo o nada

export interface RiskResult { ok: boolean; message: string; feedback: Feedback[] }

/** ARRIESGAR: el servidor tira el dado. Si sale bien el bote sube de fase; si no, se pierde (o lo salva una protección). */
export function risk(def: EventDef, st: PlayerState, rng: Rng): RiskResult {
  if (!isRisk(def)) return { ok: false, message: 'Este evento no tiene riesgo.', feedback: [] };
  const steps = def.risk!.steps;
  const current = pot(def, st);
  if (current <= 0) return { ok: false, message: 'No tienes puntos en riesgo. Juega para llenar el bote.', feedback: [] };
  if (st.riskStep >= steps.length) return { ok: false, message: 'Ya estás en la fase máxima: cobra.', feedback: [] };

  // Lo ganado entre medias pasa a ser parte de la base al arriesgar de nuevo.
  if (st.riskStep === 0) { st.potBase += st.potExtra; st.potExtra = 0; }
  const step = steps[st.riskStep];
  const won = rng() < step.chance;

  if (won) {
    st.riskStep++;
    if (st.riskStep >= steps.length) {
      const total = pot(def, st);
      st.banked += total;
      st.potBase = 0; st.potExtra = 0; st.riskStep = 0;
      return { ok: true, message: '', feedback: [fb('risk_max', '¡x' + step.multiplier + '! ¡TODO!', '+' + fmtPoints(total) + ' asegurados', { tier: 2, points: total, color: GOLD, sound: 'slot.jackpot', fx: 'shake' })] };
    }
    return { ok: true, message: '', feedback: [fb('risk_win', '¡x' + step.multiplier + '!', 'Ahora tienes ' + fmtPoints(pot(def, st)) + ' en riesgo', { tier: 1, color: GREEN, sound: 'slot.win_big', fx: 'rays' })] };
  }

  if (st.shields > 0) {
    st.shields--;
    st.potBase = Math.floor(st.potBase + st.potExtra);
    st.potExtra = 0;
    st.riskStep = 0;
    return { ok: true, message: '', feedback: [fb('risk_shield', '¡PROTEGIDO!', 'Tu protección salva ' + fmtPoints(st.potBase) + ' puntos', { tier: 1, color: BLUE, sound: 'reward.claim', fx: 'pulse' })] };
  }

  st.potBase = 0; st.potExtra = 0; st.riskStep = 0;
  return { ok: true, message: '', feedback: [fb('risk_lose', '¡PERDIDO!', 'Se esfumaron ' + fmtPoints(current) + ' puntos', { tier: 0, color: RED, sound: 'crash.boom', fx: 'shake' })] };
}

/** COBRAR: el bote pasa a asegurado. */
export function cash(def: EventDef, st: PlayerState): RiskResult {
  if (!isRisk(def)) return { ok: false, message: 'Este evento no tiene riesgo.', feedback: [] };
  const current = pot(def, st);
  if (current <= 0) return { ok: false, message: 'No tienes nada que cobrar.', feedback: [] };
  st.banked += current;
  st.potBase = 0; st.potExtra = 0; st.riskStep = 0;
  return { ok: true, message: '', feedback: [fb('cash', '¡COBRADO!', '+' + fmtPoints(current) + ' asegurados', { color: GOLD, sound: 'cash.out', fx: 'coins' })] };
}

// ---------------------------------------------------------------------------- textos

/** Las reglas en castellano a partir de los números, para que lo que lee el jugador sea siempre lo que se aplica. */
export function rulesFor(cfg: EventsConfig, def: EventDef): string[] {
  const sc = def.scoring;
  const lines: string[] = [];
  const minStake = Math.max(cfg.limits.minStakeCents, def.minStakeCents ?? 0);
  if ((def.minStakeCents ?? 0) > cfg.limits.minStakeCents) lines.push('Solo cuentan apuestas de ' + fmtEuros(minStake) + ' o más.');
  lines.push('Victoria: +' + fmtPoints(sc.winPoints) + ' puntos (cuenta si cobras x' + String(sc.minWinMultiplier).replace('.', ',') + ' o más).');
  if (sc.streakStepPoints > 0) lines.push('Victoria consecutiva: +' + fmtPoints(sc.streakStepPoints) + ' más por cada una seguida.');
  if (sc.milestones.length) lines.push('Hitos de racha: ' + sc.milestones.map((m) => m.streak + ' seguidas +' + fmtPoints(m.points)).join(' · ') + '.');
  if (sc.streakMultiplierFrom && sc.streakMultiplier) lines.push(sc.streakMultiplierFrom + ' o más seguidas: todo vale x' + sc.streakMultiplier + '.');
  if (sc.breakOnLoss && sc.streakStepPoints > 0) lines.push('Una derrota reinicia la racha.');
  if (sc.bigMultiplierPoints > 0) lines.push('Ganar con x' + sc.bigMultiplier + ' o más: +' + fmtPoints(sc.bigMultiplierPoints) + '.');
  if ((def.pointsMultiplier ?? 1) !== 1) lines.push('Todos los puntos x' + String(def.pointsMultiplier).replace('.', ',') + ' durante el evento.');
  if (def.jackpotScale > 0) {
    lines.push('Jackpots en cada ronda: ' + cfg.jackpotTiers.map((t) => t.name.replace(' JACKPOT', '') + ' +' + fmtPoints(t.points) + ' y ' + fmtEuros(t.coinsCents)).join(' · ') + '.');
  }
  if (def.featured) {
    const f = def.featured;
    if (!f.onlyWithModifier) lines.push((def.kind === 'treasure' ? 'Mesa del tesoro' : 'Mesas especiales') + ': x' + f.pointsMultiplier + ' puntos (cambian cada ' + f.everyMinutes + ' min).');
  }
  if (def.modifiers) lines.push('Cada 10 minutos cambia la regla: ' + def.modifiers.map((m) => m.title).join(', ') + '.');
  if (def.surprise) lines.push(def.surprise.title + ' puede estallar sin avisar: ' + def.surprise.message + '.');
  if (def.phases) lines.push(def.phases.map((p) => p.name + ' (x' + String(p.pointsMultiplier).replace('.', ',') + ')').join(', luego ') + '.');
  if (def.risk) {
    lines.push('Arriesgar: ' + def.risk.steps.map((s) => 'x' + s.multiplier + ' (' + Math.round(s.chance * 100) + ' %)').join(', ') + '.');
    lines.push('Ganas 1 protección cada ' + def.risk.shieldEveryStreak + ' victorias seguidas (máximo ' + def.risk.maxShields + ').');
    if (def.risk.autoCashAtEnd) lines.push('Lo que quede en riesgo al cerrar se cobra solo.');
  }
  if (def.objectives && def.kind !== 'treasure') lines.push('Desafíos: ' + def.objectives.length + ' con puntos extra.');
  if (def.chest) lines.push('Completa todo el mapa para abrir el cofre: ' + fmtEuros(def.chest.coinsCents) + ' y un cosmético.');
  return lines;
}
