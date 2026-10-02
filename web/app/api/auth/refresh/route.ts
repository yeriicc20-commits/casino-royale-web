import { authClient, authFail, sessionPayload, translate } from '@/lib/auth-api';
import { body, corsPreflight, json } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/auth/refresh   { refreshToken }
 *
 * El token de acceso dura una hora; el de refresco, meses. El juego guarda el
 * segundo y pide uno nuevo cuando le hace falta, que es lo que hace que abrir
 * el juego por la mañana no pida la contraseña otra vez.
 *
 * Si el de refresco ya no vale, se responde con ok en falso y el juego pide la
 * cuenta de nuevo. No es un fallo: es una sesión que ha caducado.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones que ya no pueden jugar online (o mantenimiento): ni entrar ni
  // renovar la sesión. Así el juego viejo se entera al conectar, no a medias.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const input = await body<{ refreshToken?: string }>(request);
  const refreshToken = String(input.refreshToken ?? '').trim();

  if (!refreshToken) return authFail('Sin sesión guardada.');

  try {
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session || !data.user) {
      return authFail(translate(error?.message ?? 'Tu sesión ha caducado. Vuelve a entrar.'));
    }

    return json(await sessionPayload(data.session, data.user));
  } catch (error) {
    console.error('[auth/refresh]', error);
    return authFail('No se ha podido contactar con el servidor.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
