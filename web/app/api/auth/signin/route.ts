import { authClient, authFail, sessionPayload, translate } from '@/lib/auth-api';
import { body, corsPreflight, json, text } from '@/lib/online';

/**
 * POST /api/auth/signin   { email, password }
 *
 * Entrar desde el juego con la MISMA cuenta de la web.
 *
 * Siempre responde 200, incluso cuando la contraseña está mal: el juego trata
 * cualquier 4xx como "el servidor falla" y bajaría el modo a degradado, cuando
 * lo que pasa es que el servidor ha contestado perfectamente que no. El campo
 * `ok` es el que lleva la respuesta.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const input = await body<{ email?: string; password?: string }>(request);

  const email = text(input.email, 160).toLowerCase();
  const password = String(input.password ?? '');

  if (!email || !password) return authFail('Escribe tu correo y tu contraseña.');

  try {
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });

    if (error || !data.session || !data.user) {
      return authFail(translate(error?.message ?? ''));
    }

    return json(await sessionPayload(data.session, data.user));
  } catch (error) {
    console.error('[auth/signin]', error);
    return authFail('No se ha podido contactar con el servidor.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
