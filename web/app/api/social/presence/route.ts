import { body, corsPreflight, db, fail, int, ok, text } from '@/lib/online';

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
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const input = await body<Record<string, unknown>>(request);

  const playerId = text(input.playerId, 64);
  if (!playerId) return fail('playerId requerido.');

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

  return ok();
}

export async function OPTIONS() {
  return corsPreflight();
}
