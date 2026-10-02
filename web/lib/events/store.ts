import 'server-only';

import { randomBytes } from 'node:crypto';
import { db } from '@/lib/online';
import rawConfig from './config.json';
import type { CoinAward, EventDef, EventsConfig, Perk, PlayerState } from './types';
import {
  finalScore, liveScore, loadState, newState,
} from './engine';
import { instanceById, previousDayInstance, type Instance } from './schedule';

/**
 * La parte de los eventos que habla con la base de datos.
 *
 * Todo lo que se escribe sobre un jugador pasa por `mutate`, que lee la fila,
 * aplica el cambio y la guarda SOLO si nadie la ha tocado entre medias (columna
 * version). Si dos peticiones se cruzan -el móvil y el PC de la misma cuenta,
 * o un reintento- la segunda vuelve a leer y a aplicar, en vez de pisar.
 */

export const config = rawConfig as unknown as EventsConfig;

/** Clave para sortear la hora del CAOS TOTAL y las mesas especiales. Nunca sale del servidor. */
export function secret(): string {
  return process.env.EVENTS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'casino-eventos';
}

/** Número aleatorio [0,1) con el generador criptográfico. */
export function rng(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

export function defOf(eventId: string): EventDef | null {
  return config.events[eventId] ?? null;
}

export interface ProgressRow {
  player_id: string;
  instance_id: string;
  event_id: string;
  name: string;
  avatar_id: number;
  vip: boolean;
  score: number;
  final_score: number;
  jackpots: number;
  best_jackpot: number;
  streak: number;
  best_streak: number;
  rounds: number;
  state: unknown;
  version: number;
  claimed: boolean;
  updated_at: string;
}

export async function loadRow(playerId: string, instanceId: string): Promise<ProgressRow | null> {
  const { data, error } = await db().from('online_event_progress').select('*')
    .eq('player_id', playerId).eq('instance_id', instanceId).maybeSingle();
  if (error) throw new Error('EVENTS_TABLE: ' + error.message);
  return (data as ProgressRow) ?? null;
}

export async function identity(playerId: string): Promise<{ name: string; avatarId: number }> {
  const { data } = await db().from('online_players').select('name, avatar_id').eq('player_id', playerId).maybeSingle();
  const row = data as { name: string; avatar_id: number } | null;
  return { name: row?.name || 'Jugador', avatarId: Number(row?.avatar_id || 0) };
}

/** Las ventajas que trae este jugador al evento (el Pase VIP del viernes para el sábado). */
export async function perksFor(playerId: string, inst: Instance): Promise<{ streakShields: number; vip: boolean; from: string[] }> {
  const out = { streakShields: 0, vip: false, from: [] as string[] };
  if (inst.slot !== 'weekly') return out;
  const friday = previousDayInstance(config, inst);
  if (!friday) return out;
  const fridayDef = defOf(friday.eventId);

  // Los desbloqueos por puesto del viernes se calculan aquí también: si alguien no
  // abrió el juego entre el viernes y el sábado, no por eso se queda sin ellos.
  if (fridayDef?.unlocks?.some((u) => u.maxRank)) {
    const row = await loadRow(playerId, friday.id).catch(() => null);
    if (row && row.rounds > 0 && Number(row.final_score) > 0) {
      const rank = await rankOf(friday.id, Number(row.final_score), 'final_score');
      for (const u of fridayDef.unlocks) {
        if (u.maxRank && rank <= u.maxRank) {
          await insertClaim(playerId, friday.id, { claimId: friday.id + ':unlock:' + u.id, cents: 0, reason: u.label, cosmetics: u.cosmetics, perk: u.perk });
        }
      }
    }
  }

  const { data } = await db().from('online_event_claims').select('claim_id, perk')
    .eq('player_id', playerId).like('claim_id', friday.id + ':unlock:%');
  for (const c of (data ?? []) as { claim_id: string; perk: Perk }[]) {
    out.streakShields += Number(c.perk?.streakShields || 0);
    if (c.perk?.vip) out.vip = true;
    out.from.push(c.claim_id);
  }
  return out;
}

/** Puesto de una puntuación en un evento (empates comparten puesto). */
export async function rankOf(instanceId: string, score: number, column: 'score' | 'final_score' = 'score'): Promise<number> {
  const { count } = await db().from('online_event_progress').select('player_id', { count: 'exact', head: true })
    .eq('instance_id', instanceId).gt('rounds', 0).gt(column, score);
  return (count ?? 0) + 1;
}

export async function participants(instanceId: string): Promise<number> {
  const { count } = await db().from('online_event_progress').select('player_id', { count: 'exact', head: true })
    .eq('instance_id', instanceId).gt('rounds', 0);
  return count ?? 0;
}

/**
 * Lee, cambia y guarda con control de versión. `change` puede ejecutarse más de
 * una vez (si hay choque se repite con la fila nueva), así que no debe tener
 * efectos fuera del estado: los premios se entregan DESPUÉS, con su llave única.
 */
export async function mutate<T>(
  playerId: string, inst: Instance, def: EventDef,
  change: (st: PlayerState, fresh: boolean) => T,
): Promise<{ state: PlayerState; result: T; row: ProgressRow }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await loadRow(playerId, inst.id);
    const fresh = !row;
    const st = row ? loadState(def, row.state) : newState(def);

    if (fresh) st.perks = await perksFor(playerId, inst);
    const result = change(st, fresh);

    const who = await identity(playerId);
    const values = {
      event_id: inst.eventId,
      name: who.name,
      avatar_id: who.avatarId,
      vip: st.perks.vip,
      score: liveScore(def, st),
      final_score: finalScore(def, st),
      jackpots: st.jackpots.reduce((a, b) => a + b, 0),
      best_jackpot: st.bestJackpot,
      streak: st.streak,
      best_streak: st.bestStreak,
      rounds: st.rounds,
      state: st,
      updated_at: new Date().toISOString(),
    };

    if (fresh) {
      const { data, error } = await db().from('online_event_progress')
        .upsert({ player_id: playerId, instance_id: inst.id, version: 1, ...values }, { onConflict: 'player_id,instance_id', ignoreDuplicates: true })
        .select('*');
      if (error) throw new Error('EVENTS_TABLE: ' + error.message);
      if (data && data.length) return { state: st, result, row: data[0] as ProgressRow };
      continue; // alguien la creó a la vez: se repite sobre la suya
    }

    const { data, error } = await db().from('online_event_progress')
      .update({ ...values, version: row!.version + 1 })
      .eq('player_id', playerId).eq('instance_id', inst.id).eq('version', row!.version)
      .select('*');
    if (error) throw new Error('EVENTS_TABLE: ' + error.message);
    if (data && data.length) return { state: st, result, row: data[0] as ProgressRow };
  }
  throw new Error('BUSY');
}

/**
 * Apunta una recompensa. Devuelve true solo la PRIMERA vez para esa llave: es lo
 * que impide cobrar dos veces el mismo jackpot, cofre o puesto.
 */
export async function insertClaim(playerId: string, instanceId: string, award: CoinAward): Promise<boolean> {
  const { data, error } = await db().from('online_event_claims')
    .upsert({
      player_id: playerId,
      claim_id: award.claimId,
      instance_id: instanceId,
      coins_cents: award.cents,
      cosmetics: award.cosmetics ?? [],
      perk: award.perk ?? {},
    }, { onConflict: 'player_id,claim_id', ignoreDuplicates: true })
    .select('claim_id');
  if (error) {
    console.error('[events.claim]', error);
    return false;
  }
  return !!(data && data.length);
}

/** Da fichas por la cola de ajustes (la misma del panel y de los retos). */
export async function pay(playerId: string, cents: number, reason: string) {
  if (cents <= 0) return;
  const client = db();
  const { error } = await client.rpc('admin_adjust_player', {
    p_player_id: playerId, p_amount_cents: cents, p_reason: reason, p_actor: null,
  });
  if (!error) return;
  await client.from('online_grants').insert({ player_id: playerId, amount_cents: cents, reason });
}

/** Entrega las recompensas nuevas: apunta (una vez) y paga. */
export async function deliver(playerId: string, instanceId: string, awards: CoinAward[]) {
  for (const a of awards) {
    if (await insertClaim(playerId, instanceId, a)) await pay(playerId, a.cents, a.reason);
  }
}

/** Lo pendiente de cobrar, marcado como entregado en la misma sentencia. */
export async function claimGrants(playerId: string) {
  const { data, error } = await db().rpc('online_grant_claim', { p_player_id: playerId });
  if (error || !data) return [];
  return (data as { id: number; amount_cents: number; reason: string }[])
    .map((g) => ({ id: Number(g.id), amountCents: Number(g.amount_cents), reason: g.reason || '' }));
}

/** Todos los cosméticos que este jugador ha ganado en eventos (para que el juego se ponga al día). */
export async function cosmeticsOf(playerId: string): Promise<string[]> {
  const { data } = await db().from('online_event_claims').select('cosmetics').eq('player_id', playerId).limit(1000);
  const set = new Set<string>();
  for (const r of (data ?? []) as { cosmetics: string[] }[]) for (const c of r.cosmetics ?? []) set.add(String(c));
  return [...set];
}

export function instanceOf(id: string): Instance | null {
  return instanceById(config, id);
}
