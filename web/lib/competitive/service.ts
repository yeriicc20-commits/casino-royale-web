import 'server-only';

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/online';
import rawConfig from './config.json';
import type { CompetitiveConfig, GameDef, MatchState, Mode, Side } from './types';
import {
  applyResult, divisionByIndex, divisionFor, legendTitle, mmrWindow, seasonAt, seasonByNumber, softReset,
  tierIndexOf, type LadderRow, type Outcome, type RatingChange,
} from './ranks';
import { abandon, newMatch, other, placeBet, playAction, setReady, tick, viewFor } from './match';

/**
 * Todo lo del competitivo que toca la base de datos: escaleras, cola, partidas,
 * liquidación y premios. Las reglas están en ranks.ts / match.ts / games.ts.
 */

export const config = rawConfig as unknown as CompetitiveConfig;

export function rng(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

export function gameDef(id: string): GameDef | null {
  return config.games.find((g) => g.id === id) ?? null;
}

const GLOBAL = 'global';

// ---------------------------------------------------------------------------- escaleras

export interface RankedRow {
  player_id: string;
  season: number;
  game_id: string;
  name: string;
  avatar_id: number;
  points: number;
  mmr: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  best_streak: number;
  peak_points: number;
  peak_division: number;
  protect_left: number;
  chips_cents: number;
  seconds_played: number;
  abandons: number;
  version: number;
}

export async function identity(playerId: string): Promise<{ name: string; avatarId: number }> {
  const { data } = await db().from('online_players').select('name, avatar_id').eq('player_id', playerId).maybeSingle();
  const r = data as { name: string; avatar_id: number } | null;
  return { name: r?.name || 'Jugador', avatarId: Number(r?.avatar_id || 0) };
}

async function loadLadder(playerId: string, season: number, gameId: string): Promise<RankedRow | null> {
  const { data, error } = await db().from('online_ranked').select('*')
    .eq('player_id', playerId).eq('season', season).eq('game_id', gameId).maybeSingle();
  if (error) throw new Error('COMP_TABLE: ' + error.message);
  return (data as RankedRow) ?? null;
}

/**
 * La escalera de un jugador en una temporada. La primera vez en una temporada
 * nueva hereda la anterior con el reset parcial (configurable).
 */
export async function ladder(playerId: string, season: number, gameId: string): Promise<RankedRow> {
  const found = await loadLadder(playerId, season, gameId);
  if (found) return found;
  const prev = season > 1 ? await loadLadder(playerId, season - 1, gameId) : null;
  const who = await identity(playerId);
  const R = config.seasons;
  const points = prev ? softReset(prev.points, R.reset.pivot, R.reset.keep) : 0;
  const mmr = prev ? softReset(prev.mmr, R.mmrReset.pivot, R.mmrReset.keep) : config.mmr.start;
  const row = {
    player_id: playerId, season, game_id: gameId, name: who.name, avatar_id: who.avatarId,
    points, mmr, peak_points: points, peak_division: divisionFor(config, points).index, version: 0,
  };
  await db().from('online_ranked').upsert(row, { onConflict: 'player_id,season,game_id', ignoreDuplicates: true });
  const created = await loadLadder(playerId, season, gameId);
  if (!created) throw new Error('COMP_TABLE: no se pudo crear la escalera');
  return created;
}

function toLadder(r: RankedRow): LadderRow {
  return {
    points: r.points, mmr: r.mmr, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws,
    streak: r.streak, bestStreak: r.best_streak, peakPoints: r.peak_points, peakDivision: r.peak_division, protectLeft: r.protect_left,
  };
}

/** Aplica un resultado a una escalera, con control de versión (reintenta si se cruzan). */
async function updateLadder(
  playerId: string, season: number, gameId: string, opponentMmr: number, outcome: Outcome, rated: boolean, abandoned: boolean,
  extra: { chips: number; seconds: number },
): Promise<RatingChange> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await ladder(playerId, season, gameId);
    const l = toLadder(row);
    const change = applyResult(config, l, opponentMmr, outcome, rated, abandoned);
    const { data } = await db().from('online_ranked').update({
      points: l.points, mmr: l.mmr, games: l.games, wins: l.wins, losses: l.losses, draws: l.draws,
      streak: l.streak, best_streak: l.bestStreak, peak_points: l.peakPoints, peak_division: l.peakDivision, protect_left: l.protectLeft,
      chips_cents: Number(row.chips_cents) + extra.chips, seconds_played: row.seconds_played + extra.seconds,
      abandons: row.abandons + (abandoned ? 1 : 0),
      last_match_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: row.version + 1,
    }).eq('player_id', playerId).eq('season', season).eq('game_id', gameId).eq('version', row.version).select('player_id');
    if (data && data.length) return change;
  }
  throw new Error('BUSY');
}

async function rankIn(season: number, gameId: string, points: number): Promise<number> {
  const { count } = await db().from('online_ranked').select('player_id', { count: 'exact', head: true })
    .eq('season', season).eq('game_id', gameId).gt('games', 0).gt('points', points);
  return (count ?? 0) + 1;
}

/** Lo que se enseña de una escalera. */
export async function ladderView(row: RankedRow, withRank: boolean) {
  const d = divisionFor(config, row.points);
  const next = d.to > 0 ? divisionByIndex(config, d.index + 1) : null;
  const legend = d.tierId === 'leyenda';
  const rank = withRank && row.games > 0 ? await rankIn(row.season, row.game_id, row.points) : 0;
  const peak = divisionByIndex(config, row.peak_division);
  return {
    gameId: row.game_id,
    points: row.points,
    mmr: row.mmr,
    division: d.index,
    tierId: d.tierId,
    tierIndex: d.tierIndex,
    divisionNumber: d.division,
    label: d.label,
    from: d.from,
    to: d.to,
    progress: d.to > 0 ? Math.max(0, Math.min(1, (row.points - d.from) / (d.to - d.from))) : 1,
    nextLabel: next ? next.label : '',
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    winrate: row.games > 0 ? Math.round((row.wins * 100) / row.games) : 0,
    streak: row.streak,
    bestStreak: row.best_streak,
    peakPoints: row.peak_points,
    peakDivision: row.peak_division,
    peakLabel: peak.label,
    peakTierId: peak.tierId,
    protectLeft: row.protect_left,
    chipsCents: Number(row.chips_cents),
    secondsPlayed: row.seconds_played,
    abandons: row.abandons,
    rank,
    legendTitle: legendTitle(rank, legend),
  };
}

// ---------------------------------------------------------------------------- premios

async function insertClaim(playerId: string, claimId: string, cents: number, cosmetics: string[]): Promise<boolean> {
  const { data, error } = await db().from('online_comp_claims')
    .upsert({ player_id: playerId, claim_id: claimId, coins_cents: cents, cosmetics }, { onConflict: 'player_id,claim_id', ignoreDuplicates: true })
    .select('claim_id');
  if (error) { console.error('[comp.claim]', error); return false; }
  return !!(data && data.length);
}

async function pay(playerId: string, cents: number, reason: string) {
  if (cents <= 0) return;
  const client = db();
  const { error } = await client.rpc('admin_adjust_player', { p_player_id: playerId, p_amount_cents: cents, p_reason: reason, p_actor: null });
  if (error) await client.from('online_grants').insert({ player_id: playerId, amount_cents: cents, reason });
}

/** Apunta y paga UNA vez por llave. Devuelve si era nuevo. */
export async function deliver(playerId: string, claimId: string, cents: number, cosmetics: string[], reason: string): Promise<boolean> {
  const fresh = await insertClaim(playerId, claimId, cents, cosmetics);
  if (fresh) await pay(playerId, cents, reason);
  return fresh;
}

export async function claimGrants(playerId: string) {
  const { data, error } = await db().rpc('online_grant_claim', { p_player_id: playerId });
  if (error || !data) return [];
  return (data as { id: number; amount_cents: number; reason: string }[])
    .map((g) => ({ id: Number(g.id), amountCents: Number(g.amount_cents), reason: g.reason || '' }));
}

export async function cosmeticsOf(playerId: string): Promise<string[]> {
  const { data } = await db().from('online_comp_claims').select('cosmetics').eq('player_id', playerId).limit(1000);
  const set = new Set<string>();
  for (const r of (data ?? []) as { cosmetics: string[] }[]) for (const c of r.cosmetics ?? []) set.add(String(c));
  return [...set];
}

async function rewardedToday(playerId: string): Promise<number> {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await db().from('online_comp_claims').select('claim_id', { count: 'exact', head: true })
    .eq('player_id', playerId).like('claim_id', 'match:%').gte('created_at', since);
  return count ?? 0;
}

/** Récord histórico y premios de rango (la primera vez que se llega a cada rango). */
async function rankRewards(playerId: string, season: number, divisionIndex: number, points: number) {
  const { data } = await db().from('online_ranked_best').select('*').eq('player_id', playerId).eq('game_id', '*').maybeSingle();
  const best = data as { best_division: number } | null;
  const before = best ? best.best_division : 0;
  const out: { label: string; coinsCents: number; cosmetics: string[] }[] = [];
  if (!best || divisionIndex > before) {
    await db().from('online_ranked_best').upsert({ player_id: playerId, game_id: '*', best_division: divisionIndex, best_points: points, best_season: season, updated_at: new Date().toISOString() });
  }
  const tierNow = divisionByIndex(config, divisionIndex).tierIndex;
  const tierBefore = divisionByIndex(config, before).tierIndex;
  for (const r of config.rankRewards) {
    const ti = tierIndexOf(config, r.tier);
    if (ti < 0 || ti > tierNow || (best && ti <= tierBefore)) continue;
    if (await deliver(playerId, 'rank:' + r.tier, r.coinsCents, r.cosmetics, 'Rango ' + config.tiers[ti].name + ' · ' + r.label)) {
      out.push({ label: r.label, coinsCents: r.coinsCents, cosmetics: r.cosmetics });
    }
  }
  return out;
}

async function bestFor(playerId: string, gameId: string, division: number, points: number, season: number) {
  const { data } = await db().from('online_ranked_best').select('best_division').eq('player_id', playerId).eq('game_id', gameId).maybeSingle();
  const b = data as { best_division: number } | null;
  if (!b || division > b.best_division) {
    await db().from('online_ranked_best').upsert({ player_id: playerId, game_id: gameId, best_division: division, best_points: points, best_season: season, updated_at: new Date().toISOString() });
  }
}

export async function bestDivisions(playerId: string): Promise<Record<string, number>> {
  const { data } = await db().from('online_ranked_best').select('game_id, best_division').eq('player_id', playerId);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { game_id: string; best_division: number }[]) out[r.game_id] = r.best_division;
  return out;
}

/** Premios de temporadas que ya terminaron (se entregan solos, una vez). */
export async function seasonRewards(playerId: string, nowMs: number) {
  const current = seasonAt(config, nowMs).number;
  const out: { season: number; name: string; label: string; coinsCents: number; cosmetics: string[] }[] = [];
  for (let s = Math.max(1, current - 3); s < current; s++) {
    const row = await loadLadder(playerId, s, GLOBAL).catch(() => null);
    if (!row || row.games <= 0) continue;
    const season = seasonByNumber(config, s);
    const peakTier = divisionByIndex(config, row.peak_division).tierIndex;
    let coins = 0;
    const cosmetics = new Set<string>();
    const parts: string[] = [];
    let tierReward = null;
    for (const r of config.seasons.rewards) if (tierIndexOf(config, r.minTier) <= peakTier) tierReward = r;
    if (tierReward) { coins += tierReward.coinsCents; tierReward.cosmetics.forEach((c) => cosmetics.add(c)); parts.push('Rango máximo ' + divisionByIndex(config, row.peak_division).label); }
    if (row.games >= config.seasons.participationMatches) {
      coins += config.seasons.participation.coinsCents;
      config.seasons.participation.cosmetics.forEach((c) => cosmetics.add(c));
      parts.push(row.games + ' partidas');
    }
    const rank = await rankIn(s, GLOBAL, row.points);
    const top = config.seasons.topRewards.find((t) => rank <= t.maxRank);
    if (top) { coins += top.coinsCents; top.cosmetics.forEach((c) => cosmetics.add(c)); parts.push('Puesto #' + rank); }
    if (!coins && !cosmetics.size) continue;
    if (await deliver(playerId, 'season:' + s, coins, [...cosmetics], 'Temporada ' + s + ' · ' + season.name)) {
      out.push({ season: s, name: season.name, label: parts.join(' · '), coinsCents: coins, cosmetics: [...cosmetics] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- abandonos

export async function banState(playerId: string): Promise<{ bannedSeconds: number; recentAbandons: number }> {
  const { data } = await db().from('online_comp_bans').select('*').eq('player_id', playerId).maybeSingle();
  const r = data as { abandons: number[]; banned_until: string | null } | null;
  if (!r) return { bannedSeconds: 0, recentAbandons: 0 };
  const since = Date.now() - config.abandon.windowHours * 3600000;
  const recent = (r.abandons ?? []).filter((t) => t >= since).length;
  const until = r.banned_until ? Date.parse(r.banned_until) : 0;
  return { bannedSeconds: Math.max(0, Math.ceil((until - Date.now()) / 1000)), recentAbandons: recent };
}

async function recordAbandon(playerId: string) {
  const A = config.abandon;
  const { data } = await db().from('online_comp_bans').select('*').eq('player_id', playerId).maybeSingle();
  const r = data as { abandons: number[] } | null;
  const since = Date.now() - A.windowHours * 3600000;
  const list = [...(r?.abandons ?? []).filter((t) => t >= since), Date.now()];
  const over = list.length - A.freeAbandons;
  let until: string | null = null;
  if (over > 0) {
    const minutes = Math.min(A.banMaxMinutes, A.banMinutes * Math.pow(A.banGrowth, over - 1));
    until = new Date(Date.now() + minutes * 60000).toISOString();
  }
  await db().from('online_comp_bans').upsert({ player_id: playerId, abandons: list, banned_until: until, updated_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------- partidas

export interface MatchRow {
  id: string;
  game_id: string;
  mode: Mode;
  season: number;
  player_a: string;
  player_b: string;
  name_a: string;
  name_b: string;
  avatar_a: number;
  avatar_b: number;
  mmr_a: number;
  mmr_b: number;
  points_a: number;
  points_b: number;
  status: string;
  state: MatchState;
  version: number;
  settled: boolean;
  result: Record<string, unknown>;
  created_at: string;
}

export function newMatchId(): string {
  return 'MATCH-' + randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

export async function loadMatch(id: string): Promise<MatchRow | null> {
  const { data } = await db().from('online_matches').select('*').eq('id', id).maybeSingle();
  return (data as MatchRow) ?? null;
}

export async function activeMatchOf(playerId: string): Promise<MatchRow | null> {
  const { data } = await db().from('online_matches').select('*')
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`).eq('status', 'live')
    .order('created_at', { ascending: false }).limit(1);
  const rows = (data ?? []) as MatchRow[];
  return rows[0] ?? null;
}

export function sideOf(row: MatchRow, playerId: string): Side | null {
  return row.player_a === playerId ? 'a' : row.player_b === playerId ? 'b' : null;
}

export async function createMatch(id: string, gameId: string, mode: Mode, a: string, b: string): Promise<MatchRow | null> {
  const def = gameDef(gameId)!;
  const season = seasonAt(config, Date.now()).number;
  const [la, lb, ia, ib] = await Promise.all([ladder(a, season, gameId), ladder(b, season, gameId), identity(a), identity(b)]);
  const state = newMatch(config, def, mode, Date.now());
  const row = {
    id, game_id: gameId, mode, season, player_a: a, player_b: b,
    name_a: ia.name, name_b: ib.name, avatar_a: ia.avatarId, avatar_b: ib.avatarId,
    mmr_a: la.mmr, mmr_b: lb.mmr, points_a: la.points, points_b: lb.points,
    status: 'live', state, version: 1,
  };
  const { error } = await db().from('online_matches').insert(row);
  if (error) { console.error('[comp.createMatch]', error); return null; }
  return loadMatch(id);
}

/** Pone al día la partida y guarda (con versión). Repite si otro la tocó a la vez. */
export async function mutateMatch(id: string, change: (st: MatchState, row: MatchRow) => string | null): Promise<{ row: MatchRow; error: string | null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await loadMatch(id);
    if (!row) return { row: null as unknown as MatchRow, error: 'Esa partida no existe.' };
    const def = gameDef(row.game_id)!;
    const st = row.state;
    const now = Date.now();
    const original = JSON.stringify(st);
    tick(config, def, st, now, rng);
    const error = change(st, row);
    tick(config, def, st, now, rng);
    if (JSON.stringify(st) === original) {
      if (row.status === 'done' && !row.settled) {
        await settle(row);
        return { row: (await loadMatch(id)) ?? row, error };
      }
      return { row, error };
    }
    const { data } = await db().from('online_matches').update({
      state: st, version: row.version + 1, status: st.phase === 'done' ? 'done' : 'live',
      finished_at: st.phase === 'done' ? new Date(st.endedAt || now).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('version', row.version).select('*');
    if (data && data.length) {
      const saved = data[0] as MatchRow;
      if (saved.status === 'done' && !saved.settled) await settle(saved);
      return { row: (await loadMatch(id)) ?? saved, error };
    }
  }
  return { row: (await loadMatch(id))!, error: 'Mucho movimiento a la vez. Inténtalo otra vez.' };
}

/** Partidas entre los mismos dos en las últimas 24 h (para que no se pasen puntos entre amigos). */
async function pairCountToday(a: string, b: string, excludeId: string): Promise<number> {
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data } = await db().from('online_matches').select('id, player_a, player_b, result')
    .eq('mode', 'competitive').eq('settled', true).gte('created_at', since)
    .or(`and(player_a.eq.${a},player_b.eq.${b}),and(player_a.eq.${b},player_b.eq.${a})`).limit(50);
  return ((data ?? []) as { id: string; result: { rated?: boolean } }[]).filter((r) => r.id !== excludeId && r.result?.rated).length;
}

/**
 * Liquida una partida terminada: UNA vez (bandera `settled` cambiada en la misma
 * sentencia), aunque los dos jugadores pregunten a la vez.
 */
async function settle(row: MatchRow) {
  const { data: claimed } = await db().from('online_matches').update({ settled: true })
    .eq('id', row.id).eq('settled', false).select('id');
  if (!claimed || !claimed.length) return;

  const st = row.state;
  const def = gameDef(row.game_id)!;
  const competitive = row.mode === 'competitive';
  const voided = st.result === 'void';
  let rated = competitive && !voided;
  let reason = competitive ? '' : 'Partida casual: no cuenta para el rango.';
  if (rated && Math.abs(row.mmr_a - row.mmr_b) > config.antiAbuse.maxRatedGapMmr) {
    rated = false; reason = 'Demasiada diferencia de nivel: no cuenta para el rango.';
  }
  if (rated && (await pairCountToday(row.player_a, row.player_b, row.id)) >= config.antiAbuse.pairRatedPerDay) {
    rated = false; reason = 'Ya habéis jugado varias veces hoy: esta no cuenta para el rango.';
  }
  if (voided) reason = 'Partida anulada: nadie jugó.';

  const seconds = Math.max(0, Math.round(((st.endedAt || Date.now()) - st.startedAt) / 1000));
  const result: Record<string, unknown> = { rated, reason };
  const R = config.rewards[competitive ? 'competitive' : 'casual'];
  // El MMR global de cada uno, leído ANTES de cambiar nada.
  const [ga, gb] = competitive && !voided
    ? await Promise.all([ladder(row.player_a, row.season, GLOBAL), ladder(row.player_b, row.season, GLOBAL)])
    : [null, null];
  const oppGlobal: Record<Side, number> = { a: gb?.mmr ?? row.mmr_b, b: ga?.mmr ?? row.mmr_a };

  for (const side of ['a', 'b'] as Side[]) {
    const me = side === 'a' ? row.player_a : row.player_b;
    const oppMmr = side === 'a' ? row.mmr_b : row.mmr_a;
    const abandoned = st.abandon === side || st.abandon === 'both';
    if (abandoned) await recordAbandon(me);

    const outcome: Outcome = voided ? 'loss' : st.result === 'draw' ? 'draw' : st.result === side ? 'win' : 'loss';
    let coins = 0;
    let xp = 0;
    if (!voided && !abandoned && (await rewardedToday(me)) < config.antiAbuse.rewardedMatchesPerDay) {
      coins = outcome === 'win' ? R.winCents : outcome === 'loss' ? R.lossCents : R.drawCents;
      xp = outcome === 'win' ? R.winXp : outcome === 'loss' ? R.lossXp : R.drawXp;
      const label = (outcome === 'win' ? 'Victoria' : outcome === 'loss' ? 'Derrota' : 'Empate') + ' ' + (competitive ? 'competitiva' : 'casual') + ' · ' + def.name;
      if (!(await deliver(me, 'match:' + row.id, coins, [], label))) { coins = 0; xp = 0; }
    }

    let game: RatingChange | null = null;
    let global: RatingChange | null = null;
    let rewards: { label: string; coinsCents: number; cosmetics: string[] }[] = [];
    // Casual no toca nada del competitivo. Una partida anulada tampoco.
    if (competitive && !voided) {
      // Quien abandona pierde y paga la penalización aunque la partida no contara.
      const countRated = rated || abandoned;
      game = await updateLadder(me, row.season, row.game_id, oppMmr, outcome, countRated, abandoned, { chips: coins, seconds });
      global = await updateLadder(me, row.season, GLOBAL, oppGlobal[side], outcome, countRated, abandoned, { chips: coins, seconds });
      if (countRated) {
        await bestFor(me, row.game_id, game.divisionAfter, game.pointsAfter, row.season);
        await bestFor(me, GLOBAL, global.divisionAfter, global.pointsAfter, row.season);
        rewards = await rankRewards(me, row.season, Math.max(game.divisionAfter, global.divisionAfter), Math.max(game.pointsAfter, global.pointsAfter));
      }
    }

    result[side] = { outcome: voided ? 'void' : outcome, abandoned, coinsCents: coins, xp, game, global, rankRewards: rewards };
  }

  await db().from('online_matches').update({ result }).eq('id', row.id);
}

/** Lo que ve un jugador de su partida (y, si ha terminado, su resultado). */
export function matchView(row: MatchRow, playerId: string) {
  const side = sideOf(row, playerId)!;
  const o = other(side);
  const def = gameDef(row.game_id)!;
  const v = viewFor(def, row.state, side, Date.now());
  const me = side === 'a' ? { name: row.name_a, avatar: row.avatar_a, mmr: row.mmr_a, points: row.points_a } : { name: row.name_b, avatar: row.avatar_b, mmr: row.mmr_b, points: row.points_b };
  const them = side === 'a' ? { name: row.name_b, avatar: row.avatar_b, mmr: row.mmr_b, points: row.points_b } : { name: row.name_a, avatar: row.avatar_a, mmr: row.mmr_a, points: row.points_a };
  const dMe = divisionFor(config, me.points);
  const dThem = divisionFor(config, them.points);
  const res = (row.result ?? {}) as Record<string, unknown>;
  const mine = res[side] as Record<string, unknown> | undefined;
  return {
    matchId: row.id,
    gameId: row.game_id,
    gameName: def.name,
    competitive: row.mode === 'competitive',
    myName: me.name, myAvatar: me.avatar, myMmr: me.mmr, myPoints: me.points, myLabel: dMe.label, myTier: dMe.tierId, myDivision: dMe.index,
    theirName: them.name, theirAvatar: them.avatar, theirMmr: them.mmr, theirPoints: them.points, theirLabel: dThem.label, theirTier: dThem.tierId, theirDivision: dThem.index,
    ...v,
    settled: !!row.settled && !!mine,
    rated: !!res.rated,
    ratedReason: String(res.reason ?? ''),
    ...(mine ? flattenResult(mine) : flattenResult({})),
    opponentSide: o,
  };
}

function flattenResult(r: Record<string, unknown>) {
  const g = (r.game ?? null) as RatingChange | null;
  const gl = (r.global ?? null) as RatingChange | null;
  const d = (i: number) => divisionByIndex(config, i);
  const prog = (points: number) => {
    const x = divisionFor(config, points);
    return x.to > 0 ? Math.max(0, Math.min(1, (points - x.from) / (x.to - x.from))) : 1;
  };
  return {
    resOutcome: String(r.outcome ?? ''),
    resCoinsCents: Number(r.coinsCents ?? 0),
    resXp: Number(r.xp ?? 0),
    resHasGame: !!g,
    resPointsBefore: g?.pointsBefore ?? 0,
    resPointsAfter: g?.pointsAfter ?? 0,
    resPointsDelta: g?.pointsDelta ?? 0,
    resMmrBefore: g?.mmrBefore ?? 0,
    resMmrAfter: g?.mmrAfter ?? 0,
    resLabelBefore: g ? d(g.divisionBefore).label : '',
    resLabelAfter: g ? d(g.divisionAfter).label : '',
    resTierBefore: g ? d(g.divisionBefore).tierId : '',
    resTierAfter: g ? d(g.divisionAfter).tierId : '',
    resDivisionAfter: g?.divisionAfter ?? 0,
    resProgress: g ? prog(g.pointsAfter) : 0,
    resNextLabel: g && d(g.divisionAfter).to > 0 ? d(g.divisionAfter + 1).label : '',
    resPromoted: !!g?.promoted,
    resDemoted: !!g?.demoted,
    resProtected: !!g?.protectedFall,
    resNewPeak: !!g?.newPeak,
    resStreakBefore: g?.streakBefore ?? 0,
    resStreakAfter: g?.streakAfter ?? 0,
    resGlobalDelta: gl?.pointsDelta ?? 0,
    resGlobalAfter: gl?.pointsAfter ?? 0,
    resGlobalLabel: gl ? d(gl.divisionAfter).label : '',
    resGlobalPromoted: !!gl?.promoted,
    resRewards: ((r.rankRewards ?? []) as { label: string; coinsCents: number; cosmetics: string[] }[]),
  };
}

// ---------------------------------------------------------------------------- cola

export interface Ticket { player_id: string; game_id: string; mode: Mode; mmr: number; joined_at: string; ping_at: string; match_id: string | null }

export async function loadTicket(playerId: string): Promise<Ticket | null> {
  const { data } = await db().from('online_mm_queue').select('*').eq('player_id', playerId).maybeSingle();
  return (data as Ticket) ?? null;
}

export async function searchingCount(gameId: string, mode: Mode): Promise<number> {
  const since = new Date(Date.now() - config.matchmaking.ticketStaleSeconds * 1000).toISOString();
  const { count } = await db().from('online_mm_queue').select('player_id', { count: 'exact', head: true })
    .eq('game_id', gameId).eq('mode', mode).is('match_id', null).gte('ping_at', since);
  return count ?? 0;
}

export async function lastOpponent(playerId: string): Promise<string | null> {
  const since = new Date(Date.now() - config.matchmaking.avoidRecentOpponentMinutes * 60000).toISOString();
  const { data } = await db().from('online_matches').select('player_a, player_b')
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1);
  const r = ((data ?? []) as { player_a: string; player_b: string }[])[0];
  if (!r) return null;
  return r.player_a === playerId ? r.player_b : r.player_a;
}

export { abandon, placeBet, playAction, setReady, mmrWindow, seasonAt, legendTitle };
