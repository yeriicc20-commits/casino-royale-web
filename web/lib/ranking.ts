import { db, PlayerRow, toLeaderboardEntry } from '@/lib/online';

/**
 * La clasificación global: TODAS las cuentas registradas, no solo las que ya
 * han entrado al modo en línea.
 *
 * Antes salía solo `online_players`, que se rellena la primera vez que alguien
 * juega en línea; quien se registraba (en la web o en el juego) y aún no había
 * jugado no aparecía. Ahora cada cuenta sale una vez, con su saldo en línea, o
 * con el saldo inicial si todavía no ha jugado. Las partidas sueltas sin cuenta
 * (de antes de que el online fuera con cuenta) no cuentan.
 */
export const OPENING_BALANCE_CENTS = 1000 * 100;

export interface RankRow extends PlayerRow {
  user_id: string | null;
}

export async function globalRows(): Promise<RankRow[]> {
  const client = db();
  const [players, profiles] = await Promise.all([
    client.from('online_players')
      // '*' y no una lista: así las columnas del pase (título y marco) salen si
      // ya existen, y si aún no se ha ejecutado su SQL no rompen la consulta.
      .select('*')
      .not('user_id', 'is', null)
      .limit(10000),
    client.from('profiles').select('id, display_name, avatar_index, friend_code, created_at').limit(10000),
  ]);

  const byUser = new Map<string, RankRow>();
  for (const p of (players.data ?? []) as RankRow[]) {
    if (p.user_id) byUser.set(String(p.user_id), { ...p, balance_cents: Number(p.balance_cents || 0) });
  }
  for (const pr of (profiles.data ?? []) as { id: string; display_name: string; avatar_index: number; friend_code: string | null; created_at: string }[]) {
    if (byUser.has(String(pr.id))) continue;
    byUser.set(String(pr.id), {
      player_id: String(pr.id),
      user_id: String(pr.id),
      name: pr.display_name || 'Jugador',
      avatar_id: Number(pr.avatar_index || 0),
      friend_code: pr.friend_code,
      balance_cents: OPENING_BALANCE_CENTS,
      biggest_win_cents: 0,
      rounds: 0,
      last_seen: pr.created_at,
    });
  }
  return [...byUser.values()].sort((a, b) => b.balance_cents - a.balance_cents || String(a.name).localeCompare(String(b.name)));
}

export function rankingFor(rows: RankRow[], userId: string | null, limit: number) {
  const entries = rows.slice(0, limit).map((row, i) => toLeaderboardEntry(row, i + 1));
  let you = null;
  if (userId) {
    const idx = rows.findIndex((r) => r.user_id === userId || r.player_id === userId);
    if (idx >= 0) you = toLeaderboardEntry(rows[idx], idx + 1);
  }
  return { entries, you, total: rows.length };
}

/** El player_id del modo en línea de una cuenta (puede no ser el id de la cuenta). */
export async function playerIdOf(userId: string): Promise<string> {
  const { data } = await db().from('online_players').select('player_id').eq('user_id', userId).maybeSingle();
  return data ? String((data as { player_id: string }).player_id) : userId;
}
