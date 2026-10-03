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
import { handValue, isBlackjack, winnerOf } from '@/lib/duel';
import { bestHand, compareHands } from './poker';
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

/**
 * Cara a cara: lo que se juegan los dos es lo que apuesta el MÁS PRUDENTE (el
 * menor de las dos apuestas). Las fichas pasan de uno a otro; no hay casa.
 * Deja las dos apuestas en esa cantidad. 0 = alguien pasó y no hay duelo.
 */
function matchStake(st: MatchState): number {
  const a = st.bets.a?.amount ?? 0;
  const b = st.bets.b?.amount ?? 0;
  const stake = Math.max(0, Math.min(a, b));
  if (st.bets.a) st.bets.a.amount = stake;
  if (st.bets.b) st.bets.b.amount = stake;
  return stake;
}

const noDuel = (): { outcome: string; a: Settle; b: Settle } =>
  ({ outcome: 'Sin duelo', a: { delta: 0, detail: 'Alguien pasó: no se juega' }, b: { delta: 0, detail: 'Alguien pasó: no se juega' } });

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
    return typeof amount === 'string' ? amount : { amount };
  },
  start() { return false; },
  resolve(st, rng) {
    // Cara a cara: cada uno tira dos dados; la suma más alta se lleva lo apostado.
    const stake = matchStake(st);
    if (stake <= 0) return noDuel();
    const da = [1 + randInt(rng, 6), 1 + randInt(rng, 6)];
    const db = [1 + randInt(rng, 6), 1 + randInt(rng, 6)];
    const sa = da[0] + da[1];
    const sb = db[0] + db[1];
    const d = sa > sb ? stake : sa < sb ? -stake : 0;
    const word = (x: number) => (x > 0 ? '¡ganas!' : x < 0 ? 'pierdes' : 'empate');
    return {
      outcome: sa + ' contra ' + sb,
      a: { delta: d, detail: 'Sacas ' + sa + ' (' + da[0] + '+' + da[1] + ') · rival ' + sb + ' · ' + word(d) },
      b: { delta: -d, detail: 'Sacas ' + sb + ' (' + db[0] + '+' + db[1] + ') · rival ' + sa + ' · ' + word(-d) },
    };
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
    // Cara a cara y sin crupier: cada uno su mano, del mismo mazo (cartas distintas).
    const stake = matchStake(st);
    if (stake <= 0) { st.bj = null; return false; }
    const deck = shuffled(rng);
    st.bj = {
      dealer: [],
      dealerPile: [],
      pile: deck,
      hands: {
        a: { cards: [deck[0], deck[2]], done: false, doubled: false },
        b: { cards: [deck[1], deck[3]], done: false, doubled: false },
      },
      draws: { a: 4, b: 4 },
    };
    for (const s of ['a', 'b'] as Side[]) if (isBlackjack(st.bj.hands[s].cards)) st.bj.hands[s].done = true;
    return !(st.bj.hands.a.done && st.bj.hands.b.done);
  },
  act(st, side, action) {
    const bj = st.bj;
    if (!bj) return 'No hay mano.';
    const h = bj.hands[side];
    if (h.done) return 'Ya has terminado tu mano.';
    if (action === 'hit') {
      // Cada uno saca de su mitad del mazo: lo que pida uno no cambia las cartas del otro.
      const offset = side === 'a' ? 0 : 50;
      h.cards.push(bj.pile[offset + bj.draws[side]]);
      bj.draws[side]++;
      if (handValue(h.cards) >= 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      return 'En el cara a cara no se dobla.';
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
    const bj = st.bj;
    if (!bj) return noDuel();
    const stake = st.bets.a?.amount ?? 0;
    const ca = bj.hands.a.cards;
    const cb = bj.hands.b.cards;
    const va = handValue(ca);
    const vb = handValue(cb);
    const w = winnerOf(ca, cb);
    const d = w === 'challenger' ? stake : w === 'opponent' ? -stake : 0;
    const show = (v: number, cards: string[]) => (isBlackjack(cards) ? 'BLACKJACK' : v > 21 ? v + ' (te pasas)' : String(v));
    const word = (x: number) => (x > 0 ? '¡ganas!' : x < 0 ? 'pierdes' : 'empate');
    return {
      outcome: va + ' contra ' + vb,
      a: { delta: d, detail: show(va, ca) + ' contra ' + show(vb, cb) + ' · ' + word(d) },
      b: { delta: -d, detail: show(vb, cb) + ' contra ' + show(va, ca) + ' · ' + word(-d) },
    };
  },
};

// ---------------------------------------------------------------------------- póker

/**
 * Póker cara a cara (Texas Hold'em a una apuesta):
 *   1. Los dos ponen la misma ciega (la menor de las dos apuestas).
 *   2. Cada uno ve sus 2 cartas y el flop (3 de la mesa).
 *   3. Decide a la vez: SUBIR (pone otra ciega) o RETIRARSE.
 *      - Uno se retira y el otro sube: el que sube se lleva la ciega del otro.
 *      - Los dos se retiran: nadie gana nada.
 *      - Los dos suben: se ven las 5 cartas y la mejor jugada se lleva el doble.
 * Para poder subir, la ciega no puede pasar de la mitad de tus fichas.
 */
const poker: GameModule = {
  validate(raw, stack, def) {
    const amount = amountOf(raw, stack, def);
    if (typeof amount === 'string') return amount;
    if (amount * 2 > stack) return 'En póker la ciega es como mucho la mitad de tus fichas (para poder subir).';
    return { amount };
  },
  start(st, rng) {
    const stake = matchStake(st);
    if (stake <= 0) { st.pk = null; return false; }
    const deck = shuffled(rng);
    st.pk = { hole: { a: [deck[0], deck[2]], b: [deck[1], deck[3]] }, board: deck.slice(4, 9), choice: { a: '', b: '' } };
    return true;
  },
  act(st, side, action) {
    if (!st.pk) return 'No hay mano.';
    if (st.pk.choice[side]) return 'Ya has decidido.';
    if (action !== 'raise' && action !== 'fold') return 'Acción desconocida.';
    st.pk.choice[side] = action;
    return null;
  },
  autoPlay(st, side) {
    // Sin contestar a tiempo: se retira (como en una mesa de verdad).
    if (st.pk && !st.pk.choice[side]) st.pk.choice[side] = 'fold';
  },
  playDone(st, side) {
    return !st.pk || !!st.pk.choice[side];
  },
  resolve(st) {
    const pk = st.pk;
    if (!pk) return noDuel();
    const stake = st.bets.a?.amount ?? 0;
    const ra = pk.choice.a === 'raise';
    const rb = pk.choice.b === 'raise';
    const ha = bestHand([...pk.hole.a, ...pk.board]);
    const hb = bestHand([...pk.hole.b, ...pk.board]);
    if (!ra && !rb) {
      return { outcome: 'Los dos se retiran', a: { delta: 0, detail: 'Os retiráis los dos' }, b: { delta: 0, detail: 'Os retiráis los dos' } };
    }
    if (ra !== rb) {
      const d = ra ? stake : -stake;
      return {
        outcome: ra ? 'B se retira' : 'A se retira',
        a: { delta: d, detail: ra ? 'El rival se retira · ¡ganas su ciega!' : 'Te retiras · pierdes la ciega' },
        b: { delta: -d, detail: rb ? 'El rival se retira · ¡ganas su ciega!' : 'Te retiras · pierdes la ciega' },
      };
    }
    const c = compareHands(ha, hb);
    const d = c > 0 ? stake * 2 : c < 0 ? -stake * 2 : 0;
    const word = (x: number) => (x > 0 ? '¡ganas!' : x < 0 ? 'pierdes' : 'empate');
    return {
      outcome: ha.name + ' contra ' + hb.name,
      a: { delta: d, detail: ha.name + ' contra ' + hb.name + ' · ' + word(d) },
      b: { delta: -d, detail: hb.name + ' contra ' + ha.name + ' · ' + word(-d) },
    };
  },
};

const MODULES: Record<string, GameModule> = { roulette, dice, blackjack, poker };

export function moduleFor(def: GameDef): GameModule {
  const m = MODULES[def.kind];
  if (!m) throw new Error('Juego sin módulo: ' + def.kind);
  return m;
}
