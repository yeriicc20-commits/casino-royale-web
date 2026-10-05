import 'server-only';

import { db } from '@/lib/online';
import type { Instance } from './schedule';
import { rewardsReady } from './schedule';
import { applyRounds, cash, risk, type ApplyResult } from './engine';
import { config, deliver, loadRow, mutate, rankOf, rng, secret, type ProgressRow } from './store';
import type { CoinAward, EventDef, Feedback, PlayerState, RoundIn } from './types';

/**
 * Lo que un jugador HACE en un evento, sin la respuesta HTTP alrededor.
 *
 * Vivía dentro de app/api/live/events y ahora está aquí para que la ruta del
 * juego y los bots (lib/bots) usen exactamente el mismo código: mismas reglas,
 * mismos límites, mismas llaves de premio. Un bot no tiene un atajo propio.
 */

/** El premio de ranking (o de participación) que le toca a un puesto. */
export function tierFor(def: EventDef, rank: number, rounds: number, score: number) {
  if (score > 0) {
    const ranked = def.rewards.find((r) => !r.participation && r.fromRank != null && r.toRank != null && rank >= r.fromRank && rank <= r.toRank);
    if (ranked) return ranked;
  }
  return def.rewards.find((r) => r.participation && rounds >= (r.minRounds ?? 1)) ?? null;
}

const EMPTY: ApplyResult = { feedback: [], awards: [], counted: 0, ignored: 0, lowStake: 0 };

/** Rondas jugadas -> puntos. Un lote repetido (mismo reportId) no cuenta dos veces. */
export async function reportRounds(
  playerId: string, inst: Instance, def: EventDef, reportId: string, rounds: RoundIn[], nowMs = Date.now(),
): Promise<{ state: PlayerState; row: ProgressRow; applied: ApplyResult }> {
  const list = rounds.slice(0, config.limits.maxRoundsPerReport);
  let applied: ApplyResult = EMPTY;
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    if (st.reports.includes(reportId)) {
      applied = { ...EMPTY, feedback: [], awards: [] };
      return;
    }
    applied = applyRounds(config, def, inst, st, list, nowMs, rng, secret(), reportId);
    st.reports = [...st.reports, reportId].slice(-64);
  });
  if (applied.ignored > 0) console.warn('[events] rondas ignoradas', playerId, inst.id, applied.ignored);
  await deliver(playerId, inst.id, applied.awards);
  return { state, row, applied };
}

/** Todo o Nada: arriesgar el bote o cobrarlo. */
export async function riskOrCash(playerId: string, inst: Instance, def: EventDef, op: 'risk' | 'cash') {
  let result = { ok: false, message: '', feedback: [] as Feedback[] };
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    result = op === 'risk' ? risk(def, st, rng) : cash(def, st);
  });
  return { state, row, result };
}

/**
 * Caza del Tesoro: abrir el cofre (una vez, con todos los objetivos hechos).
 * `owned` son los cosméticos que ya tiene: el cofre no repite.
 */
export async function openChest(playerId: string, inst: Instance, def: EventDef, owned: Set<string>) {
  const chest = def.chest!;
  const pool = chest.cosmeticsPool.filter((c) => !owned.has(c));
  const pick = pool.length ? pool[Math.floor(rng() * pool.length)] : '';

  let ready = false;
  const { state, row } = await mutate(playerId, inst, def, (st) => {
    ready = !st.chestClaimed && (def.objectives ?? []).every((o) => st.done.includes(o.id));
    if (ready) st.chestClaimed = true;
  });
  if (!ready) return { ok: false as const, state, row, award: null };

  const award: CoinAward = {
    claimId: inst.id + ':chest',
    cents: chest.coinsCents + (pick ? 0 : chest.duplicateCoinsCents),
    reason: 'Cofre del tesoro',
    cosmetics: pick ? [pick] : [],
  };
  await deliver(playerId, inst.id, [award]);
  return { ok: true as const, state, row, award };
}

export type ClaimOutcome =
  | { ok: false; message: string }
  | { ok: true; rank: number; tier: ReturnType<typeof tierFor>; awards: CoinAward[] };

/** Recoger el premio de un evento terminado. Marca primero: dos toques no cobran dos veces. */
export async function claimReward(playerId: string, inst: Instance, def: EventDef, nowMs = Date.now()): Promise<ClaimOutcome> {
  if (!rewardsReady(config, inst, nowMs)) return { ok: false, message: 'Los premios se reparten en cuanto cierre el evento.' };

  const row = await loadRow(playerId, inst.id);
  if (!row || row.rounds <= 0) return { ok: false, message: 'No participaste en ese evento.' };
  if (row.claimed) return { ok: false, message: 'Ya recogiste este premio.' };

  const score = Number(row.final_score);
  const rank = score > 0 ? await rankOf(inst.id, score, 'final_score') : 0;
  const tier = tierFor(def, rank, row.rounds, score);

  const { data: marked } = await db().from('online_event_progress').update({ claimed: true })
    .eq('player_id', playerId).eq('instance_id', inst.id).eq('claimed', false).select('player_id');
  if (!marked || !marked.length) return { ok: false, message: 'Ya recogiste este premio.' };

  const awards: CoinAward[] = [];
  if (tier) awards.push({ claimId: inst.id + ':rank', cents: tier.coinsCents, reason: 'Evento ' + def.name + ' · ' + tier.label, cosmetics: tier.cosmetics });
  for (const u of def.unlocks ?? []) {
    if (u.maxRank && rank > 0 && rank <= u.maxRank) awards.push({ claimId: inst.id + ':unlock:' + u.id, cents: 0, reason: u.label, cosmetics: u.cosmetics, perk: u.perk });
  }
  await deliver(playerId, inst.id, awards);
  return { ok: true, rank, tier, awards };
}
