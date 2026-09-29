import {
  body, corsPreflight, currentUser, db, json, LEADERBOARD_LIMIT, needsAccount,
  PlayerRow, text, toLeaderboardEntry,
} from '@/lib/online';

/**
 * POST /api/social/leaderboard   { playerId, scope }
 *
 * scope es "global" o "friends".
 *
 * Además de la página, devuelve `you`: en qué puesto va quien pregunta, aunque
 * esté fuera de los cincuenta primeros. Una clasificación que no te dice dónde
 * estás tú no sirve de nada para el que va el 300.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ playerId?: string; scope?: string }>(request);

  const playerId = user.id;
  const friendsOnly = text(input.scope, 16) === 'friends';

  const client = db();

  let rows: PlayerRow[] = [];
  let total = 0;

  if (friendsOnly) {
    if (!playerId) return json({ entries: [], you: null, total: 0 });

    const { data: links } = await client
      .from('online_friends')
      .select('friend_id')
      .eq('player_id', playerId);

    // El propio jugador entra en su ranking de amigos: competir contra una
    // lista en la que no apareces no tiene sentido.
    const ids = [playerId, ...(links ?? []).map((l) => String(l.friend_id))];

    const { data } = await client
      .from('online_players')
      .select('*')
      .in('player_id', ids)
      .order('balance_cents', { ascending: false })
      .limit(LEADERBOARD_LIMIT);

    rows = (data ?? []) as PlayerRow[];
    total = rows.length;
  } else {
    const [page, count] = await Promise.all([
      client
        .from('online_players')
        .select('*')
        .order('balance_cents', { ascending: false })
        .limit(LEADERBOARD_LIMIT),
      client.from('online_players').select('player_id', { count: 'exact', head: true }),
    ]);

    rows = (page.data ?? []) as PlayerRow[];
    total = count.count ?? rows.length;
  }

  const entries = rows.map((row, index) => toLeaderboardEntry(row, index + 1));
  let you = entries.find((entry) => entry.playerId === playerId) ?? null;

  // Fuera de la página: se cuenta cuánta gente tiene más saldo y ese número
  // más uno es el puesto.
  if (!you && playerId) {
    const { data: mine } = await client
      .from('online_players')
      .select('*')
      .eq('player_id', playerId)
      .maybeSingle();

    if (mine) {
      const row = mine as PlayerRow;

      const { count: ahead } = await client
        .from('online_players')
        .select('player_id', { count: 'exact', head: true })
        .gt('balance_cents', row.balance_cents);

      you = toLeaderboardEntry(row, (ahead ?? 0) + 1);
    }
  }

  return json({ entries, you, total });
}

export async function OPTIONS() {
  return corsPreflight();
}
