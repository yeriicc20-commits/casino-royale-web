import { body, claimIdentity, corsPreflight, currentUser, db, json, needsAccount, text }
  from '@/lib/online';

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
 *
 * Esta es además la llamada donde se reclama la identidad, porque es la primera
 * que hace el juego al conectar: si este jugador venía de una partida atada al
 * dispositivo, aquí es donde pasa a ser de su cuenta, con su saldo y sus amigos
 * detrás.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ playerId?: string }>(request);

  // El playerId que manda el juego es el del dispositivo, y solo sirve para
  // saber qué partida adoptar. El identificador bueno lo devuelve la base.
  const playerId = await claimIdentity(user.id, text(input.playerId, 64));

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
