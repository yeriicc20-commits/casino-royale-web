import {
  body, corsPreflight, currentUser, db, json, needsAccount, text,
} from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { playerIdOf } from '@/lib/ranking';
import {
  activeInstance, acceptsReports, nextInstance, rewardsReady, type Instance,
} from '@/lib/events/schedule';
import {
  applyRounds, cash, contextAt, finalScore, fmtEuros, liveScore, loadState, newState, risk, type ApplyResult,
} from '@/lib/events/engine';
import { eventView, meView } from '@/lib/events/view';
import {
  claimGrants, config, cosmeticsOf, defOf, deliver, instanceOf, loadRow, mutate,
  participants, perksFor, rankOf, rng, secret, type ProgressRow,
} from '@/lib/events/store';
import type { CoinAward, EventDef, Feedback, PlayerState, RoundIn } from '@/lib/events/types';

/**
 * POST /api/live/events   { op, ... }
 *
 * Lo que pasa DENTRO de los eventos (los horarios ya existían y no se tocan):
 *
 *   { op: "state", instanceId? }                 qué hay ahora, mi progreso, premios por recoger
 *   { op: "report", instanceId, reportId, rounds } rondas jugadas -> puntos (los calcula el servidor)
 *   { op: "risk" | "cash", instanceId }          Todo o Nada: arriesgar o cobrar
 *   { op: "chest", instanceId }                  Caza del Tesoro: abrir el cofre
 *   { op: "ranking", instanceId, sort? }         clasificación del evento
 *   { op: "claim", instanceId }                  recoger el premio de un evento terminado
 *
 * Siempre responde 200 (ver lib/online.ts): una negativa razonada viaja en
 * { ok:false, message }.
 */
export const dynamic = 'force-dynamic';

const RANK_LIMIT = 100;

interface Input {
  op?: string;
  instanceId?: string;
  reportId?: string;
  rounds?: RoundIn[];
  sort?: string;
}

function base() {
  return {
    ok: true,
    message: '',
    serverUtc: new Date().toISOString(),
    hasActive: false,
    active: {},
    upcoming: [] as unknown[],
    hasMe: false,
    me: {},
    feedback: [] as Feedback[],
    grants: [] as unknown[],
    unclaimed: [] as unknown[],
    cosmetics: [] as string[],
    hasRanking: false,
    ranking: {},
    hasClaimResult: false,
    claimResult: {},
  };
}

function fail(message: string) {
  return json({ ...base(), ok: false, message });
}

// ---------------------------------------------------------------------------- vistas

async function rankingView(instanceId: string, def: EventDef, closed: boolean, sort: string, me: string) {
  const column = closed ? 'final_score' : 'score';
  let q = db().from('online_event_progress')
    .select('player_id, name, avatar_id, vip, score, final_score, jackpots, best_jackpot, streak, best_streak, rounds')
    .eq('instance_id', instanceId).gt('rounds', 0);
  if (sort === 'jackpots') q = q.order('jackpots', { ascending: false }).order('best_jackpot', { ascending: false }).order(column, { ascending: false });
  else if (sort === 'best') q = q.order('best_jackpot', { ascending: false }).order('jackpots', { ascending: false }).order(column, { ascending: false });
  else q = q.order(column, { ascending: false }).order('updated_at', { ascending: true });
  const { data } = await q.limit(RANK_LIMIT);

  type R = Pick<ProgressRow, 'player_id' | 'name' | 'avatar_id' | 'vip' | 'score' | 'final_score' | 'jackpots' | 'best_jackpot' | 'streak' | 'best_streak'>;
  const rows = (data ?? []) as R[];
  const entry = (r: R, rank: number) => ({
    rank,
    playerId: r.player_id,
    name: r.name || 'Jugador',
    avatarId: Number(r.avatar_id || 0),
    score: Number(closed ? r.final_score : r.score),
    streak: Number(r.streak || 0),
    bestStreak: Number(r.best_streak || 0),
    jackpots: Number(r.jackpots || 0),
    bestJackpot: Number(r.best_jackpot ?? -1),
    vip: !!r.vip,
    me: r.player_id === me,
  });
  const entries = rows.map((r, i) => entry(r, i + 1));
  const total = await participants(instanceId);

  let you = entries.find((e) => e.me) ?? null;
  if (!you) {
    const mine = await loadRow(me, instanceId).catch(() => null);
    if (mine && mine.rounds > 0) {
      const score = Number(closed ? mine.final_score : mine.score);
      you = entry(mine, await rankOf(instanceId, score, column));
    }
  }
  return { instanceId, sort: sort || def.rankBy, total, entries, hasYou: !!you, you: you ?? {} };
}

async function meFor(_playerId: string, def: EventDef, inst: Instance, st: PlayerState, participating: boolean) {
  const now = Date.now();
  const closed = now >= inst.closesMs;
  const column = closed ? 'final_score' : 'score';
  const score = closed ? finalScore(def, st) : liveScore(def, st);
  const rank = participating && score > 0 ? await rankOf(inst.id, score, column) : 0;
  const total = await participants(inst.id);
  const ctx = contextAt(config, def, inst, Math.min(Math.max(now, inst.opensMs), inst.closesMs - 1), secret());
  return meView(def, st, rank, total, participating, ctx.phaseIndex);
}

/** El estado de un jugador en un evento, sin crear la fila si aún no ha jugado. */
async function stateFor(playerId: string, def: EventDef, inst: Instance): Promise<{ st: PlayerState; participating: boolean }> {
  const row = await loadRow(playerId, inst.id);
  if (row) return { st: loadState(def, row.state), participating: row.rounds > 0 };
  const st = newState(def);
  st.perks = await perksFor(playerId, inst).catch(() => st.perks);
  return { st, participating: false };
}

function tierFor(def: EventDef, rank: number, rounds: number, score: number) {
  if (score > 0) {
    const ranked = def.rewards.find((r) => !r.participation && r.fromRank != null && r.toRank != null && rank >= r.fromRank && rank <= r.toRank);
    if (ranked) return ranked;
  }
  return def.rewards.find((r) => r.participation && rounds >= (r.minRounds ?? 1)) ?? null;
}

/** Eventos terminados con premio sin recoger (los sin premio se dan por cerrados). */
async function unclaimedFor(playerId: string) {
  const since = new Date(Date.now() - config.schedule.claimWindowDays * 86400000).toISOString();
  const { data } = await db().from('online_event_progress').select('*')
    .eq('player_id', playerId).eq('claimed', false).gt('rounds', 0).gte('created_at', since).limit(20);
  const out: unknown[] = [];
  for (const row of (data ?? []) as ProgressRow[]) {
    const inst = instanceOf(row.instance_id);
    const def = inst ? defOf(inst.eventId) : null;
    if (!inst || !def || !rewardsReady(config, inst, Date.now())) continue;
    const score = Number(row.final_score);
    const rank = score > 0 ? await rankOf(inst.id, score, 'final_score') : 0;
    const tier = tierFor(def, rank, row.rounds, score);
    if (!tier) {
      await db().from('online_event_progress').update({ claimed: true }).eq('player_id', playerId).eq('instance_id', inst.id);
      continue;
    }
    out.push({
      instanceId: inst.id,
      eventId: inst.eventId,
      name: def.name,
      date: inst.date,
      rank,
      total: await participants(inst.id),
      score,
      rewardLabel: tier.label,
      coinsCents: tier.coinsCents,
      cosmetics: tier.cosmetics,
    });
  }
  return out;
}

async function upcoming() {
  const now = Date.now();
  const list: unknown[] = [];
  for (const slot of ['daily', 'weekly'] as const) {
    const inst = nextInstance(config, slot, now);
    const def = inst ? defOf(inst.eventId) : null;
    if (inst && def) list.push(eventView(config, def, inst.eventId, inst, now, secret()));
  }
  return list;
}

// ---------------------------------------------------------------------------- operaciones

async function opState(playerId: string, input: Input) {
  const now = Date.now();
  const out = base();
  out.upcoming = await upcoming();

  const requested = input.instanceId ? instanceOf(text(input.instanceId, 24)) : null;
  const inst = requested ?? activeInstance(config, now);
  const def = inst ? defOf(inst.eventId) : null;

  if (inst && def && now >= inst.opensMs - 6 * 3600000) {
    out.hasActive = now >= inst.opensMs && now < inst.closesMs;
    out.active = eventView(config, def, inst.eventId, inst, now, secret());
    const { st, participating } = await stateFor(playerId, def, inst);
    out.hasMe = true;
    out.me = await meFor(playerId, def, inst, st, participating);
  }

  out.unclaimed = await unclaimedFor(playerId);
  out.cosmetics = await cosmeticsOf(playerId);
  out.grants = await claimGrants(playerId);
  return json(out);
}

async function opReport(playerId: string, input: Input) {
  const now = Date.now();
  const inst = instanceOf(text(input.instanceId, 24));
  const def = inst ? defOf(inst.eventId) : null;
  if (!inst || !def) return fail('Ese evento no existe.');
  if (!acceptsReports(config, inst, now)) return fail(now < inst.opensMs ? 'El evento todavía no ha empezado.' : 'El evento ya ha terminado.');

  const reportId = text(input.reportId, 48);
  if (!reportId) return fail('Falta el identificador del lote.');
  const rounds = Array.isArray(input.rounds) ? input.rounds.slice(0, config.limits.maxRoundsPerReport) : [];

  let applied: ApplyResult = { feedback: [], awards: [], counted: 0, ignored: 0, lowStake: 0 };
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    if (st.reports.includes(reportId)) {
      applied = { feedback: [], awards: [], counted: 0, ignored: 0, lowStake: 0 };
      return;
    }
    applied = applyRounds(config, def, inst, st, rounds, now, rng, secret(), reportId);
    st.reports = [...st.reports, reportId].slice(-64);
  });

  if (applied.ignored > 0) console.warn('[events] rondas ignoradas', playerId, inst.id, applied.ignored);
  await deliver(playerId, inst.id, applied.awards);

  const out = base();
  out.active = eventView(config, def, inst.eventId, inst, now, secret());
  out.hasActive = now < inst.closesMs;
  out.hasMe = true;
  out.me = await meFor(playerId, def, inst, state, row.rounds > 0);
  out.feedback = applied.feedback;
  if (applied.lowStake > 0 && applied.counted === 0) {
    out.feedback.push({ type: 'low_stake', title: 'NO CUENTA', detail: 'En ' + def.name + ' solo cuentan apuestas de ' + fmtEuros(Math.max(config.limits.minStakeCents, def.minStakeCents ?? 0)) + ' o más', tier: 0, points: 0, color: '#9AA3BF', sound: 'ui.error', fx: '' });
  }
  out.grants = applied.awards.some((a) => a.cents > 0) ? await claimGrants(playerId) : [];
  if (applied.awards.some((a) => a.cosmetics.length)) out.cosmetics = await cosmeticsOf(playerId);
  return json(out);
}

async function opRisk(playerId: string, input: Input, op: 'risk' | 'cash') {
  const now = Date.now();
  const inst = instanceOf(text(input.instanceId, 24));
  const def = inst ? defOf(inst.eventId) : null;
  if (!inst || !def || def.kind !== 'risk') return fail('Este evento no tiene riesgo.');
  if (!(now >= inst.opensMs && now < inst.closesMs)) return fail('El evento no está abierto.');

  let result = { ok: false, message: '', feedback: [] as Feedback[] };
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    result = op === 'risk' ? risk(def, st, rng) : cash(def, st);
  });
  if (!result.ok) return fail(result.message);

  const out = base();
  out.active = eventView(config, def, inst.eventId, inst, now, secret());
  out.hasActive = true;
  out.hasMe = true;
  out.me = await meFor(playerId, def, inst, state, row.rounds > 0);
  out.feedback = result.feedback;
  return json(out);
}

async function opChest(playerId: string, input: Input) {
  const now = Date.now();
  const inst = instanceOf(text(input.instanceId, 24));
  const def = inst ? defOf(inst.eventId) : null;
  if (!inst || !def || !def.chest) return fail('Este evento no tiene cofre.');
  if (now > inst.closesMs + config.schedule.claimWindowDays * 86400000) return fail('Ese cofre ya caducó.');

  const owned = new Set(await cosmeticsOf(playerId));
  const pool = def.chest.cosmeticsPool.filter((c) => !owned.has(c));
  const pick = pool.length ? pool[Math.floor(rng() * pool.length)] : '';

  let ready = false;
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    ready = !st.chestClaimed && (def.objectives ?? []).every((o) => st.done.includes(o.id));
    if (ready) st.chestClaimed = true;
  });
  if (!ready) return fail(state.chestClaimed ? 'Ya abriste este cofre.' : 'Te faltan objetivos por completar.');

  const award: CoinAward = {
    claimId: inst.id + ':chest',
    cents: def.chest.coinsCents + (pick ? 0 : def.chest.duplicateCoinsCents),
    reason: 'Cofre del tesoro',
    cosmetics: pick ? [pick] : [],
  };
  await deliver(playerId, inst.id, [award]);

  const out = base();
  out.active = eventView(config, def, inst.eventId, inst, now, secret());
  out.hasActive = now >= inst.opensMs && now < inst.closesMs;
  out.hasMe = true;
  out.me = await meFor(playerId, def, inst, state, row.rounds > 0);
  out.hasClaimResult = true;
  out.claimResult = { instanceId: inst.id, title: '¡COFRE DEL TESORO!', coinsCents: award.cents, cosmetics: award.cosmetics, rank: 0, rewardLabel: 'COFRE' };
  out.feedback = [{ type: 'chest_open', title: '¡COFRE ABIERTO!', detail: '+' + fmtEuros(award.cents), tier: 2, points: 0, color: '#F5C451', sound: 'slot.jackpot', fx: 'coins' }];
  out.grants = await claimGrants(playerId);
  out.cosmetics = await cosmeticsOf(playerId);
  return json(out);
}

async function opRanking(playerId: string, input: Input) {
  const inst = instanceOf(text(input.instanceId, 24));
  const def = inst ? defOf(inst.eventId) : null;
  if (!inst || !def) return fail('Ese evento no existe.');
  const sort = text(input.sort, 12);
  const out = base();
  out.hasRanking = true;
  out.ranking = await rankingView(inst.id, def, Date.now() >= inst.closesMs, sort, playerId);
  return json(out);
}

async function opClaim(playerId: string, input: Input) {
  const now = Date.now();
  const inst = instanceOf(text(input.instanceId, 24));
  const def = inst ? defOf(inst.eventId) : null;
  if (!inst || !def) return fail('Ese evento no existe.');
  if (!rewardsReady(config, inst, now)) return fail('Los premios se reparten en cuanto cierre el evento.');

  const row = await loadRow(playerId, inst.id);
  if (!row || row.rounds <= 0) return fail('No participaste en ese evento.');
  if (row.claimed) return fail('Ya recogiste este premio.');

  const score = Number(row.final_score);
  const rank = score > 0 ? await rankOf(inst.id, score, 'final_score') : 0;
  const tier = tierFor(def, rank, row.rounds, score);

  // Primero se marca (solo si seguía sin marcar): dos toques a la vez no cobran dos veces.
  const { data: marked } = await db().from('online_event_progress').update({ claimed: true })
    .eq('player_id', playerId).eq('instance_id', inst.id).eq('claimed', false).select('player_id');
  if (!marked || !marked.length) return fail('Ya recogiste este premio.');

  const awards: CoinAward[] = [];
  if (tier) awards.push({ claimId: inst.id + ':rank', cents: tier.coinsCents, reason: 'Evento ' + def.name + ' · ' + tier.label, cosmetics: tier.cosmetics });
  for (const u of def.unlocks ?? []) {
    if (u.maxRank && rank > 0 && rank <= u.maxRank) awards.push({ claimId: inst.id + ':unlock:' + u.id, cents: 0, reason: u.label, cosmetics: u.cosmetics, perk: u.perk });
  }
  await deliver(playerId, inst.id, awards);

  const out = base();
  out.hasClaimResult = true;
  out.claimResult = {
    instanceId: inst.id,
    title: def.name,
    rank,
    rewardLabel: tier?.label ?? '',
    coinsCents: tier?.coinsCents ?? 0,
    cosmetics: awards.flatMap((a) => a.cosmetics),
  };
  out.grants = await claimGrants(playerId);
  out.cosmetics = await cosmeticsOf(playerId);
  out.unclaimed = await unclaimedFor(playerId);
  return json(out);
}

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();
  const playerId = (await playerIdOf(user.id)) ?? user.id;

  const input = await body<Input>(request);
  const op = text(input.op, 12) || 'state';

  try {
    switch (op) {
      case 'state': return await opState(playerId, input);
      case 'report': return await opReport(playerId, input);
      case 'risk': return await opRisk(playerId, input, 'risk');
      case 'cash': return await opRisk(playerId, input, 'cash');
      case 'chest': return await opChest(playerId, input);
      case 'ranking': return await opRanking(playerId, input);
      case 'claim': return await opClaim(playerId, input);
      default: return fail('Operación desconocida.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[live/events]', op, message);
    if (message.startsWith('EVENTS_TABLE')) return fail('Los eventos aún no están activados en el servidor.');
    if (message === 'BUSY') return fail('Mucho movimiento a la vez. Inténtalo otra vez.');
    return fail('No se ha podido completar.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
