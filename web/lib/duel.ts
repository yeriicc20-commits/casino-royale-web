import { randomInt } from 'crypto';

/**
 * Blackjack de uno contra uno, sin crupier.
 *
 * Las cartas usan el mismo identificador que el juego (`Card.Id` en Unity):
 * rango ("A", "2".."10", "J", "Q", "K") seguido del palo en minuscula
 * ("s", "h", "d", "c"). Asi el juego puede pintar cada carta tal cual llega.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['s', 'h', 'd', 'c'];

/** Un mazo barajado con el generador criptografico (no Math.random). */
export function shuffledDeck(): string[] {
  const deck: string[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankOf(card: string): string {
  return card.slice(0, card.length - 1);
}

/** Lo que vale una mano: los ases cuentan 11 mientras no se pase. */
export function handValue(cards: string[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 'A') { total += 11; aces++; }
    else if (r === 'J' || r === 'Q' || r === 'K') total += 10;
    else total += Number(r) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function isBlackjack(cards: string[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/**
 * Quien gana: 'challenger', 'opponent' o 'push'.
 * Pasarse pierde; los dos pasados es empate. Un blackjack (21 con dos cartas)
 * gana a un 21 con mas cartas.
 */
export function winnerOf(a: string[], b: string[]): 'challenger' | 'opponent' | 'push' {
  const va = handValue(a);
  const vb = handValue(b);
  const bustA = va > 21;
  const bustB = vb > 21;
  if (bustA && bustB) return 'push';
  if (bustA) return 'opponent';
  if (bustB) return 'challenger';
  const bjA = isBlackjack(a);
  const bjB = isBlackjack(b);
  if (bjA && !bjB) return 'challenger';
  if (bjB && !bjA) return 'opponent';
  if (va > vb) return 'challenger';
  if (vb > va) return 'opponent';
  return 'push';
}
