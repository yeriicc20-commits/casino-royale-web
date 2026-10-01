import { db } from '@/lib/online';

/**
 * Frena los saldos imposibles en el modo en línea.
 *
 * El juego calcula el saldo en el móvil, así que alguien que modifique el juego
 * podría mandar el que quiera. Esto no lo hace imposible, pero corta lo más
 * descarado: un saldo solo puede subir lo que se puede ganar jugando (rondas ×
 * premio máximo), más los premios diarios por el tiempo que ha pasado y lo que
 * haya dado el panel de administración.
 */

/** Lo máximo que se puede ganar en una ronda (apuesta máxima × multiplicador alto). */
export const MAX_WIN_PER_ROUND_CENTS = 500_000 * 100;
/** Ruleta diaria, regalo, misiones, logros, liga... por cada día. */
export const BONUS_PER_DAY_CENTS = 50_000 * 100;

export interface WalletSnapshot {
  balanceCents: number;
  rounds: number;
  at: number; // ms
}

/** Lo que el panel ha dado a este jugador desde una fecha (positivo). */
async function grantsSince(playerIds: string[], sinceMs: number): Promise<number> {
  if (!playerIds.length) return 0;
  const { data, error } = await db()
    .from('online_grants')
    .select('amount_cents')
    .in('player_id', playerIds)
    .gt('amount_cents', 0)
    .gte('created_at', new Date(sinceMs - 10 * 60_000).toISOString());
  if (error) return 0;
  return (data ?? []).reduce((n, r) => n + Number((r as { amount_cents: number }).amount_cents || 0), 0);
}

/**
 * ¿Puede pasar de `prev` a `next`? Devuelve null si es posible, o el motivo.
 * Bajar siempre se puede.
 */
export async function impossibleJump(
  prev: WalletSnapshot | null,
  next: WalletSnapshot,
  playerIds: string[],
): Promise<string | null> {
  if (!prev) return null;
  const gained = next.balanceCents - prev.balanceCents;
  if (gained <= 0) return null;
  const rounds = Math.max(0, next.rounds - prev.rounds);
  const days = Math.max(0, (next.at - prev.at) / 86_400_000);
  let allowed = rounds * MAX_WIN_PER_ROUND_CENTS + BONUS_PER_DAY_CENTS * (1 + days);
  if (gained <= allowed) return null;
  allowed += await grantsSince(playerIds, prev.at);
  if (gained <= allowed) return null;
  return 'El saldo ha subido ' + Math.round(gained / 100) + ' € con ' + rounds + ' rondas: no es posible jugando.';
}

/** Saldo en línea de un sobre de guardado (el JSON que manda el juego). */
export function walletFromPayload(payload: string): { balanceCents: number; rounds: number } | null {
  try {
    const p = JSON.parse(payload) as { machineBank?: { balanceCents?: number; rounds?: number } };
    if (!p || !p.machineBank) return null;
    return { balanceCents: Number(p.machineBank.balanceCents || 0), rounds: Number(p.machineBank.rounds || 0) };
  } catch {
    return null;
  }
}
