/**
 * Una partida entre dos jugadores, como máquina de estados. Pura: el tiempo y el
 * azar entran como parámetros, así que se puede probar entera.
 *
 *   ready  → los dos ven el VS y pulsan COMENZAR (o pasa el tiempo)
 *   bet    → cada uno apuesta (a ciegas: no ve la apuesta del otro)
 *   play   → solo blackjack: cada uno juega su mano
 *   (se resuelve la ronda con la MISMA suerte para los dos y se pasa a la siguiente)
 *   done   → gana quien acaba con más fichas de partida
 *
 * Si alguien no apuesta a tiempo, esa ronda no juega. Si le pasa varias veces
 * seguidas, ha abandonado y pierde (no se puede escapar de una derrota
 * desconectándose: el reloj sigue corriendo en el servidor).
 */
import { handValue } from '@/lib/duel';
import { moduleFor, type Rng } from './games';
import { bestHand } from './poker';
import type { Bet, CompetitiveConfig, GameDef, MatchState, Mode, Side } from './types';

export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

export function newMatch(cfg: CompetitiveConfig, def: GameDef, mode: Mode, nowMs: number): MatchState {
  return {
    v: 1,
    game: def.id,
    mode,
    phase: 'ready',
    round: 1,
    rounds: def.rounds,
    stacks: { a: def.startStack, b: def.startStack },
    deadline: nowMs + cfg.ready.seconds * 1000,
    revealUntil: 0,
    ready: { a: false, b: false },
    bets: { a: null, b: null },
    misses: { a: 0, b: 0 },
    seen: { a: nowMs, b: nowMs },
    bj: null,
    pk: null,
    history: [],
    startedAt: nowMs,
    endedAt: 0,
    result: '',
    abandon: '',
  };
}

function finish(st: MatchState, nowMs: number) {
  st.phase = 'done';
  st.endedAt = nowMs;
  if (st.stacks.a > st.stacks.b) st.result = 'a';
  else if (st.stacks.b > st.stacks.a) st.result = 'b';
  else st.result = 'draw';
}

export function abandon(st: MatchState, side: Side | 'both', nowMs: number) {
  if (st.phase === 'done') return;
  st.phase = 'done';
  st.endedAt = nowMs;
  st.abandon = side;
  st.result = side === 'both' ? 'void' : other(side);
}

function openBetting(def: GameDef, st: MatchState, nowMs: number, reveal: boolean) {
  st.phase = 'bet';
  st.bets = { a: null, b: null };
  st.revealUntil = reveal ? nowMs + def.revealSeconds * 1000 : nowMs;
  st.deadline = st.revealUntil + def.decisionSeconds * 1000;
  // Sin fichas no se puede apostar: pasa sola.
  for (const s of ['a', 'b'] as Side[]) if (st.stacks[s] <= 0) st.bets[s] = { amount: 0 };
}

function resolveRound(cfg: CompetitiveConfig, def: GameDef, st: MatchState, rng: Rng, nowMs: number) {
  const mod = moduleFor(def);
  const r = mod.resolve(st, rng);
  st.stacks.a = Math.max(0, st.stacks.a + r.a.delta);
  st.stacks.b = Math.max(0, st.stacks.b + r.b.delta);
  st.history.push({
    round: st.round,
    outcome: r.outcome,
    a: { bet: st.bets.a?.amount ?? 0, delta: r.a.delta, detail: r.a.detail },
    b: { bet: st.bets.b?.amount ?? 0, delta: r.b.delta, detail: r.b.detail },
    cards: st.bj ? { dealer: [...st.bj.dealer], a: [...st.bj.hands.a.cards], b: [...st.bj.hands.b.cards] }
      : st.pk ? { dealer: [...st.pk.board], board: [...st.pk.board], a: [...st.pk.hole.a], b: [...st.pk.hole.b] } : undefined,
    bets: { a: st.bets.a ? { ...st.bets.a } : null, b: st.bets.b ? { ...st.bets.b } : null },
  } as MatchState['history'][number]);

  st.round++;
  const broke = st.stacks.a <= 0 || st.stacks.b <= 0;
  if (st.round > st.rounds || broke) {
    finish(st, nowMs);
    return;
  }
  st.bj = null;
  st.pk = null;
  openBetting(def, st, nowMs, true);
}

function startPlay(cfg: CompetitiveConfig, def: GameDef, st: MatchState, rng: Rng, nowMs: number) {
  const mod = moduleFor(def);
  const needsPlay = mod.start(st, rng);
  if (needsPlay) {
    st.phase = 'play';
    st.deadline = nowMs + def.playSeconds * 1000;
  } else {
    resolveRound(cfg, def, st, rng, nowMs);
  }
}

/**
 * Pone la partida al día: lo que el reloj haya decidido mientras nadie miraba
 * (tiempos agotados, rondas que se juegan solas, abandonos). Se llama en cada
 * petición de cualquiera de los dos.
 */
export function tick(cfg: CompetitiveConfig, def: GameDef, st: MatchState, nowMs: number, rng: Rng): boolean {
  let changed = false;
  for (let guard = 0; guard < 100 && st.phase !== 'done'; guard++) {
    if (st.phase === 'ready') {
      const both = st.ready.a && st.ready.b;
      if (both || nowMs >= st.deadline) {
        openBetting(def, st, both ? nowMs : st.deadline, false);
        changed = true;
        continue;
      }
      break;
    }

    if (st.phase === 'bet') {
      const both = st.bets.a !== null && st.bets.b !== null;
      if (!both && nowMs < st.deadline) break;
      if (!both) {
        // Tiempo agotado: quien no apostó, esa ronda no juega y suma un fallo.
        for (const s of ['a', 'b'] as Side[]) {
          if (st.bets[s] === null) { st.bets[s] = { amount: 0 }; st.misses[s]++; }
        }
        const limit = cfg.abandon.missesToAbandon;
        const outA = st.misses.a >= limit;
        const outB = st.misses.b >= limit;
        if (outA || outB) {
          abandon(st, outA && outB ? 'both' : outA ? 'a' : 'b', Math.min(nowMs, st.deadline));
          changed = true;
          break;
        }
      }
      // Lo que pasa después ocurre en el momento del plazo (o ahora, si los dos ya apostaron).
      startPlay(cfg, def, st, rng, both ? nowMs : st.deadline);
      changed = true;
      continue;
    }

    if (st.phase === 'play') {
      const mod = moduleFor(def);
      const done = (s: Side) => (mod.playDone ? mod.playDone(st, s) : true);
      if (done('a') && done('b')) {
        resolveRound(cfg, def, st, rng, nowMs);
        changed = true;
        continue;
      }
      if (nowMs < st.deadline) break;
      for (const s of ['a', 'b'] as Side[]) if (!done(s)) mod.autoPlay?.(st, s);
      resolveRound(cfg, def, st, rng, st.deadline);
      changed = true;
      continue;
    }
  }
  return changed;
}

export function setReady(st: MatchState, side: Side): string | null {
  if (st.phase !== 'ready') return null;
  st.ready[side] = true;
  return null;
}

/** Apuesta de un jugador (o pasar: amount 0). */
export function placeBet(def: GameDef, st: MatchState, side: Side, raw: Partial<Bet> & { pass?: boolean }, nowMs: number): string | null {
  if (st.phase !== 'bet') return 'Ahora no se apuesta.';
  if (nowMs < st.revealUntil - 500) return 'Espera a que termine la ronda anterior.';
  if (st.bets[side] !== null) return 'Ya has apostado esta ronda.';
  if (raw.pass) {
    st.bets[side] = { amount: 0 };
    st.misses[side] = 0;
    return null;
  }
  const bet = moduleFor(def).validate(raw, st.stacks[side], def);
  if (typeof bet === 'string') return bet;
  st.bets[side] = bet;
  st.misses[side] = 0;
  return null;
}

export function playAction(def: GameDef, st: MatchState, side: Side, action: string): string | null {
  if (st.phase !== 'play') return 'Ahora no se juega la mano.';
  const mod = moduleFor(def);
  if (!mod.act) return 'Este juego no tiene jugadas.';
  return mod.act(st, side, action);
}

// ---------------------------------------------------------------------------- lo que ve cada uno

const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export function viewFor(def: GameDef, st: MatchState, side: Side, nowMs: number) {
  const o = other(side);
  const last = st.history.length ? st.history[st.history.length - 1] : null;
  const bj = st.bj;
  const pk = st.pk ?? null;
  const myHand = bj ? bj.hands[side] : null;
  const myBet = st.bets[side];
  const playing = st.phase === 'play';
  // Cara a cara: arriba se ven las cartas del RIVAL (blackjack, la primera boca
  // arriba y el resto tapadas) o la MESA (póker: el flop mientras se decide).
  const top: string[] = def.kind === 'poker'
    ? (pk ? (playing ? [...pk.board.slice(0, 3), 'back', 'back'] : pk.board) : [])
    : bj ? (playing ? bj.hands[o].cards.map((c, i) => (i === 0 ? c : 'back')) : bj.hands[o].cards) : [];
  const mine: string[] = def.kind === 'poker' ? (pk ? pk.hole[side] : []) : myHand ? myHand.cards : [];
  const lastTop = last?.cards ? (def.kind === 'poker' ? (last.cards.board ?? []) : last.cards[o]) : [];
  return {
    game: st.game,
    mode: st.mode,
    phase: st.phase,
    round: Math.min(st.round, st.rounds),
    rounds: st.rounds,
    myStack: st.stacks[side],
    theirStack: st.stacks[o],
    startStack: def.startStack,
    minBet: def.minBet,
    secondsLeft: st.phase === 'done' ? 0 : secs(st.deadline - nowMs),
    revealSecondsLeft: secs(st.revealUntil - nowMs),
    myReady: st.ready[side],
    theirReady: st.ready[o],
    myBetPlaced: myBet !== null,
    myBetAmount: myBet?.amount ?? 0,
    myBetType: myBet?.type ?? '',
    myBetNumber: myBet?.number ?? -1,
    myBetChance: myBet?.chance ?? 0,
    // La apuesta del otro es secreta hasta que se resuelve la ronda.
    theirBetPlaced: st.bets[o] !== null,
    kind: def.kind,
    hasHand: mine.length > 0,
    dealerCards: top,
    myCards: mine,
    myTotal: myHand ? handValue(myHand.cards) : 0,
    myHandName: pk ? bestHand([...pk.hole[side], ...pk.board.slice(0, 3)]).name : '',
    myDone: pk ? !!pk.choice[side] : myHand ? myHand.done : true,
    canDouble: false,
    theirCardCount: pk ? 2 : bj ? bj.hands[o].cards.length : 0,
    theirDone: pk ? !!pk.choice[o] : bj ? bj.hands[o].done : true,
    hasLast: !!last,
    lastRound: last?.round ?? 0,
    lastOutcome: last?.outcome ?? '',
    lastMyBet: last ? last[side].bet : 0,
    lastMyDelta: last ? last[side].delta : 0,
    lastMyDetail: last ? last[side].detail : '',
    lastTheirBet: last ? last[o].bet : 0,
    lastTheirDelta: last ? last[o].delta : 0,
    lastTheirDetail: last ? last[o].detail : '',
    lastDealer: lastTop,
    lastMyCards: last?.cards ? last.cards[side] : [],
    lastTheirCards: last?.cards ? last.cards[o] : [],
    history: st.history.map((h) => ({ round: h.round, outcome: h.outcome, myDelta: h[side].delta, theirDelta: h[o].delta })),
    result: st.result === '' ? '' : st.result === 'draw' || st.result === 'void' ? st.result : st.result === side ? 'win' : 'loss',
    abandoned: st.abandon === side || st.abandon === 'both',
    theyAbandoned: st.abandon === o || st.abandon === 'both',
    myMisses: st.misses[side],
  };
}
