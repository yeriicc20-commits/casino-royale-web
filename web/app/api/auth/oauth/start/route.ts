import { authFail, supabaseUrl } from '@/lib/auth-api';
import { body, corsPreflight, json, text } from '@/lib/online';

/**
 * POST /api/auth/oauth/start   { provider, redirect, challenge }
 *
 * Devuelve la dirección que el juego tiene que abrir en el navegador para
 * entrar con Google o con Apple.
 *
 * Va con PKCE y no con el flujo normal por una razón muy concreta: el flujo
 * normal devuelve los tokens en el FRAGMENTO de la URL (después de la
 * almohadilla), y un fragmento no se envía al servidor, así que el pequeño
 * servidor local que el juego levanta en el PC para recoger la respuesta nunca
 * llegaría a verlos. PKCE devuelve un código en la parte que sí se envía, y ese
 * código no vale para nada sin el secreto que el juego se ha guardado.
 *
 * La dirección se compone aquí y no en el juego para que la del servidor de
 * autenticación no quede clavada dentro de un APK ya instalado.
 */
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['google', 'apple']);

export async function POST(request: Request) {
  const input = await body<{ provider?: string; redirect?: string; challenge?: string }>(request);

  const provider = text(input.provider, 16).toLowerCase();
  const redirect = text(input.redirect, 300);
  const challenge = text(input.challenge, 200);

  if (!ALLOWED.has(provider)) return authFail('Ese proveedor no está disponible.');
  if (!redirect) return authFail('Falta la dirección de vuelta.');
  if (!challenge) return authFail('Falta el reto de seguridad.');

  // Solo las dos formas que el juego sabe recoger: el enlace propio de Android
  // y el servidor local del PC. Cualquier otra sería una puerta abierta para
  // mandar la sesión de alguien a donde no debe.
  const safe =
    redirect.startsWith('casinoroyale://') ||
    /^http:\/\/127\.0\.0\.1:\d{4,5}\//.test(redirect);

  if (!safe) return authFail('Esa dirección de vuelta no está permitida.');

  const url = new URL(supabaseUrl() + '/auth/v1/authorize');
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 's256');

  return json({ ok: true, message: '', url: url.toString() });
}

export async function OPTIONS() {
  return corsPreflight();
}
