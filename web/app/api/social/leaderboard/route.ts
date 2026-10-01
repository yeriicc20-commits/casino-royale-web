import {
  body, corsPreflight, currentUser, db, json, LEADERBOARD_LIMIT, needsAccount,
  PlayerRow, text, toLeaderboardEntry,
} from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { globalRows, playerIdOf, rankingFor } from '@/lib/ranking';

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
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ playerId?: string; scope?: string }>(request);

  // El jugador en línea de esta cuenta (sus amistades van con ese id).
  const playerId = await playerIdOf(user.id);
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
    // Todas las cuentas registradas, hayan jugado en línea o no.
    return json(rankingFor(await globalRows(), user.id, LEADERBOARD_LIMIT));
  }

  const entries = rows.map((row, index) => toLeaderboardEntry(row, index + 1));
  const you = entries.find((entry) => entry.playerId === playerId) ?? null;
  return json({ entries, you, total });
}

export async function OPTIONS() {
  return corsPreflight();
}
