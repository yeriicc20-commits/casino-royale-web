import { body, corsPreflight, currentUser, db, fail, needsAccount, ok, text, json }
  from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/social/friends/remove   { playerId, friendId }
 *
 * Borra las DOS direcciones. Dejar una viva haría que quien te quitó siguiera
 * apareciendo en la lista del otro.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ friendId?: string }>(request);

  const playerId = user.id;
  const friendId = text(input.friendId, 64);

  if (!friendId) return fail('Faltan datos.');

  const client = db();

  const [a, b] = await Promise.all([
    client.from('online_friends').delete().eq('player_id', playerId).eq('friend_id', friendId),
    client.from('online_friends').delete().eq('player_id', friendId).eq('friend_id', playerId),
  ]);

  if (a.error || b.error) {
    console.error('[social/friends/remove]', a.error ?? b.error);
    return fail('No se pudo quitar.');
  }

  return ok();
}

export async function OPTIONS() {
  return corsPreflight();
}
