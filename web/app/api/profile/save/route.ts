import { body, corsPreflight, currentUser, db, fail, json, needsAccount, ok }
  from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { impossibleJump, walletFromPayload } from '@/lib/anticheat';

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
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const envelope = await body<Envelope>(request);

  const payload = String(envelope.payload ?? '');
  const revision = Number(envelope.revision ?? 0);

  // Un sobre sin contenido no se guarda: sobrescribiría una partida buena con
  // nada, y eso no se puede deshacer.
  if (!payload) return fail('Sobre vacío.');

  // De la sesión, nunca del sobre. El deviceId que viene dentro lo escribe el
  // propio móvil, así que mandar el de otra persona bastaría para pisarle la
  // partida; el token, en cambio, hay que tenerlo.
  const playerId = user.id;

  const client = db();

  const { data: current } = await client
    .from('online_profiles')
    .select('revision, envelope, updated_at')
    .eq('player_id', playerId)
    .maybeSingle();

  if (current && Number(current.revision) > revision) {
    return json(
      { ok: false, message: 'El servidor tiene una versión más nueva.' },
      200,
    );
  }

  // Saldo imposible (juego modificado): no se guarda.
  const next = walletFromPayload(payload);
  const prevEnvelope = current?.envelope as { payload?: string } | undefined;
  const prev = prevEnvelope?.payload ? walletFromPayload(String(prevEnvelope.payload)) : null;
  if (next && prev) {
    const { data: players } = await client.from('online_players').select('player_id').eq('user_id', user.id);
    const why = await impossibleJump(
      { ...prev, at: Date.parse(String(current?.updated_at ?? '')) || Date.now() },
      { ...next, at: Date.now() },
      (players ?? []).map((p) => String((p as { player_id: string }).player_id)),
    );
    if (why) {
      console.warn('[profile/save] saldo rechazado', user.id, why);
      return json({ ok: false, error: 'SUSPICIOUS_BALANCE', message: why }, 200);
    }
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
