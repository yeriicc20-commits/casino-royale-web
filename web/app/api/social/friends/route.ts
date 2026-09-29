import {
  body, corsPreflight, currentUser, db, isOnline, json, needsAccount, PlayerRow,
  secondsSince, text,
} from '@/lib/online';

/**
 * POST /api/social/friends   { playerId }
 *
 * La lista de amigos. Conectados primero y, dentro de cada grupo, quien se dejó
 * ver más recientemente: lo que busca alguien que abre esta pantalla es a quién
 * puede retar AHORA.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return needsAccount();

  const playerId = user.id;

  const client = db();

  const { data, error } = await client
    .from('online_friends')
    .select('friend:online_players!online_friends_friend_id_fkey(*)')
    .eq('player_id', playerId);

  if (error) {
    console.error('[social/friends]', error);
    return json({ friends: [] });
  }

  const friends = (data ?? [])
    .map((row) => (row as unknown as { friend: PlayerRow }).friend)
    .filter(Boolean)
    .map((row) => ({
      playerId: row.player_id,
      name: row.name,
      avatarId: row.avatar_id,
      friendCode: row.friend_code ?? '',
      online: isOnline(row.last_seen),
      secondsSinceSeen: secondsSince(row.last_seen),
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
