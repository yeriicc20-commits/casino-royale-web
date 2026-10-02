/**
 * Rangos, puntos, MMR y temporadas. Funciones puras: sin base de datos.
 *
 * Tres números que NO se mezclan:
 *   - puntos de rango (visibles): deciden el rango y la división;
 *   - MMR (oculto): decide contra quién juegas y cuánto vale ganar o perder;
 *   - fichas y XP: premio por jugar, no tocan el rango.
 */
import type { CompetitiveConfig, TierDef } from './types';

export interface Division {
  /** Índice global 0..N (FICHA III = 0, LEYENDA = último). */
  index: number;
  tierIndex: number;
  tierId: string;
  tierName: string;
  /** 3, 2, 1 o 0 (sin divisiones: Leyenda). */
  division: number;
  label: string;
  from: number;
  /** Puntos donde empieza la siguiente división (-1 en la última). */
  to: number;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** Todas las divisiones en orden, de FICHA III a LEYENDA DEL CASINO. */
export function divisions(cfg: CompetitiveConfig): Division[] {
  const out: Division[] = [];
  cfg.tiers.forEach((t: TierDef, ti) => {
    const n = Math.max(1, t.divisions);
    for (let k = 0; k < n; k++) {
      const div = t.divisions <= 1 ? 0 : n - k;
      const from = t.from + k * t.step;
      out.push({
        index: out.length, tierIndex: ti, tierId: t.id, tierName: t.name, division: div,
        label: div ? t.name + ' ' + ROMAN[div] : t.name, from, to: -1,
      });
    }
  });
  for (let i = 0; i < out.length - 1; i++) out[i].to = out[i + 1].from;
  return out;
}

export function divisionFor(cfg: CompetitiveConfig, points: number): Division {
  const all = divisions(cfg);
  let d = all[0];
  for (const x of all) if (points >= x.from) d = x;
  return d;
}

export function divisionByIndex(cfg: CompetitiveConfig, index: number): Division {
  const all = divisions(cfg);
  return all[Math.max(0, Math.min(all.length - 1, index))];
}

export function tierIndexOf(cfg: CompetitiveConfig, tierId: string): number {
  return cfg.tiers.findIndex((t) => t.id === tierId);
}

/** Probabilidad de ganar según el MMR (Elo). */
export function expected(mmr: number, opponentMmr: number): number {
  return 1 / (1 + Math.pow(10, (opponentMmr - mmr) / 400));
}

export interface LadderRow {
  points: number;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  peakPoints: number;
  peakDivision: number;
  protectLeft: number;
}

export interface RatingChange {
  pointsBefore: number;
  pointsAfter: number;
  pointsDelta: number;
  mmrBefore: number;
  mmrAfter: number;
  divisionBefore: number;
  divisionAfter: number;
  promoted: boolean;
  demoted: boolean;
  protectedFall: boolean;
  newPeak: boolean;
  streakBefore: number;
  streakAfter: number;
}

export type Outcome = 'win' | 'loss' | 'draw';

/**
 * Aplica un resultado a una escalera. `rated` = cuenta para el rango (partida
 * competitiva y no repetida). Devuelve el cambio para la pantalla de resultados.
 */
export function applyResult(
  cfg: CompetitiveConfig, row: LadderRow, opponentMmr: number, outcome: Outcome, rated: boolean, abandoned: boolean,
): RatingChange {
  const P = cfg.points;
  const before = { ...row };
  const divBefore = divisionFor(cfg, row.points);
  const tier = cfg.tiers[divBefore.tierIndex];
  const exp = expected(row.mmr, opponentMmr);

  row.games++;
  if (outcome === 'win') { row.wins++; row.streak = row.streak >= 0 ? row.streak + 1 : 1; }
  else if (outcome === 'loss') { row.losses++; row.streak = row.streak <= 0 ? row.streak - 1 : -1; }
  else { row.draws++; }
  if (row.streak > row.bestStreak) row.bestStreak = row.streak;

  let delta = 0;
  let protectedFall = false;
  if (rated) {
    // MMR: Elo, más rápido las primeras partidas.
    const k = row.games <= cfg.mmr.provisionalGames ? cfg.mmr.kProvisional : cfg.mmr.k;
    const score = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
    row.mmr = Math.max(cfg.mmr.min, Math.round(row.mmr + k * (score - exp)));

    if (outcome === 'win') {
      delta = P.winMin + (P.winMax - P.winMin) * (1 - exp);
      if (row.streak >= P.streakFrom) delta += Math.min(P.streakBonusMax, P.streakBonus * (row.streak - P.streakFrom + 1));
      delta *= tier.winFactor;
    } else if (outcome === 'loss') {
      delta = -(P.lossMin + (P.lossMax - P.lossMin) * exp) * tier.lossFactor;
      if (abandoned) delta -= P.abandonExtra;
    } else {
      delta = P.draw;
    }
    delta = Math.round(delta);

    let next = Math.max(P.floor, row.points + delta);
    // Protección: recién ascendido, unas partidas sin poder bajar de división.
    if (delta < 0 && row.protectLeft > 0) {
      if (next < divBefore.from) { next = divBefore.from; protectedFall = true; }
      row.protectLeft--;
    }
    row.points = next;
    delta = row.points - before.points;
  }

  const divAfter = divisionFor(cfg, row.points);
  const promoted = divAfter.index > divBefore.index;
  const demoted = divAfter.index < divBefore.index;
  if (promoted && P.promotionProtection.enabled) row.protectLeft = P.promotionProtection.matches;
  const newPeak = row.points > row.peakPoints;
  if (newPeak) row.peakPoints = row.points;
  if (divAfter.index > row.peakDivision) row.peakDivision = divAfter.index;

  return {
    pointsBefore: before.points, pointsAfter: row.points, pointsDelta: delta,
    mmrBefore: before.mmr, mmrAfter: row.mmr,
    divisionBefore: divBefore.index, divisionAfter: divAfter.index,
    promoted, demoted, protectedFall, newPeak,
    streakBefore: before.streak, streakAfter: row.streak,
  };
}

/** La ventana de MMR para emparejar tras `seconds` buscando. */
export function mmrWindow(cfg: CompetitiveConfig, seconds: number, casual: boolean): number {
  if (casual) return cfg.matchmaking.casualWindowMmr;
  let w = cfg.matchmaking.windows[0]?.mmr ?? 100;
  for (const x of cfg.matchmaking.windows) if (seconds >= x.afterSeconds) w = x.mmr;
  return w;
}

// ---------------------------------------------------------------------------- temporadas

export interface Season { number: number; name: string; startMs: number; endMs: number }

/** La temporada de un instante. Después de la última de la lista, siguen solas cada `defaultDays`. */
export function seasonAt(cfg: CompetitiveConfig, nowMs: number): Season {
  const list = [...cfg.seasons.list].sort((a, b) => a.number - b.number);
  const seasons: Season[] = list.map((s) => {
    const startMs = Date.parse(s.start);
    return { number: s.number, name: s.name, startMs, endMs: startMs + s.days * 86400000 };
  });
  for (const s of seasons) if (nowMs >= s.startMs && nowMs < s.endMs) return s;
  const first = seasons[0];
  if (nowMs < first.startMs) return first;
  let last = seasons[seasons.length - 1];
  while (nowMs >= last.endMs) {
    const n = last.number + 1;
    last = { number: n, name: cfg.seasons.defaultName.replace('{n}', String(n)), startMs: last.endMs, endMs: last.endMs + cfg.seasons.defaultDays * 86400000 };
  }
  return last;
}

export function seasonByNumber(cfg: CompetitiveConfig, n: number): Season {
  let s = seasonAt(cfg, Date.parse(cfg.seasons.list[0].start));
  while (s.number < n) s = seasonAt(cfg, s.endMs);
  return s;
}

/** Reset parcial al empezar temporada: lo que pasa del pivote se queda en `keep`. */
export function softReset(value: number, pivot: number, keep: number): number {
  return value > pivot ? Math.round(pivot + (value - pivot) * keep) : value;
}

/** Título dinámico de los mejores Leyendas. */
export function legendTitle(rank: number, isLegend: boolean): string {
  if (!isLegend || rank <= 0) return '';
  if (rank === 1) return 'REY DEL CASINO';
  if (rank <= 10) return 'TOP 10';
  if (rank <= 100) return 'TOP 100';
  return '';
}
