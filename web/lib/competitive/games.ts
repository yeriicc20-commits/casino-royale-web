/**
 * Los juegos del competitivo: un módulo por juego.
 *
 * Las máquinas del casino deciden el resultado en el móvil, y eso no vale para
 * enfrentar a dos personas (un móvil trucado diría que ha ganado). Aquí todo lo
 * aleatorio lo sortea el servidor, y los DOS jugadores juegan con la misma
 * suerte en cada ronda: el mismo número de ruleta, la misma tirada de dados, las
 * mismas cartas. Gana quien mejor decide cuánto y a qué apostar.
 *
 * Cada jugador empieza con las mismas fichas de partida (no son su saldo) y al
 * final gana quien tenga más.
 *
 * Añadir un juego = escribir un módulo aquí y una línea en config.json. El
 * emparejamiento, el rango, el MMR, las temporadas y los premios no cambian.
 */
import { handValue, isBlackjack } from '@/lib/duel';
import type { Bet, BjHand, GameDef, MatchState, Side } from './types';

export type Rng = () => number;

export interface Settle { delta: number; detail: string }

export interface GameModule {
  /** Comprueba una apuesta. Devuelve la apuesta limpia o el motivo. */
  validate(raw: Partial<Bet>, stack: number, def: GameDef): Bet | string;
  /** Prepara la ronda tras apostar los dos (reparte cartas...). true = hay fase de jugar la mano. */
  start(st: MatchState, rng: Rng): boolean;
  /** Una acción de la fase de jugar (blackjack). null = bien; texto = error. */
  act?(st: MatchState, side: Side, action: string): string | null;
  /** Lo que se hace solo si se acaba el tiempo en la fase de jugar. */
  autoPlay?(st: MatchState, side: Side): void;
  playDone?(st: MatchState, side: Side): boolean;
  /** Resuelve la ronda para los dos. */
  resolve(st: MatchState, rng: Rng): { outcome: string; a: Settle; b: Settle };
}

function amountOf(raw: Partial<Bet>, stack: number, def: GameDef): number | string {
  const amount = Math.floor(Number(raw.amount));
  if (!Number.isFinite(amount) || amount <= 0) return 'Elige cuánto apuestas.';
  if (amount < def.minBet && amount < stack) return 'La apuesta mínima es ' + def.minBet + '.';
  if (amount > stack) return 'No tienes tantas fichas de partida.';
  return amount;
}

const randInt = (rng: Rng, n: number) => Math.min(n - 1, Math.floor(rng() * n));

// ---------------------------------------------------------------------------- ruleta

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const ROULETTE_BETS: Record<string, { pays: number; name: string; wins: (n: number, pick?: number) => boolean }> = {
  red: { pays: 1, name: 'ROJO', wins: (n) => RED.has(n) },
  black: { pays: 1, name: 'NEGRO', wins: (n) => n > 0 && !RED.has(n) },
  even: { pays: 1, name: 'PAR', wins: (n) => n > 0 && n % 2 === 0 },
  odd: { pays: 1, name: 'IMPAR', wins: (n) => n % 2 === 1 },
  low: { pays: 1, name: '1-18', wins: (n) => n >= 1 && n <= 18 },
  high: { pays: 1, name: '19-36', wins: (n) => n >= 19 },
  dozen1: { pays: 2, name: '1ª DOCENA', wins: (n) => n >= 1 && n <= 12 },
  dozen2: { pays: 2, name: '2ª DOCENA', wins: (n) => n >= 13 && n <= 24 },
  dozen3: { pays: 2, name: '3ª DOCENA', wins: (n) => n >= 25 },
  number: { pays: 35, name: 'NÚMERO', wins: (n, pick) => n === pick },
};

export function rouletteColour(n: number): string {
  return n === 0 ? 'VERDE' : RED.has(n) ? 'ROJO' : 'NEGRO';
}

const roulette: GameModule = {
  validate(raw, stack, def) {
    const amount = amountOf(raw, stack, def);
    if (typeof amount === 'string') return amount;
    const type = String(raw.type ?? '');
    if (!ROULETTE_BETS[type]) return 'Elige a qué apuestas.';
    if (type === 'number') {
      const n = Math.floor(Number(raw.number));
      if (!Number.isFinite(n) || n < 0 || n > 36) return 'Elige un número del 0 al 36.';
      return { amount, type, number: n };
    }
    return { amount, type };
  },
  start() { return false; },
  resolve(st, rng) {
    const n = randInt(rng, 37);
    const one = (bet: Bet | null): Settle => {
      if (!bet || bet.amount <= 0) return { delta: 0, detail: 'Sin apuesta' };
      const b = ROULETTE_BETS[bet.type ?? ''];
      const win = b.wins(n, bet.number);
      const label = bet.type === 'number' ? 'Nº ' + bet.number : b.name;
      return { delta: win ? bet.amount * b.pays : -bet.amount, detail: label + (win ? ' ¡acierta!' : ' falla') };
    };
    return { outcome: n + ' ' + rouletteColour(n), a: one(st.bets.a), b: one(st.bets.b) };
  },
};

// ---------------------------------------------------------------------------- dados

const dice: GameModule = {
  validate(raw, stack, def) {
    const amount = amountOf(raw, stack, def);
    if (typeof amount === 'string') return amount;
    const chance = Math.round(Number(raw.chance));
    if (!Number.isFinite(chance) || chance < 5 || chance > 95) return 'La probabilidad va del 5 al 95 %.';
    return { amount, chance };
  },
  start() { return false; },
  resolve(st, rng) {
    // Una sola tirada para los dos, de 0,00 a 99,99. Gana quien la tenga por debajo de su probabilidad.
    const roll = randInt(rng, 10000) / 100;
    const one = (bet: Bet | null): Settle => {
      if (!bet || bet.amount <= 0) return { delta: 0, detail: 'Sin apuesta' };
      const chance = bet.chance ?? 50;
      const win = roll < chance;
      // Justo: paga 100/probabilidad (sin ventaja de la casa, que aquí no hay casa).
      const delta = win ? Math.floor(bet.amount * (100 / chance - 1)) : -bet.amount;
      return { delta, detail: 'Menos de ' + chance + (win ? ' ¡acierta!' : ' falla') };
    };
    return { outcome: roll.toFixed(2).replace('.', ','), a: one(st.bets.a), b: one(st.bets.b) };
  },
};

// ---------------------------------------------------------------------------- blackjack

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['s', 'h', 'd', 'c'];

export function shuffled(rng: Rng): string[] {
  const deck: string[] = [];
  for (let d = 0; d < 2; d++) for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function emptyHand(): BjHand { return { cards: [], done: true, doubled: false } }

const blackjack: GameModule = {
  validate(raw, stack, def) {
    const amount = amountOf(raw, stack, def);
    return typeof amount === 'string' ? amount : { amount };
  },
  start(st, rng) {
    // Dos montones: el del crupier y el de los jugadores. Los dos jugadores sacan del
    // MISMO montón (cada uno su copia): mismas cartas iniciales y, si piden, las mismas
    // siguientes. Las decisiones son lo único que cambia.
    const deck = shuffled(rng);
    const dealerPile = deck.slice(0, 20);
    const pile = deck.slice(20, 40);
    const first = [pile[0], pile[1]];
    const hand = (side: Side): BjHand => {
      const bet = st.bets[side];
      if (!bet || bet.amount <= 0) return emptyHand();
      return { cards: [...first], done: isBlackjack(first), doubled: false };
    };
    st.bj = {
      dealer: [dealerPile[0], dealerPile[1]],
      dealerPile: dealerPile.slice(2),
      pile,
      hands: { a: hand('a'), b: hand('b') },
      draws: { a: 2, b: 2 },
    };
    return !(st.bj.hands.a.done && st.bj.hands.b.done);
  },
  act(st, side, action) {
    const bj = st.bj;
    if (!bj) return 'No hay mano.';
    const h = bj.hands[side];
    if (h.done) return 'Ya has terminado tu mano.';
    const draw = () => { h.cards.push(bj.pile[bj.draws[side]]); bj.draws[side]++; };
    if (action === 'hit') {
      draw();
      if (handValue(h.cards) >= 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      const bet = st.bets[side]!;
      if (h.cards.length !== 2) return 'Solo se dobla con dos cartas.';
      if (bet.amount * 2 > st.stacks[side]) return 'No tienes fichas para doblar.';
      bet.amount *= 2;
      h.doubled = true;
      draw();
      h.done = true;
    } else {
      return 'Acción desconocida.';
    }
    return null;
  },
  autoPlay(st, side) {
    if (st.bj) st.bj.hands[side].done = true;
  },
  playDone(st, side) {
    return !st.bj || st.bj.hands[side].done;
  },
  resolve(st) {
    const bj = st.bj!;
    // El crupier pide hasta 17 (se planta en 17 blando), del SUYO montón.
    let k = 0;
    while (handValue(bj.dealer) < 17) bj.dealer.push(bj.dealerPile[k++]);
    const dv = handValue(bj.dealer);
    const dealerBj = isBlackjack(bj.dealer);
    const one = (side: Side): Settle => {
      const bet = st.bets[side];
      const h = bj.hands[side];
      if (!bet || bet.amount <= 0 || !h.cards.length) return { delta: 0, detail: 'Sin apuesta' };
      const pv = handValue(h.cards);
      const pbj = isBlackjack(h.cards);
      if (pv > 21) return { delta: -bet.amount, detail: pv + ' · te pasas' };
      if (pbj && !dealerBj) return { delta: Math.floor(bet.amount * 1.5), detail: '¡BLACKJACK!' };
      if (dealerBj && !pbj) return { delta: -bet.amount, detail: 'Blackjack del crupier' };
      if (dv > 21 || pv > dv) return { delta: bet.amount, detail: pv + ' gana a ' + dv };
      if (pv === dv) return { delta: 0, detail: 'Empate a ' + pv };
      return { delta: -bet.amount, detail: pv + ' pierde con ' + dv };
    };
    return { outcome: 'Crupier ' + dv, a: one('a'), b: one('b') };
  },
};

const MODULES: Record<string, GameModule> = { roulette, dice, blackjack };

export function moduleFor(def: GameDef): GameModule {
  const m = MODULES[def.kind];
  if (!m) throw new Error('Juego sin módulo: ' + def.kind);
  return m;
}
