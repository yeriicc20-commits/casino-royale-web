import { body, claimIdentity, corsPreflight, currentUser, db, fail, int, json,
  needsAccount, text } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/social/presence
 *   { playerId, name, avatarId, friendCode, balanceCents, biggestWinCents, rounds }
 *
 * El "estoy aquí" del juego. Hace dos cosas: marca la hora para que los amigos
 * te vean conectado, y publica el saldo con el que se ordena la clasificación.
 *
 * El saldo llega del cliente, así que no es de fiar. Se acepta porque el dinero
 * es ficticio y la clasificación es un adorno; el día que haya algo en juego,
 * el sitio donde validarlo es aquí y no en el móvil.
 *
 * Un código de amigo que ya tenga otro jugador NO se roba: el que llega tarde
 * se queda sin código publicado antes que romperle el suyo a quien lo tenía.
 *
 * La respuesta lleva además los ajustes que el panel haya dejado anotados para
 * este jugador. Van aquí y no en una ruta propia porque el latido ya existe, ya
 * ocurre cada treinta segundos y ya sabe quién llama: una segunda petición solo
 * añadiría latencia y otra cosa que puede fallar por separado.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<Record<string, unknown>>(request);

  const playerId = await claimIdentity(
    user.id, text(input.playerId, 64), text(input.name, 16));

  const client = db();

  let friendCode: string | null = text(input.friendCode, 16).toUpperCase() || null;

  if (friendCode) {
    const { data: taken } = await client
      .from('online_players')
      .select('player_id')
      .eq('friend_code', friendCode)
      .neq('player_id', playerId)
      .maybeSingle();

    if (taken) friendCode = null;
  }

  const row: Record<string, unknown> = {
    player_id: playerId,
    user_id: user.id,
    name: text(input.name, 16) || 'Jugador',
    avatar_id: int(input.avatarId),
    balance_cents: int(input.balanceCents),
    biggest_win_cents: int(input.biggestWinCents),
    rounds: int(input.rounds),
    last_seen: new Date().toISOString(),
  };

  // Solo se toca el código cuando hay uno válido que poner. Mandar null en el
  // upsert borraría el que ya tuviera guardado.
  if (friendCode) row.friend_code = friendCode;

  const { error } = await client
    .from('online_players')
    .upsert(row, { onConflict: 'player_id' });

  if (error) {
    console.error('[social/presence]', error);
    return fail('No se pudo publicar la presencia.');
  }

  return json({ ok: true, message: '', grants: await claimGrants(client, playerId) });
}

/** Una fila de la cola de ajustes, ya marcada como entregada. */
interface GrantRow {
  id: number | string;
  amount_cents: number | string;
  reason: string | null;
}

/**
 * Recoge lo que el panel le deba a este jugador.
 *
 * Reclamar y marcar como entregado ocurren dentro de la misma sentencia SQL, así
 * que el móvil y el PC de la misma persona no pueden llevarse el mismo apunte
 * dos veces.
 *
 * Un fallo aquí NO tumba la presencia: el latido sirve sobre todo para que te
 * vean conectado, y perder eso por un ajuste que puede esperar treinta segundos
 * sería un mal cambio. También es lo que hace que la ruta siga funcionando antes
 * de haber ejecutado `09_panel_admin.sql`, cuando la función todavía no existe.
 */
async function claimGrants(client: ReturnType<typeof db>, playerId: string) {
  const { data, error } = await client.rpc('online_grant_claim', { p_player_id: playerId });

  if (error) {
    console.error('[social/presence] grants', error.message);
    return [];
  }

  return ((data ?? []) as GrantRow[]).map((row) => ({
    id: Number(row.id),
    amountCents: Number(row.amount_cents),
    reason: String(row.reason ?? ''),
  }));
}

export async function OPTIONS() {
  return corsPreflight();
}
