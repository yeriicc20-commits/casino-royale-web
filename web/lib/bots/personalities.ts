/**
 * Personalidades. Cada bot tiene una para siempre (como cada persona tiene su
 * forma de jugar), y todo lo que decide pasa por ella: cuánto tiempo se queda,
 * cuánto apuesta, a qué juega, si le interesan los eventos o el 1 contra 1, y
 * cuánto tarda entre una cosa y otra.
 *
 * Los números son medianas: cada decisión les añade su propia variación, así
 * que dos bots de la misma personalidad tampoco hacen lo mismo.
 */
import { weighted, type Rng } from './random';
import type { Personality } from './types';

export interface Range { median: number; sigma: number; min: number; max: number }

export interface PersonalityDef {
  id: Personality;
  /** Peso en la población (cuántos bots nacen con esta personalidad). */
  share: number;
  /** Cuánto dura una sesión conectado, en minutos. */
  sessionMinutes: Range;
  /** Cuánto tarda en volver después de irse, en minutos. */
  restMinutes: Range;
  /** Segundos que pasan entre decisiones cuando no está jugando. */
  thinkSeconds: Range;
  /** Pesos de lo que hace cuando está libre. */
  idle: number;
  browse: number;
  play: number;
  /** 0..1: ganas de entrar en un evento abierto. */
  eventInterest: number;
  /** 0..1: ganas de buscar un 1 contra 1. */
  duelInterest: number;
  /** 0..1: probabilidad base de aceptar el desafío de una persona. */
  humanDuelAccept: number;
  /** 0..1: riesgo. Sube las apuestas grandes, las cartas pedidas, arriesgar en eventos. */
  risk: number;
  /** Apuesta típica como fracción del saldo, y la máxima que se permite. */
  betFraction: number;
  maxBetFraction: number;
  /** Rondas seguidas en una máquina antes de pensar en otra cosa. */
  roundsPerVisit: [number, number];
  /** Máquinas preferidas (las que no salen pesan 1). */
  machines: Record<string, number>;
  /** Juegos preferidos del 1v1. */
  duelGames: Record<string, number>;
  /** Probabilidad de elegir COMPETITIVO (si no, CASUAL). */
  competitiveShare: number;
  /** Saldo con el que nace, en euros (log-normal). */
  wallet: { medianEuros: number; sigma: number };
}

const R = (median: number, sigma: number, min: number, max: number): Range => ({ median, sigma, min, max });

export const PERSONALITY_DEFS: Record<Personality, PersonalityDef> = {
  CASUAL: {
    id: 'CASUAL', share: 26,
    sessionMinutes: R(11, 0.6, 4, 70), restMinutes: R(150, 0.8, 25, 1440), thinkSeconds: R(22, 0.7, 4, 140),
    idle: 5, browse: 3, play: 3, eventInterest: 0.12, duelInterest: 0.08, humanDuelAccept: 0.22, risk: 0.25,
    betFraction: 0.008, maxBetFraction: 0.04, roundsPerVisit: [3, 12],
    machines: { slots: 6, scratch: 3, roulette: 2, plinko: 2, keno: 2, bingo: 2 },
    duelGames: { roulette: 3, dice: 3, blackjack: 1 }, competitiveShare: 0.2,
    wallet: { medianEuros: 900, sigma: 0.55 },
  },
  ACTIVE: {
    id: 'ACTIVE', share: 15,
    sessionMinutes: R(42, 0.6, 10, 180), restMinutes: R(80, 0.7, 15, 720), thinkSeconds: R(9, 0.6, 2.5, 60),
    idle: 1, browse: 2, play: 6, eventInterest: 0.5, duelInterest: 0.3, humanDuelAccept: 0.5, risk: 0.45,
    betFraction: 0.015, maxBetFraction: 0.07, roundsPerVisit: [8, 30],
    machines: { slots: 3, blackjack: 3, roulette: 3, crash: 3, mines: 2, plinko: 2, dice: 2, hilo: 2 },
    duelGames: { roulette: 2, blackjack: 2, dice: 2, poker: 1 }, competitiveShare: 0.45,
    wallet: { medianEuros: 2500, sigma: 0.6 },
  },
  HIGH_ROLLER: {
    id: 'HIGH_ROLLER', share: 6,
    sessionMinutes: R(28, 0.6, 6, 150), restMinutes: R(200, 0.8, 30, 1440), thinkSeconds: R(12, 0.6, 3, 70),
    idle: 1, browse: 2, play: 5, eventInterest: 0.4, duelInterest: 0.3, humanDuelAccept: 0.55, risk: 0.85,
    betFraction: 0.035, maxBetFraction: 0.18, roundsPerVisit: [5, 20],
    machines: { blackjack: 4, roulette: 4, baccarat: 4, holdem: 2, crash: 2, slots: 2 },
    duelGames: { blackjack: 3, poker: 3, roulette: 2 }, competitiveShare: 0.5,
    wallet: { medianEuros: 16000, sigma: 0.7 },
  },
  LOW_RISK: {
    id: 'LOW_RISK', share: 13,
    sessionMinutes: R(20, 0.5, 6, 90), restMinutes: R(120, 0.7, 20, 1200), thinkSeconds: R(16, 0.6, 4, 90),
    idle: 3, browse: 3, play: 4, eventInterest: 0.2, duelInterest: 0.12, humanDuelAccept: 0.3, risk: 0.1,
    betFraction: 0.004, maxBetFraction: 0.02, roundsPerVisit: [5, 18],
    machines: { videopoker: 4, blackjack: 3, baccarat: 3, roulette: 2, keno: 2, scratch: 2 },
    duelGames: { roulette: 3, dice: 2, blackjack: 2 }, competitiveShare: 0.25,
    wallet: { medianEuros: 1500, sigma: 0.5 },
  },
  EVENT_PLAYER: {
    id: 'EVENT_PLAYER', share: 9,
    sessionMinutes: R(35, 0.6, 8, 150), restMinutes: R(100, 0.7, 20, 900), thinkSeconds: R(11, 0.6, 3, 70),
    idle: 2, browse: 2, play: 5, eventInterest: 0.92, duelInterest: 0.15, humanDuelAccept: 0.35, risk: 0.5,
    betFraction: 0.012, maxBetFraction: 0.06, roundsPerVisit: [6, 22],
    machines: { slots: 4, roulette: 3, blackjack: 3, crash: 2, mines: 2, plinko: 2, horses: 2 },
    duelGames: { roulette: 2, dice: 2, blackjack: 1 }, competitiveShare: 0.3,
    wallet: { medianEuros: 2000, sigma: 0.6 },
  },
  DUEL_PLAYER: {
    id: 'DUEL_PLAYER', share: 9,
    sessionMinutes: R(38, 0.6, 8, 160), restMinutes: R(110, 0.7, 20, 900), thinkSeconds: R(10, 0.6, 3, 60),
    idle: 2, browse: 2, play: 3, eventInterest: 0.2, duelInterest: 0.8, humanDuelAccept: 0.8, risk: 0.55,
    betFraction: 0.012, maxBetFraction: 0.06, roundsPerVisit: [3, 10],
    machines: { blackjack: 4, holdem: 3, roulette: 2, dice: 2, hilo: 2 },
    duelGames: { blackjack: 3, poker: 3, roulette: 2, dice: 2 }, competitiveShare: 0.65,
    wallet: { medianEuros: 2000, sigma: 0.6 },
  },
  MIXED: {
    id: 'MIXED', share: 22,
    sessionMinutes: R(24, 0.7, 5, 130), restMinutes: R(120, 0.8, 15, 1200), thinkSeconds: R(14, 0.7, 3, 100),
    idle: 3, browse: 3, play: 4, eventInterest: 0.35, duelInterest: 0.25, humanDuelAccept: 0.45, risk: 0.4,
    betFraction: 0.012, maxBetFraction: 0.05, roundsPerVisit: [4, 16],
    machines: {}, duelGames: { roulette: 2, blackjack: 2, dice: 2, poker: 1 }, competitiveShare: 0.35,
    wallet: { medianEuros: 1800, sigma: 0.65 },
  },
};

export function defFor(p: Personality): PersonalityDef {
  return PERSONALITY_DEFS[p] ?? PERSONALITY_DEFS.MIXED;
}

/** La personalidad de un bot nuevo, según el reparto de la población. */
export function pickPersonality(rng: Rng): Personality {
  return weighted(rng, Object.values(PERSONALITY_DEFS).map((d) => [d.id, d.share] as const));
}
