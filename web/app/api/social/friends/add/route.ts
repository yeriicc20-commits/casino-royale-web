import { body, corsPreflight, currentUser, db, fail, json, needsAccount, text }
  from '@/lib/online';

/**
 * POST /api/social/friends/add   { playerId, code }
 *
 * Toda la comprobación vive en online_friend_add(), dentro de la base de
 * datos: son cuatro condiciones y dos inserciones que tienen que pasar juntas.
 * Hechas a base de consultas sueltas desde aquí, dos móviles pulsando a la vez
 * pueden colarse entre la comprobación y la inserción.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ code?: string }>(request);

  const playerId = user.id;
  const code = text(input.code, 16).toUpperCase().replace(/-/g, '');

  if (!code) return fail('Faltan datos.');

  const { data, error } = await db().rpc('online_friend_add', {
    me: playerId,
    code,
  });

  if (error) {
    console.error('[social/friends/add]', error);
    return fail('No se pudo añadir.');
  }

  const result = Array.isArray(data) ? data[0] : data;

  return json({
    ok: Boolean(result?.ok),
    message: String(result?.message ?? ''),
  });
}

export async function OPTIONS() {
  return corsPreflight();
}
