/**
 * Cómo juega un bot una partida del 1 contra 1 y un reto de blackjack, y
 * cuándo acepta un desafío. Funciones puras: reciben la partida (la MISMA
 * MatchState que usa el servidor para las personas) y devuelven la jugada,
 * que luego se aplica con placeBet / playAction / setReady de lib/competitive.
 */
import { handValue } from '../duel';
import { bestHand } from '../competitive/poker';
import type { Bet, GameDef, MatchState, Side } from '../competitive/types';
import type { PersonalityDef } from './personalities';
import { chance, clamp, humanDelayMs, uniform, weighted, type Rng } from './random';

export type MatchMove =
  | { op: 'ready' }
  | { op: 'bet'; bet: Bet & { pass?: boolean } }
  | { op: 'act'; action: string };

const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

/** Una ficha de partida "redonda", como la elegiría alguien (10, 20, 50...). */
function roundChips(x: number, minBet: number): number {
  const step = x >= 200 ? 50 : x >= 60 ? 10 : 5;
  return Math.max(minBet, Math.round(x / step) * step);
}

/** Cuántas fichas de partida apuesta en esta ronda. */
export function matchBetAmount(st: MatchState, side: Side, def: GameDef, p: PersonalityDef, rng: Rng): number {
  const stack = st.stacks[side];
  const lead = stack - st.stacks[other(side)];
  const roundsLeft = Math.max(1, st.rounds - st.round + 1);
  let fraction = 0.04 + 0.22 * p.risk;
  fraction *= uniform(rng, 0.6, 1.5);
  // Va perdiendo y quedan pocas rondas: aprieta. Va ganando: frena.
  if (lead < 0 && roundsLeft <= 2) fraction = Math.max(fraction, Math.min(1, -lead / stack + 0.1));
  if (lead > 0 && roundsLeft <= 3) fraction *= 0.5;
  let amount = roundChips(stack * fraction, def.minBet);
  if (def.kind === 'poker') amount = Math.min(amount, Math.floor(stack / 2));
  return clamp(amount, Math.min(def.minBet, stack), stack);
}

function rouletteBet(rng: Rng, p: PersonalityDef): { type: string; number?: number } {
  const type = weighted(rng, [
    ['red', 6], ['black', 6], ['even', 3], ['odd', 3], ['low', 3], ['high', 3],
    ['dozen1', 1 + 2 * p.risk], ['dozen2', 1 + 2 * p.risk], ['dozen3', 1 + 2 * p.risk],
    ['number', 0.3 + 2.5 * p.risk],
  ] as const);
  if (type === 'number') {
    const lucky = [7, 17, 23, 32, 11, 3, 0, 14, 21, 27];
    return { type, number: chance(rng, 0.5) ? lucky[Math.floor(rng() * lucky.length)] : Math.floor(rng() * 37) };
  }
  return { type };
}

/** ¿Pide carta? Básico: con 11 o menos siempre, con 17 o más nunca, en medio según el riesgo. */
export function blackjackHits(cards: string[], p: PersonalityDef, rng: Rng): boolean {
  const total = handValue(cards);
  if (total <= 11) return true;
  if (total >= 17) return false;
  const soft = cards.some((c) => c.startsWith('A')) && total <= 17;
  const base = soft ? 0.8 : 0.25 + 0.45 * p.risk - (total - 12) * 0.06;
  return chance(rng, clamp(base, 0.05, 0.9));
}

/** Póker: subir con pareja o mejor (o un farol si es atrevido), retirarse si no. */
export function pokerChoice(hole: string[], flop: string[], p: PersonalityDef, rng: Rng): 'raise' | 'fold' {
  const hand = bestHand([...hole, ...flop]);
  if (hand.rank >= 2) return 'raise';
  if (hand.rank === 1) return chance(rng, 0.75 + 0.2 * p.risk) ? 'raise' : 'fold';
  const highCard = Math.max(...hole.map((c) => ('AKQJ'.includes(c[0]) ? 12 : Number(c.slice(0, -1)) || 0)));
  return chance(rng, 0.08 + 0.35 * p.risk + (highCard >= 12 ? 0.15 : 0)) ? 'raise' : 'fold';
}

/**
 * La jugada que toca ahora en una partida del 1v1, o null si no hay nada que
 * hacer (esperando al rival, al reloj o a que acabe la ronda anterior).
 */
export function matchMove(st: MatchState, side: Side, def: GameDef, p: PersonalityDef, rng: Rng, nowMs: number): MatchMove | null {
  if (st.phase === 'ready') return st.ready[side] ? null : { op: 'ready' };
  if (st.phase === 'bet') {
    if (st.bets[side] !== null || nowMs < st.revealUntil) return null;
    // Casi nunca pasa; los prudentes, alguna vez.
    if (chance(rng, 0.03 * (1 - p.risk))) return { op: 'bet', bet: { amount: 0, pass: true } };
    const amount = matchBetAmount(st, side, def, p, rng);
    if (def.kind === 'roulette') return { op: 'bet', bet: { amount, ...rouletteBet(rng, p) } };
    return { op: 'bet', bet: { amount } };
  }
  if (st.phase === 'play') {
    if (def.kind === 'blackjack' && st.bj) {
      const hand = st.bj.hands[side];
      if (hand.done) return null;
      return { op: 'act', action: blackjackHits(hand.cards, p, rng) ? 'hit' : 'stand' };
    }
    if (def.kind === 'poker' && st.pk) {
      if (st.pk.choice[side]) return null;
      return { op: 'act', action: pokerChoice(st.pk.hole[side], st.pk.board.slice(0, 3), p, rng) };
    }
  }
  return null;
}

/**
 * Cuánto "piensa" antes de una jugada. Lo justo para no parecer una máquina,
 * pero siempre con margen antes de que se acabe el tiempo (nunca pierde una
 * ronda por lento).
 */
export function thinkMs(rng: Rng, kind: MatchMove['op'], rhythm: number, nowMs: number, deadlineMs: number): number {
  const median = kind === 'ready' ? 2.2 : kind === 'bet' ? 4.5 : 2.6;
  const want = humanDelayMs(rng, median * rhythm, 0.5, 0.8, 14);
  const room = Math.max(0, deadlineMs - nowMs - 2500);
  return Math.min(want, room);
}

/**
 * ¿Acepta un reto de blackjack (dinero de verdad del juego, ficticio)?
 * Depende de cuánto pesa la apuesta sobre su saldo libre y de su riesgo.
 */
export function acceptDuelChance(stakeCents: number, availableCents: number, p: PersonalityDef, fromHuman: boolean): number {
  if (availableCents < stakeCents || stakeCents <= 0) return 0;
  const weight = stakeCents / Math.max(1, availableCents);
  const comfort = clamp(1 - weight / (0.04 + 0.25 * p.risk), 0.05, 1);
  const base = fromHuman ? 0.35 + 0.6 * p.humanDuelAccept : 0.3 + 0.6 * p.duelInterest;
  return clamp(base * comfort, 0.03, 0.95);
}

/**
 * ¿Acepta jugar contra la persona que está buscando rival?
 *
 *   - más ganas cuanto más le guste el 1v1 a su personalidad
 *   - menos cuantas más personas haya conectadas (que jueguen entre ellas)
 *   - menos si hay otras personas buscando lo mismo (se van a encontrar)
 *   - un poco más si hay muchos bots libres (alguno se anima)
 */
export function acceptTicketChance(p: PersonalityDef, humansOnline: number, humansSearchingSame: number, freeBots: number): number {
  const crowd = clamp(1.25 - humansOnline / 24, 0.2, 1.25);
  const rivals = humansSearchingSame > 1 ? 0.25 : 1;
  const plenty = clamp(0.85 + freeBots / 60, 0.85, 1.25);
  return clamp((0.25 + 0.65 * p.humanDuelAccept) * crowd * rivals * plenty, 0.02, 0.95);
}
