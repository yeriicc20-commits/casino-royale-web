import { body, corsPreflight, db, json, text } from '@/lib/online';

/**
 * POST /api/profile/load   { playerId }
 *
 * Devuelve el sobre de guardado TAL CUAL se recibió, sin tocar un solo campo.
 *
 * El sobre lleva un checksum calculado sobre su contenido y su revisión, y el
 * juego lo verifica al recibirlo: si no cuadra, descarta el perfil entero
 * antes que sobrescribir el saldo de alguien con datos dudosos. Cualquier
 * "mejora" del contenido aquí rompería ese checksum y el jugador perdería su
 * progreso sin que nadie entendiera por qué.
 *
 * Sin perfil se responde 200 con el sobre vacío: el juego lo interpreta como
 * "el servidor no tiene nada mío todavía", que es la primera vez de cualquiera
 * y no un error.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const input = await body<{ playerId?: string }>(request);
  const playerId = text(input.playerId, 64);

  if (!playerId) return json({ payload: '' });

  const { data, error } = await db()
    .from('online_profiles')
    .select('envelope')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    console.error('[profile/load]', error);
    return json({ payload: '' });
  }

  return json(data?.envelope ?? { payload: '' });
}

export async function OPTIONS() {
  return corsPreflight();
}
