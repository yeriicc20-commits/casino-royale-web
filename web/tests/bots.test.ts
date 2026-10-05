/**
 * Pruebas del sistema de bots (sin base de datos).
 *
 *   npm run test:bots
 *
 * El gestor (BotManager) corre de verdad, con un reloj simulado, contra unos
 * puertos en memoria que dan las mismas garantías que el SQL (emparejar es
 * atómico, guardar va con versión, el turno es de uno solo). Las partidas del
 * 1v1 usan el motor REAL (lib/competitive/match) y las rondas de eventos pasan
 * por la validación REAL (lib/events/engine.applyRounds).
 */
import assert from 'node:assert/strict';
import compRaw from '../lib/competitive/config.json';
import evRaw from '../lib/events/config.json';
import type { CompetitiveConfig, GameDef, MatchState, Side } from '../lib/competitive/types';
import { abandon, newMatch, placeBet, playAction, setReady, tick } from '../lib/competitive/match';
import { applyRounds, newState, pot } from '../lib/events/engine';
import { activeInstance, instanceById } from '../lib/events/schedule';
import type { EventsConfig, PlayerState, RoundIn } from '../lib/events/types';
import { handValue, isBlackjack, winnerOf } from '../lib/duel';
import { readBotsConfig, parseSchedule, DEFAULT_SCHEDULE, type BotsConfig } from '../lib/bots/config';
import { BET_LADDER_CENTS, MACHINES, MACHINE_IDS, chooseBet, playRound, startingWallet } from '../lib/bots/economy';
import {
  META, PREMIUM_PRICE_CENTS, collectGift, dayKey, emptyProgress, maybeBuyPremium, recordRounds, rollDay, spinWheel,
} from '../lib/bots/meta';
import { candidateUsername, generateUsername, isAcceptableUsername, potentialPoolSize } from '../lib/bots/names';
import { PERSONALITY_DEFS, defFor, pickPersonality } from '../lib/bots/personalities';
import { bandFor, eventPhaseAt, joinsNow, stepPopulation } from '../lib/bots/population';
import { BotManager } from '../lib/bots/manager';
import type { BotPorts, DuelSnapshot, MatchSnapshot, SearchResult } from '../lib/bots/ports';
import { seeded, type Rng } from '../lib/bots/random';
import { acceptDuelChance, matchMove } from '../lib/bots/strategy';
import { emptyRuntime, type Bot, type QueueMode, type Runtime, type World } from '../lib/bots/types';

const comp = compRaw as unknown as CompetitiveConfig;
const events = evRaw as unknown as EventsConfig;
const gameOf = (id: string) => comp.games.find((g) => g.id === id) as GameDef;

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log('ok  ' + name);
}

// Lunes 5-10-2026: 03:00 en España (tranquilo) y 17:10 (evento diario abierto).
const QUIET = Date.UTC(2026, 9, 5, 1, 0);
const EVENING = Date.UTC(2026, 9, 5, 15, 10);

function cfgWith(over: Partial<BotsConfig> = {}): BotsConfig {
  return { ...readBotsConfig({ BOTS_ENABLED: 'true' }), ...over };
}

// ============================================================================ puertos en memoria

interface MemMatch { id: string; def: GameDef; a: string; b: string; state: MatchState; status: 'live' | 'done'; settled: boolean }
interface MemDuel {
  id: string; challenger: string; opponent: string; stake: number; status: string; deck: string[];
  cc: string[]; oc: string[]; cd: boolean; od: boolean; result: string;
}
interface Ticket { playerId: string; gameId: string; mode: QueueMode; mmr: number; joinedAt: number; pingAt: number; matchId: string | null }

class MemoryPorts implements BotPorts {
  clock = 0;
  rng: Rng;
  bots = new Map<string, Bot>();
  runtime: Runtime = emptyRuntime();
  leaseOwner = '';
  leaseUntil = 0;
  presence = new Map<string, { balance: number; lastSeen: number; playing: string | null; title: string }>();
  queue = new Map<string, Ticket>();
  matches = new Map<string, MemMatch>();
  duels: MemDuel[] = [];
  grants: { player: string; cents: number; delivered: boolean }[] = [];
  friends = new Set<string>();
  humansOnline = 0;
  eventStates = new Map<string, PlayerState>();
  eventIgnored = 0;
  eventCounted = 0;
  names = new Set<string>(['danivega']);
  saves = 0;
  failNextSave = false;
  private seq = 0;

  constructor(seed: number) { this.rng = seeded(seed); }

  async lease(owner: string, seconds: number) {
    if (this.leaseOwner && this.leaseOwner !== owner && this.leaseUntil > this.clock) return false;
    this.leaseOwner = owner;
    this.leaseUntil = this.clock + seconds * 1000;
    return true;
  }
  async release(owner: string) { if (this.leaseOwner === owner) { this.leaseOwner = ''; this.leaseUntil = 0; } }
  async loadRuntime() { return structuredClone(this.runtime); }
  async saveRuntime(rt: Runtime) { this.runtime = structuredClone(rt); }
  async loadBots() { return [...this.bots.values()].map((b) => structuredClone(b)); }
  async saveBot(bot: Bot) {
    const cur = this.bots.get(bot.id);
    if (!cur || cur.version !== bot.version || this.failNextSave) { this.failNextSave = false; return false; }
    bot.version++;
    this.bots.set(bot.id, structuredClone(bot));
    this.saves++;
    return true;
  }
  async insertBot(bot: Bot) {
    if (this.bots.has(bot.id) || [...this.bots.values()].some((b) => b.username.toLowerCase() === bot.username.toLowerCase())) return false;
    this.bots.set(bot.id, structuredClone(bot));
    return true;
  }
  async takenNames() { return new Set(this.names); }
  async publish(bots: Bot[], now: number) {
    for (const b of bots) {
      const prev = this.presence.get(b.id);
      this.presence.set(b.id, {
        balance: b.walletCents, lastSeen: b.state !== 'OFFLINE' ? now : prev?.lastSeen ?? 0,
        playing: b.state !== 'OFFLINE' ? 'x' : null, title: b.progress.titleId,
      });
    }
  }
  balanceOf(id: string) {
    const base = this.presence.get(id)?.balance ?? this.bots.get(id)?.walletCents ?? 100_000;
    return base + this.grants.filter((g) => g.player === id && !g.delivered).reduce((n, g) => n + g.cents, 0);
  }
  async claimGrants(id: string) {
    let n = 0;
    for (const g of this.grants) if (g.player === id && !g.delivered) { g.delivered = true; n += g.cents; }
    return n;
  }
  async world(botIds: string[]): Promise<World & { pendingGrants: string[] }> {
    const ids = new Set(botIds);
    return {
      humansOnline: this.humansOnline,
      humanTickets: [...this.queue.values()]
        .filter((t) => !ids.has(t.playerId) && t.matchId === null && t.pingAt > this.clock - comp.matchmaking.ticketStaleSeconds * 1000)
        .map((t) => ({ playerId: t.playerId, gameId: t.gameId, mode: t.mode, mmr: t.mmr, joinedAt: t.joinedAt })),
      openDuels: this.duels.filter((d) => (d.status === 'pending' || d.status === 'active') && (ids.has(d.challenger) || ids.has(d.opponent)))
        .map((d) => ({
          id: d.id, challengerId: d.challenger, opponentId: d.opponent, stakeCents: d.stake, status: d.status as 'pending' | 'active',
          challengerCards: d.cc, opponentCards: d.oc, challengerDone: d.cd, opponentDone: d.od, updatedAt: this.clock,
        })),
      liveMatches: [...this.matches.values()].filter((m) => m.status === 'live')
        .flatMap((m) => [m.a, m.b].filter((p) => ids.has(p)).map((botId) => ({ botId, matchId: m.id, gameId: m.def.id }))),
      pendingGrants: [...new Set(this.grants.filter((g) => !g.delivered && ids.has(g.player)).map((g) => g.player))],
    };
  }

  // ---- 1v1 (emparejar es atómico: JavaScript no se interrumpe entre comprobar y apuntar)
  liveMatchOf(id: string) {
    return [...this.matches.values()].find((m) => m.status === 'live' && (m.a === id || m.b === id)) ?? null;
  }
  createMatch(game: string, mode: QueueMode, a: string, b: string) {
    const id = 'MATCH-' + (++this.seq);
    const def = gameOf(game);
    this.matches.set(id, { id, def, a, b, state: newMatch(comp, def, mode, this.clock), status: 'live', settled: false });
    return id;
  }
  async search(id: string, gameId: string, mode: QueueMode): Promise<SearchResult> {
    const live = this.liveMatchOf(id);
    if (live) { this.queue.delete(id); return { kind: 'match', matchId: live.id }; }
    const mine = this.queue.get(id);
    if (mine?.matchId) { this.queue.delete(id); return { kind: 'match', matchId: mine.matchId }; }
    if (!mine) this.queue.set(id, { playerId: id, gameId, mode, mmr: 1000, joinedAt: this.clock, pingAt: this.clock, matchId: null });
    else mine.pingAt = this.clock;
    const other = [...this.queue.values()].find((t) => t.playerId !== id && t.gameId === gameId && t.mode === mode && t.matchId === null
      && t.pingAt > this.clock - comp.matchmaking.ticketStaleSeconds * 1000);
    if (!other) return { kind: 'searching' };
    const matchId = this.createMatch(gameId, mode, id, other.playerId);
    other.matchId = matchId;
    this.queue.delete(id);
    return { kind: 'match', matchId };
  }
  async cancelSearch(id: string) { this.queue.delete(id); }
  async pairWith(id: string, target: string, gameId: string, mode: QueueMode) {
    const t = this.queue.get(target);
    if (!t || t.matchId || t.gameId !== gameId || t.mode !== mode || this.liveMatchOf(id)) return null;
    const matchId = this.createMatch(gameId, mode, target, id);
    t.matchId = matchId;
    return matchId;
  }
  async activeMatch(id: string) { return this.liveMatchOf(id)?.id ?? null; }
  snap(m: MemMatch, id: string, advance: boolean): MatchSnapshot {
    const side: Side = m.a === id ? 'a' : 'b';
    const state = structuredClone(m.state);
    if (advance) tick(comp, m.def, state, this.clock, () => 0.5);
    const r = m.state.result;
    const outcome = !m.settled ? '' : r === 'void' ? 'void' : r === 'draw' ? 'draw' : r === side ? 'win' : 'loss';
    return { matchId: m.id, side, def: m.def, state, status: m.status, settled: m.settled, outcome };
  }
  async readMatch(id: string, matchId: string) {
    const m = this.matches.get(matchId);
    return m && (m.a === id || m.b === id) ? this.snap(m, id, true) : null;
  }
  async applyMatch(id: string, matchId: string, move: Parameters<BotPorts['applyMatch']>[2]) {
    const m = this.matches.get(matchId);
    if (!m) return null;
    const side: Side = m.a === id ? 'a' : 'b';
    const st = m.state;
    tick(comp, m.def, st, this.clock, this.rng);
    st.seen[side] = this.clock;
    if (move === 'forfeit') abandon(st, side, this.clock);
    else if (move?.op === 'ready') setReady(st, side);
    else if (move?.op === 'bet') { const err = placeBet(m.def, st, side, move.bet, this.clock); if (err) this.moveErrors.push(err); }
    else if (move?.op === 'act') { const err = playAction(m.def, st, side, move.action); if (err) this.moveErrors.push(err); }
    tick(comp, m.def, st, this.clock, this.rng);
    if (st.phase === 'done' && !m.settled) {
      m.status = 'done';
      m.settled = true;
      for (const s of ['a', 'b'] as Side[]) {
        const who = s === 'a' ? m.a : m.b;
        if (st.result === s) this.grants.push({ player: who, cents: 1000, delivered: false });
      }
    }
    return this.snap(m, id, false);
  }
  moveErrors: string[] = [];
  /** Lo que haría una persona: mirar su partida y apostar/jugar a tiempo. */
  humanPlays(id: string) {
    const m = this.liveMatchOf(id);
    if (!m) return;
    const side: Side = m.a === id ? 'a' : 'b';
    tick(comp, m.def, m.state, this.clock, this.rng);
    const mv = matchMove(m.state, side, m.def, defFor('MIXED'), this.rng, this.clock);
    if (mv) void this.applyMatch(id, m.id, mv);
    else void this.applyMatch(id, m.id, null);
  }

  // ---- retos (las mismas reglas que lib/duel-service)
  async friendsOf(id: string) { return [...this.friends].filter((k) => k.startsWith(id + '|')).map((k) => k.split('|')[1]); }
  async befriend(id: string, other: string) { this.friends.add(id + '|' + other); this.friends.add(other + '|' + id); return true; }
  async createDuel(id: string, friend: string, stake: number) {
    if (!this.friends.has(id + '|' + friend) || stake < 50) return false;
    if (this.balanceOf(id) < stake || this.balanceOf(friend) < stake) return false;
    const deck = Array.from({ length: 52 }, (_, i) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][i % 13] + 'shdc'[Math.floor(i / 13)]);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const cc = [deck.pop()!, deck.pop()!];
    this.duels.push({ id: 'D' + (++this.seq), challenger: id, opponent: friend, stake, status: 'pending', deck, cc, oc: [], cd: isBlackjack(cc), od: false, result: '' });
    return true;
  }
  settle(d: MemDuel) {
    if (d.status !== 'active' || !d.cd || !d.od) return;
    d.status = 'done';
    d.result = winnerOf(d.cc, d.oc);
    if (d.result === 'push') return;
    const win = d.result === 'challenger' ? d.challenger : d.opponent;
    const lose = d.result === 'challenger' ? d.opponent : d.challenger;
    this.grants.push({ player: lose, cents: -d.stake, delivered: false }, { player: win, cents: d.stake, delivered: false });
  }
  async respondDuel(id: string, duelId: string, accept: boolean) {
    const d = this.duels.find((x) => x.id === duelId);
    if (!d || d.status !== 'pending') return false;
    if (d.opponent !== id) { if (!accept) d.status = 'cancelled'; return true; }
    if (!accept) { d.status = 'declined'; return true; }
    if (this.balanceOf(id) < d.stake) return false;
    d.oc = [d.deck.pop()!, d.deck.pop()!];
    d.od = isBlackjack(d.oc);
    d.status = 'active';
    this.settle(d);
    return true;
  }
  async actDuel(id: string, duelId: string, action: 'hit' | 'stand') {
    const d = this.duels.find((x) => x.id === duelId);
    if (!d) return false;
    const ch = d.challenger === id;
    if (ch ? d.cd : d.od) return false;
    if (action === 'hit') {
      const cards = ch ? d.cc : d.oc;
      cards.push(d.deck.pop()!);
      if (handValue(cards) >= 21) { if (ch) d.cd = true; else d.od = true; }
    } else if (ch) d.cd = true; else d.od = true;
    this.settle(d);
    return true;
  }
  async duel(id: string, duelId: string): Promise<DuelSnapshot | null> {
    const d = this.duels.find((x) => x.id === duelId);
    if (!d) return null;
    const ch = d.challenger === id;
    const outcome = d.status !== 'done' ? '' : d.result === 'push' ? 'push' : (d.result === 'challenger') === ch ? 'win' : 'lose';
    return { id: d.id, status: d.status, role: ch ? 'challenger' : 'opponent', stakeCents: d.stake, myCards: ch ? d.cc : d.oc, myDone: ch ? d.cd : d.od, outcome };
  }

  // ---- eventos: la validación y los puntos son los REALES
  async reportEvent(id: string, instanceId: string, reportId: string, rounds: RoundIn[]) {
    const inst = instanceById(events, instanceId)!;
    const def = events.events[inst.eventId];
    const st = this.eventStates.get(id) ?? newState(def);
    const r = applyRounds(events, def, inst, st, rounds, this.clock, this.rng, 'secret', reportId);
    this.eventStates.set(id, st);
    this.eventIgnored += r.ignored;
    this.eventCounted += r.counted;
    return { counted: r.counted, pot: def.kind === 'risk' ? pot(def, st) : 0, canChest: false };
  }
  async eventRisk() { return true; }
  async eventChest() { return true; }
  async claimEvents() { return 0; }
}

/** Corre el gestor con el reloj simulado, como lo haría el worker. */
async function run(manager: BotManager, ports: MemoryPorts, from: number, ms: number, hooks?: (now: number) => void) {
  let now = from;
  const end = from + ms;
  const reports = [];
  while (now < end) {
    ports.clock = now;
    hooks?.(now);
    const r = await manager.tick(now);
    reports.push(r);
    now += Math.max(250, r.nextInMs);
  }
  return { now, reports };
}

const online = (p: MemoryPorts) => [...p.bots.values()].filter((b) => b.state !== 'OFFLINE');

// ============================================================================ pruebas

async function main() {
  await test('configuración: apagado por defecto, BOTS_* leídos y franjas mal escritas ignoradas', () => {
    const off = readBotsConfig({});
    assert.equal(off.enabled, false);
    assert.equal(off.minOnline, 3);
    assert.equal(off.maxOnline, 50);
    const on = readBotsConfig({ BOTS_ENABLED: 'true', BOTS_MIN_ONLINE: '5', BOTS_MAX_ONLINE: '20', BOTS_ALLOW_EVENTS: 'false', BOTS_ALLOW_HUMAN_1V1: '0' });
    assert.equal(on.enabled, true);
    assert.equal(on.minOnline, 5);
    assert.equal(on.maxOnline, 20);
    assert.equal(on.allowEvents, false);
    assert.equal(on.allowHuman1v1, false);
    assert.equal(parseSchedule('no es json'), DEFAULT_SCHEDULE);
    assert.equal(parseSchedule('[{"from":5,"to":3,"min":1,"max":2}]'), DEFAULT_SCHEDULE);
    assert.deepEqual(parseSchedule('[{"from":0,"to":24,"min":4,"max":9}]'), [{ from: 0, to: 24, min: 4, max: 9 }]);
  });

  await test('nombres: únicos, creíbles, sin palabras de bot, y un pool de miles', () => {
    const rng = seeded(1);
    const taken = new Set<string>();
    const names: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const n = generateUsername(rng, taken);
      assert.ok(n, 'se quedó sin nombres');
      names.push(n);
    }
    assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
    for (const n of names) {
      assert.ok(isAcceptableUsername(n), n);
      assert.ok(!/bot|test|player|casino|computer|user/i.test(n), n);
      assert.ok(n.length >= 3 && n.length <= 16, n);
    }
    // Variedad de formas: con número, con guion bajo, con mayúscula en medio, todo minúsculas, xNombre, GG...
    const shapes = new Set(names.map((n) => n.replace(/[A-Z]/g, 'A').replace(/[a-z]+/g, 'a').replace(/\d+/g, '9')));
    assert.ok(shapes.size >= 12, 'pocas formas: ' + shapes.size);
    assert.ok(names.some((n) => n.endsWith('GG')));
    assert.ok(names.some((n) => n.includes('_')));
    assert.ok(names.some((n) => /^x[A-Z]/.test(n)));
    assert.ok(potentialPoolSize() > 20000);
    // Nunca uno cogido (en cualquier mayúscula/minúscula).
    const t2 = new Set(['danivega']);
    for (let i = 0; i < 500; i++) assert.notEqual(generateUsername(rng, t2)?.toLowerCase(), 'danivega');
    // Tampoco secuenciales: no hay dos seguidos que solo cambien en el número final.
    assert.ok(!names.some((n, i) => i > 0 && n.replace(/\d+$/, '') === names[i - 1].replace(/\d+$/, '') && n !== names[i - 1] && /\d$/.test(n) && Number(n.match(/\d+$/)![0]) === Number(names[i - 1].match(/\d+$/)?.[0] ?? -9) + 1));
    assert.ok(candidateUsername(rng).length > 0);
  });

  await test('personalidades: las siete salen y no se parecen entre sí', () => {
    const rng = seeded(2);
    const count: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) { const p = pickPersonality(rng); count[p] = (count[p] ?? 0) + 1; }
    assert.equal(Object.keys(count).length, 7);
    assert.ok(count.CASUAL > count.HIGH_ROLLER);
    assert.ok(PERSONALITY_DEFS.EVENT_PLAYER.eventInterest > PERSONALITY_DEFS.CASUAL.eventInterest * 4);
    assert.ok(PERSONALITY_DEFS.DUEL_PLAYER.duelInterest > PERSONALITY_DEFS.MIXED.duelInterest);
    assert.ok(PERSONALITY_DEFS.HIGH_ROLLER.betFraction > PERSONALITY_DEFS.LOW_RISK.betFraction * 5);
    assert.ok(PERSONALITY_DEFS.CASUAL.sessionMinutes.median < PERSONALITY_DEFS.ACTIVE.sessionMinutes.median);
  });

  await test('apuestas: pequeñas más habituales, variadas, dentro del saldo, y más de 500 € si el saldo lo aguanta', () => {
    const rng = seeded(3);
    const casual = defFor('CASUAL');
    const bets: number[] = [];
    for (let i = 0; i < 4000; i++) bets.push(chooseBet(rng, casual, 120_000, 'roulette')!);
    assert.ok(bets.every((b) => b > 0 && b <= 120_000));
    assert.ok(new Set(bets).size >= 6, 'poca variedad');
    const small = bets.filter((b) => b <= 1000).length;
    const big = bets.filter((b) => b >= 5000).length;
    assert.ok(small > big * 3, `pequeñas ${small} vs grandes ${big}`);
    // Ningún bot apuesta 10, 10, 10, 10...
    let same = 0;
    for (let i = 1; i < bets.length; i++) if (bets[i] === bets[i - 1]) same++;
    assert.ok(same < bets.length * 0.6);

    const hr = defFor('HIGH_ROLLER');
    const rich: number[] = [];
    for (let i = 0; i < 3000; i++) rich.push(chooseBet(rng, hr, 5_000_000, 'blackjack')!);
    assert.ok(rich.some((b) => b > 50_000), 'un high roller con 50.000 € nunca pasó de 500 €');
    assert.ok(Math.max(...rich) <= 5_000_000 * hr.maxBetFraction + 1);
    // Sin saldo para la mínima, no apuesta.
    assert.equal(chooseBet(rng, casual, 40, 'slots'), null);
    assert.equal(chooseBet(rng, casual, 499, 'slots'), null);
    // Mínimo del evento respetado.
    for (let i = 0; i < 200; i++) assert.ok(chooseBet(rng, casual, 100_000, 'roulette', 500)! >= 500);
    assert.ok(BET_LADDER_CENTS.includes(25) && BET_LADDER_CENTS.includes(50000) && BET_LADDER_CENTS.includes(1000000));
  });

  await test('máquinas: devuelven lo de un casino (RTP entre 85 % y 100 %) y nunca más de x1000', () => {
    const rng = seeded(4);
    for (const id of MACHINE_IDS) {
      let staked = 0;
      let back = 0;
      for (let i = 0; i < 120_000; i++) {
        const r = playRound(rng, id, 100, 0.4);
        assert.ok(r >= 0 && r <= 100_000);
        staked += 100;
        back += r;
      }
      const rtp = back / staked;
      assert.ok(rtp > 0.85 && rtp < 1.0, id + ' RTP ' + rtp.toFixed(3));
    }
  });

  await test('saldos iniciales coherentes y distintos (nada de 1000 € para todos)', () => {
    const rng = seeded(5);
    const w = Array.from({ length: 500 }, () => startingWallet(rng, defFor(pickPersonality(rng))));
    assert.ok(new Set(w).size > 480);
    assert.ok(w.every((x) => x >= 15_000 && x <= 12_000_100));
    const median = [...w].sort((a, b) => a - b)[250];
    assert.ok(median > 50_000 && median < 600_000, 'mediana ' + median);
  });

  await test('población: franja según la hora, sube poco a poco y nunca entra más de uno de golpe', () => {
    const cfg = cfgWith();
    const quiet = bandFor(cfg, QUIET, false);
    const evening = bandFor(cfg, EVENING, true);
    assert.ok(quiet.max <= 12 && quiet.min >= 3, JSON.stringify(quiet));
    assert.ok(evening.min >= 25 && evening.max <= 50, JSON.stringify(evening));
    // Con evento hay más gente; con el semanal, más todavía; y antes de abrir ya va subiendo.
    const noon = Date.UTC(2026, 9, 5, 11, 0); // lunes 13:00
    const plain = bandFor(cfg, noon, null);
    const daily = bandFor(cfg, noon, { slot: 'daily', soon: false });
    const weekly = bandFor(cfg, noon, { slot: 'weekly', soon: false });
    const soon = bandFor(cfg, noon, { slot: 'daily', soon: true });
    assert.ok(daily.min > plain.min && daily.max > plain.max, JSON.stringify([plain, daily]));
    assert.ok(weekly.min >= daily.min && weekly.max >= daily.max, JSON.stringify([daily, weekly]));
    assert.ok(soon.min >= plain.min && soon.min <= daily.min);
    assert.equal(eventPhaseAt(events, EVENING)?.slot, 'daily');
    assert.equal(eventPhaseAt(events, Date.UTC(2026, 9, 5, 14, 50))?.soon, true); // 16:50 en España
    assert.equal(eventPhaseAt(events, Date.UTC(2026, 9, 10, 10, 0))?.slot, 'weekly'); // sábado 12:00
    assert.equal(eventPhaseAt(events, QUIET), null);
    const rng = seeded(6);
    const rt = emptyRuntime();
    let online = 0;
    let maxJoin = 0;
    const seen: number[] = [];
    for (let t = EVENING; t < EVENING + 3 * 3600_000; t += 1000) {
      stepPopulation(rt, cfg, t, rng, true);
      const j = joinsNow(rt, cfg, online, t, rng);
      if (online >= cfg.minOnline) maxJoin = Math.max(maxJoin, j);
      online += j;
      if (online > rt.target + 1) online--; // salidas
      seen.push(rt.target);
      assert.ok(rt.target >= 3 && rt.target <= 50);
    }
    assert.equal(maxJoin, 1);
    assert.ok(new Set(seen).size >= 10, 'el objetivo casi no se mueve');
    // Pasos pequeños: nunca salta más de 3 de una vez.
    for (let i = 1; i < seen.length; i++) assert.ok(Math.abs(seen[i] - seen[i - 1]) <= 3);
  });

  await test('gestor: al menos 3 conectados enseguida, nunca más de 50, y la cifra no es fija', async () => {
    const ports = new MemoryPorts(7);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 40, max: 50 }] });
    const manager = new BotManager(ports, cfg, seeded(70), 'bm-a');
    ports.clock = QUIET;
    await manager.tick(QUIET);
    assert.ok(online(ports).length >= 3, 'al arrancar no llegó al mínimo');
    const counts: number[] = [];
    await run(manager, ports, QUIET + 1000, 90 * 60_000, () => counts.push(online(ports).length));
    assert.ok(Math.max(...counts) <= 50, 'más de 50: ' + Math.max(...counts));
    assert.ok(Math.min(...counts) >= 3);
    assert.ok(Math.max(...counts) >= 35, 'no subió: ' + Math.max(...counts));
    assert.ok(new Set(counts.slice(-2000)).size >= 3, 'siempre el mismo número');
    // Subió poco a poco: nunca dos más de una vuelta a otra (por encima del mínimo).
    for (let i = 1; i < counts.length; i++) if (counts[i - 1] >= 3) assert.ok(counts[i] - counts[i - 1] <= 1, `salto de ${counts[i - 1]} a ${counts[i]}`);
    assert.ok(ports.bots.size <= cfg.poolSize);
    // Nombres únicos en la población entera, y el que ya existía no se repite.
    const names = [...ports.bots.values()].map((b) => b.username.toLowerCase());
    assert.equal(new Set(names).size, names.length);
    assert.ok(!names.includes('danivega'));
  });

  await test('sesiones: se conectan, se desconectan, vuelven más tarde y hacen de todo', async () => {
    const ports = new MemoryPorts(8);
    ports.humansOnline = 2;
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 12, max: 20 }], poolSize: 30 });
    const manager = new BotManager(ports, cfg, seeded(80), 'bm-s');
    const states = new Map<string, number>();
    const gaps: number[] = [];
    const last = new Map<string, number>();
    await run(manager, ports, QUIET, 5 * 3600_000, () => {
      for (const b of ports.bots.values()) {
        states.set(b.state, (states.get(b.state) ?? 0) + 1);
        const prev = last.get(b.id);
        if (prev !== undefined && prev !== b.nextActionAt && b.nextActionAt > ports.clock) gaps.push(b.nextActionAt - ports.clock);
        last.set(b.id, b.nextActionAt);
      }
    });
    const all = [...ports.bots.values()];
    assert.ok(all.some((b) => b.stats.sessions >= 2), 'nadie volvió después de irse');
    assert.ok(all.some((b) => b.state === 'OFFLINE'), 'nadie se ha ido');
    for (const s of ['IDLE', 'BROWSING', 'PLAYING', 'COOLDOWN', 'LOOKING_FOR_DUEL', 'IN_DUEL']) assert.ok((states.get(s) ?? 0) > 0, 'nunca en ' + s);
    assert.ok(all.every((b) => b.walletCents >= 0), 'saldo negativo');
    assert.ok(all.reduce((n, b) => n + b.stats.roundsPlayed, 0) > 500, 'casi no juegan');
    assert.ok(all.some((b) => b.stats.matches > 0), 'ningún 1v1 terminado');
    // Ritmo propio: retardos muy repartidos, no "cada 5 s".
    const distinct = new Set(gaps.map((g) => Math.round(g / 100)));
    assert.ok(distinct.size > 200, 'retardos poco variados: ' + distinct.size);
    // Presencia publicada dentro de la ventana de "conectado".
    for (const b of online(ports)) assert.ok(ports.clock - (ports.presence.get(b.id)?.lastSeen ?? 0) < 40_000, b.username + ' sin latido');
    assert.equal(ports.moveErrors.filter((e) => !/Ahora no|Ya has|Espera/.test(e)).length, 0, ports.moveErrors.join(' | '));
  });

  await test('eventos: entran unos sí y otros no, y sus rondas pasan la validación real del servidor', async () => {
    const ports = new MemoryPorts(9);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 25, max: 30 }], allow1v1: false });
    const manager = new BotManager(ports, cfg, seeded(90), 'bm-e');
    const inEvent = new Set<string>();
    await run(manager, ports, EVENING - 20 * 60_000, 45 * 60_000, () => {
      for (const b of ports.bots.values()) if (b.state === 'EVENT') inEvent.add(b.id);
    });
    assert.ok(activeInstance(events, EVENING));
    assert.ok(inEvent.size >= 3, 'casi nadie entró: ' + inEvent.size);
    assert.ok(inEvent.size < ports.bots.size, 'entraron TODOS');
    assert.ok(ports.eventCounted > 50, 'rondas contadas: ' + ports.eventCounted);
    assert.equal(ports.eventIgnored, 0, 'el servidor rechazó rondas de bots');
    // Los EVENT_PLAYER entran mucho más que los CASUAL.
    const rate = (p: string) => {
      const list = [...ports.bots.values()].filter((b) => b.personality === p);
      return list.length ? list.filter((b) => inEvent.has(b.id)).length / list.length : -1;
    };
    if (rate('EVENT_PLAYER') >= 0 && rate('CASUAL') >= 0) assert.ok(rate('EVENT_PLAYER') >= rate('CASUAL'));
    // Ninguno sigue "en el evento" cuando ya ha cerrado.
    await run(manager, ports, EVENING + 55 * 60_000, 10 * 60_000);
    assert.ok([...ports.bots.values()].every((b) => b.state !== 'EVENT'));
  });

  await test('1v1 BOT vs BOT: las jugadas de los bots son válidas en el motor real y la partida termina', async () => {
    const rng = seeded(10);
    for (const game of ['roulette', 'blackjack', 'dice', 'poker']) {
      for (let n = 0; n < 40; n++) {
        const def = gameOf(game);
        const st = newMatch(comp, def, 'competitive', 0);
        let now = 0;
        const errors: string[] = [];
        while (st.phase !== 'done' && now < 30 * 60_000) {
          now += 700;
          tick(comp, def, st, now, rng);
          for (const side of ['a', 'b'] as Side[]) {
            const mv = matchMove(st, side, def, defFor(side === 'a' ? 'HIGH_ROLLER' : 'LOW_RISK'), rng, now);
            if (!mv) continue;
            const err = mv.op === 'ready' ? setReady(st, side) : mv.op === 'bet' ? placeBet(def, st, side, mv.bet, now) : playAction(def, st, side, mv.action);
            if (err) errors.push(err);
          }
          tick(comp, def, st, now, rng);
        }
        assert.equal(st.phase, 'done', game + ' no terminó');
        assert.notEqual(st.abandon, 'a');
        assert.notEqual(st.abandon, 'b');
        assert.deepEqual(errors, [], game + ': ' + errors.join(', '));
      }
    }
  });

  await test('HUMANO vs BOT: no acepta al instante, solo un bot se lo queda y juega la partida entera', async () => {
    const ports = new MemoryPorts(11);
    ports.humansOnline = 1;
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 15, max: 15 }] });
    const manager = new BotManager(ports, cfg, seeded(110), 'bm-h');
    await run(manager, ports, QUIET, 3 * 60_000);
    // Que ningún bot esté buscando para que el emparejamiento sea por "aceptar".
    for (const b of ports.bots.values()) if (b.activity.kind === 'queue') { b.state = 'IDLE'; b.activity = {}; ports.queue.delete(b.id); }

    let paired = 0;
    let firstAt = 0;
    let t0 = 0;
    for (let attempt = 0; attempt < 8 && !paired; attempt++) {
      const start = ports.clock + 1000;
      t0 = start;
      ports.queue.set('human-1', { playerId: 'human-1', gameId: 'roulette', mode: 'casual', mmr: 1000, joinedAt: start, pingAt: start, matchId: null });
      await run(manager, ports, start, 85_000, (now) => {
        const t = ports.queue.get('human-1');
        if (t && !t.matchId) t.pingAt = now; // la persona sigue buscando
        if (!firstAt && t?.matchId) { firstAt = now; paired++; }
      });
      if (!paired) ports.queue.delete('human-1');
    }
    assert.ok(paired, 'ningún bot aceptó en 8 intentos');
    assert.ok(firstAt - t0 >= 4000, 'aceptó en menos de 4 s');
    const match = [...ports.matches.values()].find((m) => m.a === 'human-1' || m.b === 'human-1')!;
    const botId = match.a === 'human-1' ? match.b : match.a;
    assert.equal([...ports.matches.values()].filter((m) => m.a === 'human-1' || m.b === 'human-1').length, 1, 'dos bots se llevaron el mismo desafío');
    // La persona y el bot juegan hasta el final.
    await run(manager, ports, ports.clock, 8 * 60_000, () => ports.humanPlays('human-1'));
    assert.equal(match.status, 'done');
    assert.notEqual(match.state.abandon, match.a === botId ? 'a' : 'b', 'el bot abandonó');
    assert.ok(ports.bots.get(botId)!.stats.matches >= 1);
  });

  await test('desafío ya aceptado: si otro llega antes, el bot lo deja y no se queda colgado', async () => {
    const ports = new MemoryPorts(12);
    ports.queue.set('human-2', { playerId: 'human-2', gameId: 'dice', mode: 'casual', mmr: 1000, joinedAt: 0, pingAt: 0, matchId: null });
    assert.ok(await ports.pairWith('b1', 'human-2', 'dice', 'casual'));
    assert.equal(await ports.pairWith('b2', 'human-2', 'dice', 'casual'), null);
    // Y en el gestor: el que se lo pensaba vuelve a lo suyo.
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 6, max: 6 }] });
    const manager = new BotManager(ports, cfg, seeded(120), 'bm-x');
    await run(manager, ports, QUIET, 60_000);
    const t = QUIET + 61_000;
    ports.queue.set('human-3', { playerId: 'human-3', gameId: 'roulette', mode: 'casual', mmr: 1000, joinedAt: t, pingAt: t, matchId: null });
    await run(manager, ports, t, 3000, (now) => { ports.queue.get('human-3')!.pingAt = now; });
    const thinking = [...ports.bots.values()].find((b) => b.activity.target === 'human-3');
    assert.ok(thinking, 'ningún bot lo vio');
    ports.queue.get('human-3')!.matchId = 'MATCH-otro'; // otra persona se lo lleva
    await run(manager, ports, t + 3000, 40_000);
    const after = ports.bots.get(thinking.id)!;
    assert.notEqual(after.activity.target, 'human-3');
    assert.ok(!ports.liveMatchOf(thinking.id));
  });

  await test('retos de blackjack: una persona reta a un bot, se lo piensa, acepta, juega y cobra/paga por la cola', async () => {
    const ports = new MemoryPorts(13);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 4, max: 4 }], allow1v1: false });
    const manager = new BotManager(ports, cfg, seeded(130), 'bm-d');
    await run(manager, ports, QUIET, 30_000);
    const bot = manager.snapshot().find((b) => b.state !== 'OFFLINE')!;
    (bot as Bot).sessionEndsAt = Number.MAX_SAFE_INTEGER; // que no se vaya a mitad de la prueba
    ports.presence.set('human-9', { balance: 500_000, lastSeen: ports.clock, playing: null, title: '' });
    await ports.befriend('human-9', bot.id);
    const before = ports.bots.get(bot.id)!.walletCents;
    let answered = false;
    for (let i = 0; i < 6 && !answered; i++) {
      assert.ok(await ports.createDuel('human-9', bot.id, 200));
      const duel = ports.duels[ports.duels.length - 1];
      void ports.actDuel('human-9', duel.id, 'stand');
      const sent = ports.clock;
      let at = 0;
      await run(manager, ports, ports.clock, 90_000, (now) => { if (!at && duel.status !== 'pending') at = now; });
      assert.ok(duel.status !== 'pending', 'el bot ni contestó');
      if (duel.status === 'declined') continue;
      answered = true;
      assert.ok(at - sent >= 4000, 'aceptó al instante');
      assert.equal(duel.status, 'done', 'el bot no terminó su mano');
    }
    assert.ok(answered, 'rechazó todos los retos de 2 €');
    await run(manager, ports, ports.clock, 60_000);
    const after = ports.bots.get(bot.id)!;
    assert.ok(ports.grants.filter((g) => g.player === bot.id).every((g) => g.delivered), 'no recogió sus apuntes');
    assert.ok(after.walletCents >= 0);
    assert.ok(before > 0);
  });

  await test('saldo insuficiente y doble gasto: no acepta lo que no puede cubrir', () => {
    const def = defFor('DUEL_PLAYER');
    assert.equal(acceptDuelChance(10_000, 9_999, def, true), 0);
    assert.ok(acceptDuelChance(100, 100_000, def, true) > 0.5);
    // Con dos retos de 80 € y 100 € libres, el segundo ya no cabe (el primero está reservado).
    assert.equal(acceptDuelChance(8000, 10_000 - 8000, def, false), 0);
  });

  await test('concurrencia: un solo gestor mueve bots aunque haya dos procesos', async () => {
    const ports = new MemoryPorts(14);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 5, max: 5 }] });
    const a = new BotManager(ports, cfg, seeded(140), 'bm-1');
    const b = new BotManager(ports, cfg, seeded(141), 'bm-2');
    ports.clock = QUIET;
    const ra = await a.tick(QUIET);
    const rb = await b.tick(QUIET + 10);
    assert.equal(ra.ran, true);
    assert.equal(rb.ran, false);
    assert.equal(rb.reason, 'lease');
    // El primero muere sin soltar: a los pocos segundos el otro coge el turno.
    ports.clock = QUIET + (cfg.leaseSeconds + 1) * 1000;
    const rb2 = await b.tick(ports.clock);
    assert.equal(rb2.ran, true);
    // Un guardado que choca (versión) hace que se relea todo, sin pisar.
    ports.failNextSave = true;
    await run(b, ports, ports.clock + 1000, 20_000);
    assert.ok(online(ports).length >= 3);
  });

  await test('reinicio: otro proceso sigue donde se quedó, sin duplicar bots y a mitad de partida', async () => {
    const ports = new MemoryPorts(15);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 8, max: 8 }] });
    const first = new BotManager(ports, cfg, seeded(150), 'bm-old');
    // Dos bots buscando el mismo juego: se emparejan entre ellos.
    await run(first, ports, QUIET, 2 * 60_000);
    const before = ports.bots.size;
    const onlineBefore = online(ports).length;
    let live = [...ports.matches.values()].find((m) => m.status === 'live');
    await first.stop(ports.clock);
    // "Reinicio": un gestor nuevo, sin memoria, con los mismos datos.
    const second = new BotManager(ports, cfg, seeded(151), 'bm-new');
    await run(second, ports, ports.clock + 2000, 6 * 60_000);
    assert.ok(ports.bots.size <= before + 2, 'creó bots de más tras reiniciar');
    assert.ok(Math.abs(online(ports).length - onlineBefore) <= 4);
    if (live) {
      live = ports.matches.get(live.id)!;
      assert.equal(live.status, 'done', 'la partida a medias se quedó colgada');
      assert.equal(live.state.abandon, '', 'algún bot abandonó al reiniciar');
    }
    const ids = [...ports.bots.keys()];
    assert.equal(new Set(ids).size, ids.length);
  });

  await test('BOTS_ENABLED=false: todos fuera, sin dejar a nadie esperando, y no vuelve a entrar ninguno', async () => {
    const ports = new MemoryPorts(16);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 10, max: 10 }] });
    const on = new BotManager(ports, cfg, seeded(160), 'bm-on');
    await run(on, ports, QUIET, 3 * 60_000);
    assert.ok(online(ports).length >= 3);
    // Un reto pendiente de una persona a un bot.
    const bot = online(ports)[0];
    ports.presence.set('human-5', { balance: 100_000, lastSeen: ports.clock, playing: null, title: '' });
    await ports.befriend('human-5', bot.id);
    await ports.createDuel('human-5', bot.id, 100);
    await on.stop(ports.clock);

    const off = new BotManager(ports, { ...cfg, enabled: false }, seeded(161), 'bm-off');
    await run(off, ports, ports.clock + 1000, 2 * 60_000);
    assert.equal(online(ports).length, 0);
    assert.ok([...ports.queue.keys()].every((k) => !ports.bots.has(k)), 'quedó un bot en la cola');
    assert.ok([...ports.matches.values()].every((m) => m.status === 'done'), 'quedó una partida a medias');
    assert.ok(ports.duels.every((d) => d.status !== 'pending' || !ports.bots.has(d.opponent)), 'reto sin contestar');
  });

  await test('meta: ruleta y regalo una vez al día, misiones que pagan, pase con niveles y premium', () => {
    const rng = seeded(17);
    const p = emptyProgress();
    const day1 = EVENING;
    rollDay(p, rng, day1);
    assert.equal(p.missions.length, META.dailyMissions);
    assert.ok(spinWheel(p, rng, day1).cents > 0);
    assert.equal(spinWheel(p, rng, day1 + 3600_000).cents, 0, 'dos ruletas el mismo día');
    assert.equal(collectGift(p, day1).cents, META.gift[0] * 100);
    assert.equal(collectGift(p, day1).cents, 0);
    assert.equal(collectGift(p, day1 + 86_400_000).cents, META.gift[1] * 100, 'la racha no avanzó');
    assert.equal(collectGift(p, day1 + 3 * 86_400_000).cents, META.gift[0] * 100, 'la racha no se reinició al fallar un día');
    // Misiones: jugar lo bastante completa alguna y paga.
    const rounds = Array.from({ length: 40 }, (_, i) => ({ machine: ['slots', 'roulette', 'blackjack', 'crash', 'mines'][i % 5], stakeCents: 1000, returnedCents: i % 2 ? 2500 : 0 }));
    rollDay(p, rng, day1 + 3 * 86_400_000);
    const got = recordRounds(p, rounds, day1 + 3 * 86_400_000);
    assert.ok(p.missions.some((m) => m.done), 'ninguna misión completa');
    assert.ok(got.cents > 0);
    assert.ok(p.passXp > 0 && p.passLevel >= 1, 'el pase no subió');
    // Premium: 2.500 €, una vez por temporada, y paga lo de los niveles ya hechos.
    const hr = defFor('HIGH_ROLLER');
    let cost = 0;
    const out = { cents: 0, cosmetics: [] as string[], notes: [] as string[] };
    for (let i = 0; i < 100 && !cost; i++) cost = maybeBuyPremium(p, 10_000_000, hr, rng, out);
    assert.equal(cost, PREMIUM_PRICE_CENTS);
    assert.equal(maybeBuyPremium(p, 10_000_000, hr, rng, out), 0, 'compró dos veces');
    assert.ok(p.cosmetics.length > 0);
    assert.equal(maybeBuyPremium({ ...emptyProgress() }, PREMIUM_PRICE_CENTS, defFor('LOW_RISK'), rng, out), 0, 'compró sin colchón');
    // Temporada nueva: pase a cero, cosméticos conservados.
    const owned = p.cosmetics.length;
    rollDay(p, rng, Date.parse(META.pass.seasonOneStartUtc) + (META.pass.seasonDays + 1) * 86_400_000);
    assert.equal(p.passLevel, 0);
    assert.equal(p.premium, false);
    assert.equal(p.cosmetics.length, owned);
    assert.ok(dayKey(EVENING).startsWith('2026-10-05'));
  });

  await test('los bots compran el pase, hacen misiones y llevan título en la clasificación', async () => {
    const ports = new MemoryPorts(18);
    const cfg = cfgWith({ schedule: [{ from: 0, to: 24, min: 20, max: 25 }] });
    const manager = new BotManager(ports, cfg, seeded(180), 'bm-m');
    await run(manager, ports, QUIET, 6 * 3600_000);
    const all = [...ports.bots.values()];
    assert.ok(all.some((b) => b.progress.missions.some((m) => m.done)), 'ninguna misión hecha');
    assert.ok(all.some((b) => b.progress.passLevel > 0), 'nadie subió el pase');
    assert.ok(all.some((b) => b.stats.bonuses > 0));
    assert.ok(all.every((b) => b.walletCents >= 0));
    assert.ok(MACHINES.slots.maxCents === 50000);
  });

  console.log('\n' + passed + ' pruebas de bots OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
