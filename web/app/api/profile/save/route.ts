import { body, corsPreflight, db, fail, json, ok, text } from '@/lib/online';

/**
 * POST /api/profile/save   (el sobre entero)
 *
 * Guarda la partida. La regla importante está en la comparación de revisión:
 *
 *   NUNCA se pisa una revisión más alta con una más baja.
 *
 * Sin eso, alguien con el juego abierto en dos móviles haría que el que lleva
 * la partida vieja borrase el progreso del otro cada vez que guardara. Con
 * eso, el móvil atrasado recibe un aviso y se queda como está.
 */
export const dynamic = 'force-dynamic';

interface Envelope {
  envelopeVersion?: number;
  savedAtUtcTicks?: number;
  revision?: number;
  deviceId?: string;
  checksum?: string;
  payload?: string;
}

export async function POST(request: Request) {
  const envelope = await body<Envelope>(request);

  const payload = String(envelope.payload ?? '');
  const revision = Number(envelope.revision ?? 0);

  // Un sobre sin contenido no se guarda: sobrescribiría una partida buena con
  // nada, y eso no se puede deshacer.
  if (!payload) return fail('Sobre vacío.');

  // El identificador viaja dentro del contenido cifrado, así que se toma del
  // deviceId, que es lo único de fuera en lo que se puede confiar para saber a
  // quién pertenece esto.
  const playerId = text(envelope.deviceId, 64);
  if (!playerId) return fail('Sin identificador.');

  const client = db();

  const { data: current } = await client
    .from('online_profiles')
    .select('revision')
    .eq('player_id', playerId)
    .maybeSingle();

  if (current && Number(current.revision) > revision) {
    return json(
      { ok: false, message: 'El servidor tiene una versión más nueva.' },
      200,
    );
  }

  const { error } = await client.from('online_profiles').upsert(
    {
      player_id: playerId,
      revision,
      envelope: envelope as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' },
  );

  if (error) {
    console.error('[profile/save]', error);
    return fail('No se pudo guardar.');
  }

  return ok();
}

export async function OPTIONS() {
  return corsPreflight();
}
