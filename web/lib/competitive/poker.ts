/**
 * Valorar manos de póker (Texas Hold'em): la mejor jugada de 5 cartas entre 7.
 * Cartas como "As", "10h", "Kd" (rango + palo s/h/d/c).
 */

export interface PokerHand {
  /** 8 escalera de color … 0 carta alta. */
  rank: number;
  /** Para desempatar, de más a menos importante. */
  kickers: number[];
  name: string;
}

const NAMES = ['Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color'];

function valueOf(card: string): number {
  const r = card.slice(0, -1);
  if (r === 'A') return 14;
  if (r === 'K') return 13;
  if (r === 'Q') return 12;
  if (r === 'J') return 11;
  return Number(r) || 0;
}

const suitOf = (card: string) => card.slice(-1);

function straightHigh(values: number[]): number {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!set.has(hi - k)) { ok = false; break; }
    if (ok) return hi;
  }
  return 0;
}

function five(cards: string[]): PokerHand {
  const v = cards.map(valueOf).sort((x, y) => y - x);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const sh = straightHigh(v);
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  // Grupos ordenados por tamaño y luego por valor.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const by = groups.map((g) => g[0]);
  const make = (rank: number, kickers: number[]): PokerHand => ({ rank, kickers, name: NAMES[rank] });

  if (flush && sh) return make(8, [sh]);
  if (groups[0][1] === 4) return make(7, by);
  if (groups[0][1] === 3 && groups[1][1] === 2) return make(6, by);
  if (flush) return make(5, v);
  if (sh) return make(4, [sh]);
  if (groups[0][1] === 3) return make(3, by);
  if (groups[0][1] === 2 && groups[1][1] === 2) return make(2, by);
  if (groups[0][1] === 2) return make(1, by);
  return make(0, v);
}

/** >0 si gana a, <0 si gana b, 0 empate. */
export function compareHands(a: PokerHand, b: PokerHand): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const d = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** La mejor jugada posible con estas cartas (de 2 a 7). */
export function bestHand(cards: string[]): PokerHand {
  if (cards.length <= 5) {
    if (cards.length === 5) return five(cards);
    // Con menos de 5 (flop sin ver): solo parejas, tríos… sin escalera ni color.
    const v = cards.map(valueOf).sort((x, y) => y - x);
    const counts = new Map<number, number>();
    for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const rank = groups[0][1] === 4 ? 7 : groups[0][1] === 3 ? 3 : groups[0][1] === 2 ? (groups[1] && groups[1][1] === 2 ? 2 : 1) : 0;
    return { rank, kickers: groups.map((g) => g[0]), name: NAMES[rank] };
  }
  let best: PokerHand | null = null;
  const n = cards.length;
  const consider = (pick: string[]) => {
    const h = five(pick);
    if (!best || compareHands(h, best) > 0) best = h;
  };
  if (n === 6) {
    for (let a = 0; a < n; a++) consider(cards.filter((_, i) => i !== a));
  } else {
    // 7 (o más): quitar 2 cartas deja 5.
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) consider(cards.filter((_, i) => i !== a && i !== b).slice(0, 5));
  }
  return best ?? five(cards.slice(0, 5));
}
