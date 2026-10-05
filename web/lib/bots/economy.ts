/**
 * La economía de los bots, sacada de la del juego (todo es moneda ficticia).
 *
 *   - Saldo inicial de una cuenta: 1.000 € (OPENING_BALANCE_CENTS en lib/ranking).
 *   - Apuesta mínima y máxima de cada máquina: las de Unity
 *     (Assets/_Project/ScriptableObjects/Machines/machine_*.asset).
 *   - Lo que devuelve cada máquina: su RTP, como las lógicas del juego
 *     (Casino.Runtime: dados y crash 1 % de casa, minas y mayor-menor 2 %...).
 *
 * En una persona la tirada la decide el móvil con esas lógicas y luego se
 * informa al servidor (saldo en la presencia, rondas en los eventos). Un bot es
 * su propio "móvil": tira aquí con los mismos márgenes y lo informa por el
 * mismo sitio.
 */
import { chance, clamp, logNormal, pick, randInt, uniform, weighted, type Rng } from './random';
import type { PersonalityDef } from './personalities';

export const OPENING_BALANCE_CENTS = 100_000;

/** Céntimos. Lo que una persona elegiría con las fichas: las pequeñas, mucho más. */
export const BET_LADDER_CENTS = [
  25, 50, 100, 200, 300, 500, 700, 1000, 1200, 1500, 1800, 2000, 2500, 3500, 5000, 7500, 10000, 12500, 25000, 50000,
  75000, 100000, 150000, 250000, 500000, 1000000,
] as const;

/** Por debajo de esto un bot ya no puede jugar casi a nada. */
export const LOW_WALLET_CENTS = 500;

/** El tope de multiplicador que aceptan los eventos (config.limits.maxMultiplier). */
const MAX_MULTIPLIER = 1000;

type Outcome = readonly [weight: number, min: number, max: number];

interface MachineModel {
  id: string;
  minCents: number;
  /** El máximo de la ficha de Unity. NO es un tope: se puede apostar más (ver chooseBet). */
  maxCents: number;
  /** Segundos que tarda una ronda (mediana). */
  roundSeconds: number;
  kind: 'table' | 'odds' | 'roulette';
  /** RTP objetivo para las tablas (las de probabilidad lo llevan en `edge`). */
  rtp?: number;
  outcomes?: readonly Outcome[];
  /** 'odds': ventaja de la casa y probabilidades de acierto que se pueden elegir. */
  edge?: number;
  odds?: readonly number[];
}

/** Las 16 máquinas del juego, con sus límites reales. */
export const MACHINES: Record<string, MachineModel> = {
  slots: { id: 'slots', minCents: 500, maxCents: 50000, roundSeconds: 4, kind: 'table', rtp: 0.955,
    outcomes: [[64, 0, 0], [18, 0.4, 1], [11, 1.2, 2.5], [4.6, 3, 10], [1.2, 12, 40], [0.18, 60, 250], [0.02, 300, 1000]] },
  roulette: { id: 'roulette', minCents: 50, maxCents: 50000, roundSeconds: 22, kind: 'roulette' },
  blackjack: { id: 'blackjack', minCents: 100, maxCents: 50000, roundSeconds: 16, kind: 'table', rtp: 0.958,
    outcomes: [[49.1, 0, 0], [8.5, 1, 1], [37.9, 2, 2], [4.5, 2.5, 2.5]] },
  baccarat: { id: 'baccarat', minCents: 100, maxCents: 50000, roundSeconds: 14, kind: 'table', rtp: 0.989,
    outcomes: [[44.62, 0, 0], [9.52, 1, 1], [45.86, 1.95, 1.95]] },
  crash: { id: 'crash', minCents: 50, maxCents: 50000, roundSeconds: 11, kind: 'odds', edge: 0.01,
    odds: [0.82, 0.66, 0.5, 0.33, 0.2, 0.1, 0.04] },
  dice: { id: 'dice', minCents: 50, maxCents: 50000, roundSeconds: 3, kind: 'odds', edge: 0.01,
    odds: [0.9, 0.75, 0.6, 0.5, 0.4, 0.25, 0.1] },
  mines: { id: 'mines', minCents: 50, maxCents: 50000, roundSeconds: 9, kind: 'odds', edge: 0.02,
    odds: [0.88, 0.75, 0.6, 0.45, 0.3, 0.15] },
  hilo: { id: 'hilo', minCents: 50, maxCents: 50000, roundSeconds: 6, kind: 'odds', edge: 0.02,
    odds: [0.85, 0.7, 0.55, 0.45, 0.3] },
  plinko: { id: 'plinko', minCents: 50, maxCents: 50000, roundSeconds: 4, kind: 'table', rtp: 0.97,
    outcomes: [[30, 0.2, 0.5], [40, 0.7, 1.1], [20, 1.2, 2], [7.5, 2, 5], [2.2, 5, 16], [0.3, 25, 110]] },
  keno: { id: 'keno', minCents: 50, maxCents: 50000, roundSeconds: 8, kind: 'table', rtp: 0.93,
    outcomes: [[68, 0, 0], [20, 1, 2], [9, 3, 6], [2.6, 10, 30], [0.38, 50, 200], [0.02, 500, 1000]] },
  bingo: { id: 'bingo', minCents: 50, maxCents: 50000, roundSeconds: 18, kind: 'table', rtp: 0.94,
    outcomes: [[70, 0, 0], [20, 1, 2], [8, 3, 5], [1.8, 8, 20], [0.2, 50, 150]] },
  scratch: { id: 'scratch', minCents: 100, maxCents: 10000, roundSeconds: 6, kind: 'table', rtp: 0.92,
    outcomes: [[66, 0, 0], [22, 1, 2], [9, 3, 5], [2.7, 10, 20], [0.3, 50, 200]] },
  videopoker: { id: 'videopoker', minCents: 25, maxCents: 12500, roundSeconds: 9, kind: 'table', rtp: 0.975,
    outcomes: [[55, 0, 0], [21.5, 1, 1], [12.9, 2, 2], [7.4, 3, 3], [1.1, 4, 4], [1.1, 6, 6], [0.9, 9, 9], [0.24, 25, 25], [0.01, 50, 50], [0.0025, 250, 250]] },
  holdem: { id: 'holdem', minCents: 100, maxCents: 25000, roundSeconds: 24, kind: 'table', rtp: 0.978,
    outcomes: [[47, 0, 0], [8, 1, 1], [38, 2, 3], [5.5, 4, 6], [1.3, 8, 12], [0.2, 20, 40]] },
  horses: { id: 'horses', minCents: 100, maxCents: 50000, roundSeconds: 38, kind: 'odds', edge: 0.05,
    odds: [0.5, 0.33, 0.25, 0.16, 0.12, 0.08] },
  tute: { id: 'tute', minCents: 100, maxCents: 50000, roundSeconds: 32, kind: 'table', rtp: 0.96,
    outcomes: [[50, 0, 0], [6, 1, 1], [42, 2, 2], [2, 3, 3]] },
};

export const MACHINE_IDS = Object.keys(MACHINES);

function tableMean(outcomes: readonly Outcome[]): number {
  let w = 0;
  let m = 0;
  for (const [weight, lo, hi] of outcomes) { w += weight; m += weight * (lo + hi) / 2; }
  return w > 0 ? m / w : 0;
}

/**
 * Lo que devuelve UNA ronda por cada euro apostado (0 = pierde, 1 = recupera,
 * 2 = dobla...). El riesgo del bot decide a qué juega dentro de la máquina.
 */
export function roundMultiplier(rng: Rng, machine: MachineModel, risk: number): number {
  if (machine.kind === 'roulette') {
    // Sencillas (x2), docenas (x3) o pleno (x36), según el riesgo.
    const bet = weighted(rng, [['even', 8 - 4 * risk], ['dozen', 2 + 2 * risk], ['number', 0.3 + 2 * risk]] as const);
    if (bet === 'even') return rng() < 18 / 37 ? 2 : 0;
    if (bet === 'dozen') return rng() < 12 / 37 ? 3 : 0;
    return rng() < 1 / 37 ? 36 : 0;
  }
  if (machine.kind === 'odds') {
    const odds = machine.odds!;
    // Más riesgo = probabilidades más bajas y premios más altos.
    const idx = clamp(Math.round(risk * (odds.length - 1) + (rng() - 0.5) * 2.2), 0, odds.length - 1);
    const p = odds[idx];
    return rng() < p ? Math.min(MAX_MULTIPLIER, (1 - machine.edge!) / p) : 0;
  }
  const outcomes = machine.outcomes!;
  const scale = (machine.rtp ?? 0.95) / tableMean(outcomes);
  const [, lo, hi] = weighted(rng, outcomes.map((o) => [o, o[0]] as const));
  return Math.min(MAX_MULTIPLIER, uniform(rng, lo, hi) * scale);
}

/** Céntimos que devuelve una ronda (apuesta incluida), como lo informaría el juego. */
export function playRound(rng: Rng, machineId: string, stakeCents: number, risk: number): number {
  const machine = MACHINES[machineId];
  if (!machine) return 0;
  return Math.max(0, Math.floor(stakeCents * roundMultiplier(rng, machine, risk)));
}

/** Segundos que tarda una ronda en esa máquina para un bot concreto. */
export function roundSeconds(rng: Rng, machineId: string, rhythm: number): number {
  const base = MACHINES[machineId]?.roundSeconds ?? 8;
  return clamp(logNormal(rng, base * rhythm, 0.35), 1.5, base * 4);
}

/**
 * Cuánto apuesta un bot en una ronda.
 *
 * Alrededor de su apuesta típica (una fracción de su saldo según la
 * personalidad), con preferencia por las fichas pequeñas, sin pasarse del
 * máximo de la máquina ni de lo que se permite arriesgar, y de vez en cuando
 * un arrebato si es arriesgado. Null si no le llega para la mínima.
 */
export function chooseBet(
  rng: Rng, def: PersonalityDef, walletCents: number, machineId: string, minCents = 0,
): number | null {
  const machine = MACHINES[machineId];
  if (!machine) return null;
  const floor = Math.max(machine.minCents, minCents);
  if (walletCents < floor) return null;

  // Sin tope de máquina: como en el juego (y en lib/anticheat), se puede apostar
  // por encima de los 500 € si el saldo lo aguanta. Lo que frena es la
  // personalidad: nadie sensato se juega más de su fracción máxima.
  const cap = Math.min(walletCents, Math.max(floor, Math.floor(walletCents * def.maxBetFraction)));
  const candidates = BET_LADDER_CENTS.filter((v) => v >= floor && v <= cap);
  if (!candidates.length) return floor <= walletCents ? floor : null;

  const typical = clamp(walletCents * def.betFraction, floor, cap);
  // Un arrebato: apuesta de las altas que se permite (más en los arriesgados).
  if (candidates.length > 3 && chance(rng, 0.015 + 0.05 * def.risk)) {
    return pick(rng, candidates.slice(-Math.max(2, Math.ceil(candidates.length / 4))));
  }
  const sigma = 0.55 + 0.25 * def.risk;
  return weighted(rng, candidates.map((v) => {
    const d = Math.log(v / typical);
    const bell = Math.exp(-(d * d) / (2 * sigma * sigma));
    const smallBias = Math.pow(v / typical, -0.3);
    return [v, bell * smallBias] as const;
  }));
}

/** Saldo con el que nace un bot: coherente con su personalidad y nunca redondo. */
export function startingWallet(rng: Rng, def: PersonalityDef): number {
  const euros = logNormal(rng, def.wallet.medianEuros, def.wallet.sigma);
  const cents = Math.round(clamp(euros, 150, 120_000) * 100) + randInt(rng, 0, 99);
  return cents;
}

/** Elige máquina según los gustos de la personalidad (las demás también pueden salir). */
export function pickMachine(rng: Rng, def: PersonalityDef, allowed: readonly string[] = MACHINE_IDS): string {
  const list = allowed.filter((m) => MACHINES[m]);
  return weighted(rng, list.map((m) => [m, def.machines[m] ?? 1] as const));
}
