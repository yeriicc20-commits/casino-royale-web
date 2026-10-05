import {
  body, corsPreflight, currentUser, json, needsAccount, text,
} from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { actDuel, createDuel, listDuels, respondDuel } from '@/lib/duel-service';

/**
 * POST /api/social/duel   { op, ... }
 *
 * Retos de blackjack entre amigos. Una sola ruta con varias operaciones:
 *
 *   { op: "list" }                                   mis retos (y lo que me deban pagar)
 *   { op: "create", friendId, stakeCents }           retar a un amigo
 *   { op: "respond", duelId, accept }                aceptar o rechazar
 *   { op: "act", duelId, action: "hit" | "stand" }   pedir carta o plantarse
 *
 * El mazo y las cartas del otro nunca salen del servidor hasta que los dos han
 * terminado. Siempre responde 200 (ver lib/online.ts): una negativa razonada
 * viaja en { ok:false, message }. Las reglas viven en lib/duel-service.ts, que
 * comparten el juego y los bots.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();
  const me = user.id;

  const input = await body<{ op?: string; friendId?: string; stakeCents?: number; duelId?: string; accept?: boolean; action?: string }>(request);
  const op = text(input.op, 16);

  if (op === 'list' || !op) return json(await listDuels(me));
  if (op === 'create') return json(await createDuel(me, text(input.friendId, 64), Number(input.stakeCents)));
  if (op === 'respond') return json(await respondDuel(me, text(input.duelId, 64), input.accept !== false));
  if (op === 'act') return json(await actDuel(me, text(input.duelId, 64), text(input.action, 8)));

  return json({ ok: false, message: 'Operación desconocida.', duels: [], grants: [] });
}

export async function OPTIONS() {
  return corsPreflight();
}
