import { body, corsPreflight, currentUser, db, json, needsAccount, text } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { playerIdOf } from '@/lib/ranking';
import { divisionByIndex, divisionFor } from '@/lib/competitive/ranks';
import {
  abandon, activeMatchOf, banState, bestDivisions, claimGrants, config, cosmeticsOf, createMatch, gameDef,
  ladder, ladderView, lastOpponent, legendTitle, loadMatch, loadTicket, matchView, mmrWindow, mutateMatch, newMatchId,
  placeBet, playAction, searchingCount, seasonAt, seasonRewards, setReady, sideOf, type MatchRow, type RankedRow,
} from '@/lib/competitive/service';
import type { Mode } from '@/lib/competitive/types';

/**
 * POST /api/online/competitive   { op, ... }
 *
 * El modo ONLINE: casual y competitivo.
 *
 *   { op: "profile" }                         mi rango (global y por juego), temporada, partida en curso
 *   { op: "search", gameId, mode }            buscar rival (se llama cada 2 s mientras se busca)
 *   { op: "cancel" }                          dejar de buscar
 *   { op: "match", matchId }                  cómo va la partida (se llama cada segundo)
 *   { op: "ready" | "forfeit", matchId }      empezar / rendirse
 *   { op: "bet", matchId, amount, type?, number?, chance?, pass? }
 *   { op: "act", matchId, action }            blackjack: hit / stand / double
 *   { op: "leaderboard", gameId }             ranking ("global" o un juego)
 *
 * Todo lo decide el servidor: emparejar, repartir, resolver, puntos, MMR,
 * fichas y premios. El juego solo dice qué quiere apostar.
 */
export const dynamic = 'force-dynamic';

interface Input {
  op?: string;
  gameId?: string;
  mode?: string;
  matchId?: string;
  amount?: number;
  type?: string;
  number?: number;
  chance?: number;
  pass?: boolean;
  action?: string;
}

const GLOBAL = 'global';

function base() {
  const s = seasonAt(config, Date.now());
  return {
    ok: true,
    message: '',
    serverUtc: new Date().toISOString(),
    seasonNumber: s.number,
    seasonName: s.name,
    seasonSecondsLeft: Math.max(0, Math.round((s.endMs - Date.now()) / 1000)),
    hasProfile: false,
    global: {},
    ladders: [] as unknown[],
    banSeconds: 0,
    recentAbandons: 0,
    searching: false,
    searchTimeout: false,
    searchSeconds: 0,
    searchWindow: 0,
    searchingCount: 0,
    searchGame: '',
    searchMode: '',
    hasMatch: false,
    match: {},
    seasonRewards: [] as unknown[],
    cosmetics: [] as string[],
    grants: [] as unknown[],
    hasBoard: false,
    board: {},
    games: config.games.map((g) => ({ id: g.id, name: g.name, machine: g.machine, rounds: g.rounds, startStack: g.startStack, minBet: g.minBet })),
    tiers: config.tiers.map((t) => ({ id: t.id, name: t.name, from: t.from })),
  };
}

function fail(message: string, extra: Record<string, unknown> = {}) {
  return json({ ...base(), ...extra, ok: false, message });
}

async function ladderWithBest(row: RankedRow, best: Record<string, number>, withRank: boolean) {
  const v = await ladderView(row, withRank);
  const bestIdx = Math.max(best[row.game_id] ?? 0, row.peak_division);
  const b = divisionByIndex(config, bestIdx);
  return { ...v, bestEverLabel: b.label, bestEverTier: b.tierId, bestEverDivision: bestIdx };
}

async function opProfile(me: string) {
  const out = base();
  const season = out.seasonNumber;
  const best = await bestDivisions(me);
  const g = await ladder(me, season, GLOBAL);
  out.global = await ladderWithBest(g, best, true);
  out.ladders = await Promise.all(config.games.map(async (gd) => ladderWithBest(await ladder(me, season, gd.id), best, false)));
  out.hasProfile = true;
  const ban = await banState(me);
  out.banSeconds = ban.bannedSeconds;
  out.recentAbandons = ban.recentAbandons;
  const active = await activeMatchOf(me);
  if (active) {
    const { row } = await mutateMatch(active.id, () => null);
    out.hasMatch = true;
    out.match = matchView(row, me);
  }
  out.seasonRewards = await seasonRewards(me, Date.now());
  out.cosmetics = await cosmeticsOf(me);
  out.grants = await claimGrants(me);
  return json(out);
}

async function respondMatch(row: MatchRow, me: string, extra: Record<string, unknown> = {}) {
  const out = base();
  out.hasMatch = true;
  out.match = matchView(row, me);
  if (row.settled) {
    out.grants = await claimGrants(me);
    out.cosmetics = await cosmeticsOf(me);
  }
  return json({ ...out, ...extra });
}

async function opSearch(me: string, input: Input) {
  const gameId = text(input.gameId, 24);
  const mode: Mode = text(input.mode, 16) === 'casual' ? 'casual' : 'competitive';
  const def = gameDef(gameId);
  if (!def) return fail('Elige un juego.');

  const ban = await banState(me);
  if (ban.bannedSeconds > 0 && mode === 'competitive') {
    return fail('Has abandonado demasiadas partidas. Podrás jugar competitivo en ' + Math.ceil(ban.bannedSeconds / 60) + ' min.', { banSeconds: ban.bannedSeconds });
  }

  // ¿Ya tiene partida? Se vuelve a ella (reconexión).
  const active = await activeMatchOf(me);
  if (active) {
    await db().from('online_mm_queue').delete().eq('player_id', me);
    const { row } = await mutateMatch(active.id, () => null);
    return respondMatch(row, me);
  }

  const MM = config.matchmaking;
  let ticket = await loadTicket(me);
  if (ticket?.match_id) {
    const row = await loadMatch(ticket.match_id);
    await db().from('online_mm_queue').delete().eq('player_id', me);
    if (row && row.status === 'live') return respondMatch(row, me);
    ticket = null;
  }

  const season = seasonAt(config, Date.now()).number;
  const mine = await ladder(me, season, def.id);
  const now = new Date();
  if (!ticket || ticket.game_id !== def.id || ticket.mode !== mode) {
    await db().from('online_mm_queue').upsert({ player_id: me, game_id: def.id, mode, mmr: mine.mmr, joined_at: now.toISOString(), ping_at: now.toISOString(), match_id: null });
    ticket = await loadTicket(me);
  } else {
    await db().from('online_mm_queue').update({ ping_at: now.toISOString(), mmr: mine.mmr }).eq('player_id', me);
  }
  if (!ticket) return fail('El competitivo aún no está activado en el servidor.');

  const elapsed = Math.max(0, (now.getTime() - Date.parse(ticket.joined_at)) / 1000);
  if (elapsed > MM.maxSearchSeconds) {
    await db().from('online_mm_queue').delete().eq('player_id', me).is('match_id', null);
    return json({ ...base(), searchTimeout: true, searchSeconds: Math.round(elapsed), message: 'No hay rivales de tu nivel ahora mismo. Prueba en un rato o juega en CASUAL.' });
  }

  const window = mmrWindow(config, elapsed, mode === 'casual');
  const avoid = elapsed < MM.avoidRecentUntilSeconds ? await lastOpponent(me) : null;
  const matchId = newMatchId();
  const { data: opponent, error } = await db().rpc('online_mm_pair', {
    p_player: me, p_game: def.id, p_mode: mode, p_mmr: mine.mmr, p_window: window, p_avoid: avoid, p_match: matchId, p_stale_seconds: MM.ticketStaleSeconds,
  });
  if (error) {
    console.error('[competitive.pair]', error);
    return fail('El competitivo aún no está activado en el servidor.');
  }

  if (opponent) {
    const row = await createMatch(matchId, def.id, mode, me, String(opponent));
    await db().from('online_mm_queue').delete().eq('player_id', me);
    if (row) return respondMatch(row, me);
    await db().from('online_mm_queue').delete().eq('player_id', String(opponent));
    return fail('No se pudo crear la partida. Vuelve a buscar.');
  }

  return json({
    ...base(),
    searching: true,
    searchSeconds: Math.round(elapsed),
    searchWindow: window,
    searchingCount: await searchingCount(def.id, mode),
    searchGame: def.id,
    searchMode: mode,
    global: { mmr: mine.mmr, points: mine.points, label: divisionFor(config, mine.points).label, tierId: divisionFor(config, mine.points).tierId },
  });
}

async function opMatch(me: string, input: Input, op: string) {
  const id = text(input.matchId, 24);
  const row = id ? await loadMatch(id) : null;
  if (!row) return fail('Esa partida no existe.');
  const side = sideOf(row, me);
  if (!side) return fail('Esa partida no es tuya.');

  const { row: saved, error } = await mutateMatch(id, (st) => {
    st.seen[side] = Date.now();
    if (op === 'ready') return setReady(st, side);
    if (op === 'forfeit') { abandon(st, side, Date.now()); return null; }
    if (op === 'bet') {
      return placeBet(gameDef(row.game_id)!, st, side, {
        amount: Number(input.amount), type: text(input.type, 12), number: Number(input.number), chance: Number(input.chance), pass: !!input.pass,
      }, Date.now());
    }
    if (op === 'act') return playAction(gameDef(row.game_id)!, st, side, text(input.action, 8));
    return null;
  });
  if (error) {
    const out = base();
    return json({ ...out, ok: false, message: error, hasMatch: true, match: matchView(saved, me) });
  }
  return respondMatch(saved, me);
}

async function opLeaderboard(me: string, input: Input) {
  const gameId = text(input.gameId, 24) || GLOBAL;
  if (gameId !== GLOBAL && !gameDef(gameId)) return fail('Ese juego no existe.');
  const season = seasonAt(config, Date.now()).number;
  const { data } = await db().from('online_ranked').select('*')
    .eq('season', season).eq('game_id', gameId).gt('games', 0)
    .order('points', { ascending: false }).order('mmr', { ascending: false }).limit(config.leaderboardLimit);
  const rows = (data ?? []) as RankedRow[];
  const entry = (r: RankedRow, rank: number) => {
    const d = divisionFor(config, r.points);
    return {
      rank, playerId: r.player_id, name: r.name || 'Jugador', avatarId: Number(r.avatar_id || 0),
      points: r.points, label: d.label, tierId: d.tierId, division: d.index,
      wins: r.wins, losses: r.losses, winrate: r.games > 0 ? Math.round((r.wins * 100) / r.games) : 0,
      legendTitle: legendTitle(rank, d.tierId === 'leyenda'), me: r.player_id === me,
    };
  };
  const entries = rows.map((r, i) => entry(r, i + 1));
  let you = entries.find((e) => e.me) ?? null;
  if (!you) {
    const mine = await ladder(me, season, gameId);
    if (mine.games > 0) {
      const { count } = await db().from('online_ranked').select('player_id', { count: 'exact', head: true })
        .eq('season', season).eq('game_id', gameId).gt('games', 0).gt('points', mine.points);
      you = entry(mine, (count ?? 0) + 1);
    }
  }
  const { count: total } = await db().from('online_ranked').select('player_id', { count: 'exact', head: true })
    .eq('season', season).eq('game_id', gameId).gt('games', 0);
  const out = base();
  out.hasBoard = true;
  out.board = { gameId, season, total: total ?? 0, entries, hasYou: !!you, you: you ?? {} };
  return json(out);
}

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);
  const user = await currentUser(request);
  if (!user) return needsAccount();
  const me = (await playerIdOf(user.id)) ?? user.id;

  const input = await body<Input>(request);
  const op = text(input.op, 16) || 'profile';
  try {
    switch (op) {
      case 'profile': return await opProfile(me);
      case 'search': return await opSearch(me, input);
      case 'cancel':
        await db().from('online_mm_queue').delete().eq('player_id', me).is('match_id', null);
        return json(base());
      case 'match':
      case 'ready':
      case 'bet':
      case 'act':
      case 'forfeit':
        return await opMatch(me, input, op);
      case 'leaderboard': return await opLeaderboard(me, input);
      default: return fail('Operación desconocida.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[online/competitive]', op, message);
    if (message.startsWith('COMP_TABLE')) return fail('El competitivo aún no está activado en el servidor.');
    if (message === 'BUSY') return fail('Mucho movimiento a la vez. Inténtalo otra vez.');
    return fail('No se ha podido completar.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
