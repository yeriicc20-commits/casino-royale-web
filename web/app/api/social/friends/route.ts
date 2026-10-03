import {
  corsPreflight, currentUser, db, isOnline, json, needsAccount, PlayerRow,
  secondsSince,
} from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { playerIdOf } from '@/lib/ranking';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * POST /api/social/friends   { playerId }
 *
 * La lista de amigos. Conectados primero y, dentro de cada grupo, quien se dejó
 * ver más recientemente: lo que busca alguien que abre esta pantalla es a quién
 * puede retar AHORA.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const playerId = await playerIdOf(user.id);

  const client = db();

  // Dos consultas y no un "join": las amistades ya no cuelgan de la fila del
  // jugador (16_amigos_y_dispositivo.sql), así que una amistad con alguien que
  // aún no ha vuelto a entrar sigue saliendo, con los datos de su cuenta.
  const { data: links, error } = await client
    .from('online_friends')
    .select('friend_id')
    .eq('player_id', playerId);

  if (error) {
    console.error('[social/friends]', error);
    return json({ friends: [] });
  }

  const ids: string[] = [...new Set<string>(((links ?? []) as { friend_id: string }[]).map((l: { friend_id: string }) => String(l.friend_id)))];
  if (!ids.length) return json({ friends: [] });

  const [players, profiles] = await Promise.all([
    client.from('online_players').select('*').in('player_id', ids),
    client.from('profiles').select('id, display_name, avatar_index, friend_code').in('id', ids.filter((id: string) => isUuid(id))),
  ]);

  const byId = new Map<string, PlayerRow>();
  for (const row of (players.data ?? []) as PlayerRow[]) byId.set(String(row.player_id), row);
  for (const pr of (profiles.data ?? []) as { id: string; display_name: string; avatar_index: number; friend_code: string | null }[]) {
    if (byId.has(String(pr.id))) continue;
    byId.set(String(pr.id), {
      player_id: String(pr.id), name: pr.display_name || 'Jugador', avatar_id: Number(pr.avatar_index || 0),
      friend_code: pr.friend_code, balance_cents: 0, biggest_win_cents: 0, rounds: 0, last_seen: '',
    });
  }

  const friends = ids
    .map((id: string) => byId.get(id))
    .filter((row): row is PlayerRow => Boolean(row))
    .map((row) => ({
      playerId: row.player_id,
      name: row.name,
      avatarId: row.avatar_id,
      friendCode: row.friend_code ?? '',
      online: row.last_seen ? isOnline(row.last_seen) : false,
      secondsSinceSeen: row.last_seen ? secondsSince(row.last_seen) : -1,
      balanceCents: row.balance_cents,
    }));

  friends.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;

    // -1 significa "nunca visto", y eso va al final, no al principio.
    const left = a.secondsSinceSeen < 0 ? Number.MAX_SAFE_INTEGER : a.secondsSinceSeen;
    const right = b.secondsSinceSeen < 0 ? Number.MAX_SAFE_INTEGER : b.secondsSinceSeen;
    return left - right;
  });

  return json({ friends });
}

export async function OPTIONS() {
  return corsPreflight();
}
