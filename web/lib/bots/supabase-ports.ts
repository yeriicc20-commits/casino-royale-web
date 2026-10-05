import 'server-only';

import { db, ONLINE_WINDOW_SECONDS } from '@/lib/online';
import {
  activeMatchOf, config as compConfig, gameDef, loadMatch, mutateMatch, pairWith, searchStep, sideOf,
  abandon, placeBet, playAction, setReady, type MatchRow,
} from '@/lib/competitive/service';
import { tick } from '@/lib/competitive/match';
import type { Mode } from '@/lib/competitive/types';
import { actDuel, createDuel, loadDuel, openDuelsAmong, respondDuel, view as duelView } from '@/lib/duel-service';
import { claimReward, openChest, reportRounds, riskOrCash } from '@/lib/events/actions';
import { pot } from '@/lib/events/engine';
import { acceptsReports, rewardsReady } from '@/lib/events/schedule';
import { config as evConfig, cosmeticsOf, defOf, instanceOf } from '@/lib/events/store';
import type { RoundIn } from '@/lib/events/types';
import { loadProgress } from './meta';
import type { BotPorts, DuelSnapshot, EventReport, MatchSnapshot, SearchResult } from './ports';
import { playingOf } from './manager';
import { emptyRuntime, emptyStats, type Bot, type BotState, type Personality, type QueueMode, type Runtime } from './types';

/**
 * Los puertos de verdad: cada operación de un bot pasa por el MISMO servicio
 * que usa la ruta del juego para una persona. Aquí no hay reglas propias.
 */

interface BotRowDb {
  player_id: string;
  username: string;
  personality: string;
  status: string;
  wallet_cents: number;
  rounds: number;
  biggest_win_cents: number;
  avatar_id: number;
  friend_code: string;
  platform: string;
  rhythm: number;
  online_since: string | null;
  session_ends_at: string | null;
  next_online_at: string | null;
  next_action_at: string | null;
  last_heartbeat_at: string | null;
  last_bonus_at: string | null;
  activity: Bot['activity'] | null;
  stats: Partial<Bot['stats']> | null;
  progress: unknown;
  version: number;
}

const ms = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
const iso = (n: number) => (n > 0 ? new Date(n).toISOString() : null);

function fromDb(r: BotRowDb): Bot {
  return {
    id: r.player_id,
    username: r.username,
    personality: r.personality as Personality,
    state: r.status as BotState,
    walletCents: Number(r.wallet_cents || 0),
    rounds: Number(r.rounds || 0),
    biggestWinCents: Number(r.biggest_win_cents || 0),
    avatarId: Number(r.avatar_id || 0),
    friendCode: r.friend_code,
    platform: r.platform,
    rhythm: Number(r.rhythm || 1),
    onlineSince: ms(r.online_since),
    sessionEndsAt: ms(r.session_ends_at),
    nextOnlineAt: ms(r.next_online_at),
    nextActionAt: ms(r.next_action_at),
    lastHeartbeatAt: ms(r.last_heartbeat_at),
    lastBonusAt: ms(r.last_bonus_at),
    activity: r.activity ?? {},
    stats: { ...emptyStats(), ...(r.stats ?? {}) },
    progress: loadProgress(r.progress),
    version: Number(r.version || 0),
  };
}

function toDb(b: Bot) {
  return {
    username: b.username,
    personality: b.personality,
    status: b.state,
    wallet_cents: Math.max(0, Math.round(b.walletCents)),
    rounds: b.rounds,
    biggest_win_cents: b.biggestWinCents,
    avatar_id: b.avatarId,
    friend_code: b.friendCode,
    platform: b.platform,
    rhythm: b.rhythm,
    online_since: iso(b.onlineSince),
    session_ends_at: iso(b.sessionEndsAt),
    next_online_at: iso(b.nextOnlineAt) ?? new Date().toISOString(),
    next_action_at: iso(b.nextActionAt) ?? new Date().toISOString(),
    last_heartbeat_at: iso(b.lastHeartbeatAt),
    last_bonus_at: iso(b.lastBonusAt),
    activity: b.activity,
    stats: b.stats,
    progress: b.progress,
    updated_at: new Date().toISOString(),
  };
}

function presenceRow(b: Bot, nowMs: number, online: boolean) {
  const row: Record<string, unknown> = {
    player_id: b.id,
    name: b.username,
    avatar_id: b.avatarId,
    friend_code: b.friendCode,
    balance_cents: Math.max(0, Math.round(b.walletCents)),
    biggest_win_cents: b.biggestWinCents,
    rounds: b.rounds,
    is_bot: true,
    playing: online ? playingOf(b) : null,
    platform: b.platform,
    title_id: b.progress.titleId || '',
    frame_id: b.progress.frameId || '',
  };
  if (online) row.last_seen = new Date(nowMs).toISOString();
  return row;
}

function matchOutcome(row: MatchRow, side: 'a' | 'b'): MatchSnapshot['outcome'] {
  const res = (row.result ?? {}) as Record<string, { outcome?: string } | undefined>;
  const o = res[side]?.outcome ?? '';
  return o === 'win' || o === 'loss' || o === 'draw' || o === 'void' ? o : '';
}

function snapshot(row: MatchRow, botId: string, nowMs: number, advance: boolean): MatchSnapshot | null {
  const side = sideOf(row, botId);
  const def = gameDef(row.game_id);
  if (!side || !def) return null;
  const state = structuredClone(row.state);
  // Solo para mirar: lo que el reloj ya ha decidido (no se guarda; el servidor
  // lo aplica de verdad en la próxima petición de cualquiera de los dos).
  if (advance) tick(compConfig, def, state, nowMs, () => 0.5);
  return {
    matchId: row.id, side, def, state,
    status: row.status === 'done' ? 'done' : 'live',
    settled: !!row.settled,
    outcome: matchOutcome(row, side),
  };
}

export function createSupabasePorts(): BotPorts {
  return {
    // ------------------------------------------------------------- turno
    async lease(owner, seconds) {
      const { data, error } = await db().rpc('online_bot_lease', { p_owner: owner, p_seconds: seconds });
      if (error) {
        console.error('[bots] sin turno (¿falta 17_bots.sql?)', error.message);
        return false;
      }
      return !!data;
    },
    async release(owner) {
      await db().rpc('online_bot_release', { p_owner: owner });
    },
    async loadRuntime(): Promise<Runtime> {
      const { data } = await db().from('online_bot_runtime').select('state').eq('id', 1).maybeSingle();
      return { ...emptyRuntime(), ...((data as { state?: Partial<Runtime> } | null)?.state ?? {}) };
    },
    async saveRuntime(rt) {
      await db().from('online_bot_runtime').update({ state: rt, updated_at: new Date().toISOString() }).eq('id', 1);
    },
    async loadBots() {
      const { data, error } = await db().from('online_bots').select('*').limit(2000);
      if (error) throw new Error('BOTS_TABLE: ' + error.message);
      return ((data ?? []) as BotRowDb[]).map(fromDb);
    },
    async saveBot(bot) {
      const { data, error } = await db().from('online_bots').update({ ...toDb(bot), version: bot.version + 1 })
        .eq('player_id', bot.id).eq('version', bot.version).select('player_id');
      if (error || !data || !data.length) return false;
      bot.version++;
      return true;
    },
    async insertBot(bot) {
      const client = db();
      const player = { ...presenceRow(bot, Date.now(), false), last_seen: new Date(Date.now() - 86_400_000).toISOString() };
      let { error } = await client.from('online_players').insert(player);
      if (error && /title_id|frame_id|playing|platform/.test(error.message)) {
        const { title_id: _t, frame_id: _f, playing: _p, platform: _pl, ...plain } = player as Record<string, unknown>;
        ({ error } = await client.from('online_players').insert(plain));
      }
      if (error) {
        console.error('[bots] alta en online_players', error.message);
        return false;
      }
      const { error: botError } = await client.from('online_bots').insert({ player_id: bot.id, ...toDb(bot), version: 0 });
      if (botError) {
        console.error('[bots] alta en online_bots', botError.message);
        await client.from('online_players').delete().eq('player_id', bot.id).eq('is_bot', true);
        return false;
      }
      return true;
    },
    async takenNames() {
      const client = db();
      const [profiles, players] = await Promise.all([
        client.from('profiles').select('display_name').limit(20000),
        client.from('online_players').select('name').limit(20000),
      ]);
      const set = new Set<string>();
      for (const r of (profiles.data ?? []) as { display_name: string }[]) if (r.display_name) set.add(r.display_name.trim().toLowerCase());
      for (const r of (players.data ?? []) as { name: string }[]) if (r.name) set.add(r.name.trim().toLowerCase());
      return set;
    },

    // ------------------------------------------------------------- presencia y dinero
    async publish(bots, nowMs) {
      const client = db();
      for (const online of [true, false]) {
        const rows = bots.filter((b) => (b.state !== 'OFFLINE') === online).map((b) => presenceRow(b, nowMs, online));
        if (!rows.length) continue;
        let { error } = await client.from('online_players').upsert(rows, { onConflict: 'player_id' });
        if (error && /title_id|frame_id|playing|platform/.test(error.message)) {
          const plain = rows.map(({ title_id: _t, frame_id: _f, playing: _p, platform: _pl, ...r }) => r);
          ({ error } = await client.from('online_players').upsert(plain, { onConflict: 'player_id' }));
        }
        if (error) console.error('[bots] presencia', error.message);
      }
    },
    async claimGrants(botId) {
      const { data, error } = await db().rpc('online_grant_claim', { p_player_id: botId });
      if (error || !data) return 0;
      return (data as { amount_cents: number }[]).reduce((n, g) => n + Number(g.amount_cents || 0), 0);
    },
    async world(botIds, nowMs) {
      const client = db();
      const since = new Date(nowMs - ONLINE_WINDOW_SECONDS * 1000).toISOString();
      const fresh = new Date(nowMs - compConfig.matchmaking.ticketStaleSeconds * 1000).toISOString();
      const ids = new Set(botIds);
      const list = botIds.join(',');
      const [humans, queue, duels, grants, matches] = await Promise.all([
        client.from('online_players').select('player_id', { count: 'exact', head: true }).eq('is_bot', false).gte('last_seen', since),
        client.from('online_mm_queue').select('player_id, game_id, mode, mmr, joined_at').is('match_id', null).gte('ping_at', fresh).limit(200),
        openDuelsAmong(botIds),
        botIds.length
          ? client.from('online_grants').select('player_id').is('delivered_at', null).in('player_id', botIds).limit(500)
          : Promise.resolve({ data: [] as { player_id: string }[] }),
        botIds.length
          ? client.from('online_matches').select('id, game_id, player_a, player_b').eq('status', 'live')
            .or('player_a.in.(' + list + '),player_b.in.(' + list + ')').limit(200)
          : Promise.resolve({ data: [] as { id: string; game_id: string; player_a: string; player_b: string }[] }),
      ]);
      type Q = { player_id: string; game_id: string; mode: string; mmr: number; joined_at: string };
      let tickets = ((queue.data ?? []) as Q[]).filter((t) => !ids.has(t.player_id));
      if (tickets.length) {
        // Un bot desconectado no está en `ids`: se mira la marca para no confundirlo con una persona.
        const { data: marked } = await client.from('online_players').select('player_id')
          .in('player_id', tickets.map((t) => t.player_id)).eq('is_bot', true);
        const botsInQueue = new Set(((marked ?? []) as { player_id: string }[]).map((r) => r.player_id));
        tickets = tickets.filter((t) => !botsInQueue.has(t.player_id));
      }
      return {
        humansOnline: humans.count ?? 0,
        humanTickets: tickets
          .map((t) => ({ playerId: t.player_id, gameId: t.game_id, mode: t.mode === 'competitive' ? 'competitive' : 'casual', mmr: t.mmr, joinedAt: Date.parse(t.joined_at) })),
        openDuels: duels.map((d) => ({
          id: d.id, challengerId: d.challenger_id, opponentId: d.opponent_id, stakeCents: Number(d.stake_cents),
          status: d.status === 'active' ? 'active' : 'pending',
          challengerCards: d.challenger_cards ?? [], opponentCards: d.opponent_cards ?? [],
          challengerDone: !!d.challenger_done, opponentDone: !!d.opponent_done, updatedAt: Date.parse(d.updated_at),
        })),
        liveMatches: ((matches.data ?? []) as { id: string; game_id: string; player_a: string; player_b: string }[])
          .flatMap((m) => [m.player_a, m.player_b].filter((p) => ids.has(p)).map((botId) => ({ botId, matchId: m.id, gameId: m.game_id }))),
        pendingGrants: [...new Set(((grants.data ?? []) as { player_id: string }[]).map((g) => g.player_id))],
      };
    },

    // ------------------------------------------------------------- 1 contra 1
    async search(botId, gameId, mode): Promise<SearchResult> {
      const def = gameDef(gameId);
      if (!def) return { kind: 'stop', reason: 'juego' };
      const r = await searchStep(botId, def, mode as Mode);
      if (r.kind === 'match') return { kind: 'match', matchId: r.row.id };
      if (r.kind === 'searching') return { kind: 'searching' };
      return { kind: 'stop', reason: r.kind };
    },
    async cancelSearch(botId) {
      // Toda su fila, también la ya emparejada: la partida se crea sin ella (y
      // es lo mismo que hace searchStep al encontrar partida).
      await db().from('online_mm_queue').delete().eq('player_id', botId);
    },
    async pairWith(botId, targetId, gameId, mode) {
      const def = gameDef(gameId);
      if (!def) return null;
      const row = await pairWith(botId, targetId, def, mode as Mode);
      return row?.id ?? null;
    },
    async activeMatch(botId) {
      return (await activeMatchOf(botId))?.id ?? null;
    },
    async readMatch(botId, matchId, nowMs) {
      const row = await loadMatch(matchId);
      return row ? snapshot(row, botId, nowMs, true) : null;
    },
    async applyMatch(botId, matchId, move) {
      const row0 = await loadMatch(matchId);
      if (!row0) return null;
      const side = sideOf(row0, botId);
      const def = gameDef(row0.game_id);
      if (!side || !def) return null;
      const { row } = await mutateMatch(matchId, (st) => {
        st.seen[side] = Date.now();
        if (!move) return null;
        if (move === 'forfeit') { abandon(st, side, Date.now()); return null; }
        if (move.op === 'ready') return setReady(st, side);
        if (move.op === 'bet') return placeBet(def, st, side, move.bet, Date.now());
        return playAction(def, st, side, move.action);
      });
      return row ? snapshot(row, botId, Date.now(), false) : null;
    },

    // ------------------------------------------------------------- retos
    async friendsOf(botId) {
      const { data } = await db().from('online_friends').select('friend_id').eq('player_id', botId).limit(200);
      return ((data ?? []) as { friend_id: string }[]).map((r) => r.friend_id);
    },
    async befriend(botId, otherId) {
      const { data: other } = await db().from('online_players').select('friend_code').eq('player_id', otherId).maybeSingle();
      const code = (other as { friend_code?: string } | null)?.friend_code;
      if (!code) return false;
      const { data, error } = await db().rpc('online_friend_add', { me: botId, code });
      if (error) return false;
      const r = ((data ?? []) as { ok: boolean }[])[0];
      return !!r?.ok;
    },
    async createDuel(botId, friendId, stakeCents) {
      return (await createDuel(botId, friendId, stakeCents, { claim: false })).ok;
    },
    async respondDuel(botId, duelId, accept) {
      return (await respondDuel(botId, duelId, accept, { claim: false })).ok;
    },
    async actDuel(botId, duelId, action) {
      return (await actDuel(botId, duelId, action, { claim: false })).ok;
    },
    async duel(botId, duelId): Promise<DuelSnapshot | null> {
      const row = await loadDuel(duelId);
      if (!row || (row.challenger_id !== botId && row.opponent_id !== botId)) return null;
      const v = duelView(row, botId, new Map());
      return {
        id: v.id, status: v.status, role: v.role, stakeCents: v.stakeCents, myCards: v.myCards, myDone: v.myDone,
        outcome: v.outcome === 'win' || v.outcome === 'lose' || v.outcome === 'push' ? v.outcome : '',
      };
    },

    // ------------------------------------------------------------- eventos
    async reportEvent(botId, instanceId, reportId, rounds: RoundIn[]): Promise<EventReport | null> {
      const inst = instanceOf(instanceId);
      const def = inst ? defOf(inst.eventId) : null;
      if (!inst || !def || !acceptsReports(evConfig, inst, Date.now())) return null;
      const { state, applied } = await reportRounds(botId, inst, def, reportId, rounds);
      const objectivesDone = (def.objectives ?? []).every((o) => state.done.includes(o.id));
      return { counted: applied.counted, pot: def.kind === 'risk' ? pot(def, state) : 0, canChest: !!def.chest && !state.chestClaimed && objectivesDone };
    },
    async eventRisk(botId, instanceId, op) {
      const inst = instanceOf(instanceId);
      const def = inst ? defOf(inst.eventId) : null;
      if (!inst || !def || def.kind !== 'risk' || Date.now() >= inst.closesMs) return false;
      return (await riskOrCash(botId, inst, def, op)).result.ok;
    },
    async eventChest(botId, instanceId) {
      const inst = instanceOf(instanceId);
      const def = inst ? defOf(inst.eventId) : null;
      if (!inst || !def || !def.chest) return false;
      return (await openChest(botId, inst, def, new Set(await cosmeticsOf(botId)))).ok;
    },
    async claimEvents(botId, nowMs) {
      const since = new Date(nowMs - evConfig.schedule.claimWindowDays * 86_400_000).toISOString();
      const { data } = await db().from('online_event_progress').select('instance_id')
        .eq('player_id', botId).eq('claimed', false).gt('rounds', 0).gte('created_at', since).limit(20);
      let n = 0;
      for (const r of (data ?? []) as { instance_id: string }[]) {
        const inst = instanceOf(r.instance_id);
        const def = inst ? defOf(inst.eventId) : null;
        if (!inst || !def || !rewardsReady(evConfig, inst, nowMs)) continue;
        if ((await claimReward(botId, inst, def, nowMs)).ok) n++;
      }
      return n;
    },
  };
}

export type { QueueMode };
