import { authFail, sessionPayload, supabaseUrl, translate } from '@/lib/auth-api';
import { body, corsPreflight, json, text } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/auth/oauth/exchange   { code, verifier }
 *
 * El último paso de entrar con Google: el juego ha recibido un código en la
 * dirección de vuelta y lo cambia por una sesión, presentando el secreto que
 * generó antes de empezar.
 *
 * Va contra el endpoint de Supabase a pelo y no por su biblioteca porque la
 * biblioteca guarda el secreto ella misma, en el navegador, y aquí el secreto
 * lo tiene el juego. Ese es justo el sentido de PKCE: quien empieza la sesión
 * es el único que puede terminarla.
 */
export const dynamic = 'force-dynamic';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string | null };
  error_description?: string;
  msg?: string;
  error?: string;
}

export async function POST(request: Request) {
  // Versiones que ya no pueden jugar online (o mantenimiento): ni entrar ni
  // renovar la sesión. Así el juego viejo se entera al conectar, no a medias.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const input = await body<{ code?: string; verifier?: string }>(request);

  const code = text(input.code, 400);
  const verifier = text(input.verifier, 200);

  if (!code || !verifier) return authFail('Falta el código o el secreto.');

  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return authFail('El servidor no está configurado.');

  try {
    const response = await fetch(supabaseUrl() + '/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });

    const data = (await response.json()) as TokenResponse;

    if (!response.ok || !data.access_token || !data.refresh_token || !data.user?.id) {
      return authFail(translate(data.error_description ?? data.msg ?? data.error ?? ''));
    }

    return json(
      await sessionPayload(
        {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
        },
        { id: data.user.id, email: data.user.email ?? null },
      ),
    );
  } catch (error) {
    console.error('[auth/oauth/exchange]', error);
    return authFail('No se ha podido completar el inicio de sesión.');
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
