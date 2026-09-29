import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { json } from '@/lib/online';

/**
 * Lo que comparten las rutas de cuenta que habla el JUEGO.
 *
 * El juego no lleva ninguna clave de Supabase dentro. Podría: la clave anónima
 * es pública y viaja en el paquete que se descarga cualquier navegador. Pero
 * entonces la dirección del servidor de autenticación quedaría clavada en un
 * APK ya instalado, y cambiarla obligaría a publicar una versión nueva. Pasando
 * por aquí, el juego solo conoce una dirección -la de esta web- y todo lo demás
 * se puede mover sin tocar a nadie.
 *
 * De paso, es el sitio donde poner un límite de intentos el día que haga falta.
 */

/** Cliente con la clave anónima: el que sirve para entrar y refrescar. */
export function authClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL.');
  return url.replace(/\/+$/, '');
}

/** La forma exacta que espera JsonUtility en `AuthModels.cs`. */
export interface SessionPayload {
  ok: boolean;
  message: string;

  accessToken: string;
  refreshToken: string;

  /** Segundos que le quedan de vida al token de acceso. */
  expiresIn: number;

  userId: string;
  email: string;
  displayName: string;
}

const EMPTY: SessionPayload = {
  ok: false,
  message: '',
  accessToken: '',
  refreshToken: '',
  expiresIn: 0,
  userId: '',
  email: '',
  displayName: '',
};

export function authFail(message: string, status = 200) {
  return json({ ...EMPTY, message }, status);
}

/**
 * Convierte la sesión de Supabase en lo que el juego sabe leer.
 *
 * El nombre sale de `profiles`, no de los metadatos del usuario: es el que se
 * comprobó que estaba libre al crear la cuenta, y el único que el podio va a
 * respetar.
 */
export async function sessionPayload(
  session: { access_token: string; refresh_token: string; expires_in?: number },
  user: { id: string; email?: string | null },
): Promise<SessionPayload> {
  let displayName = '';

  try {
    const { data } = await createAdminClient()
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    displayName = String(data?.display_name ?? '');
  } catch (error) {
    console.error('[auth-api.sessionPayload]', error);
  }

  return {
    ok: true,
    message: '',
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: Number(session.expires_in ?? 3600),
    userId: user.id,
    email: user.email ?? '',
    displayName,
  };
}

/**
 * Los mensajes de Supabase llegan en inglés, y esta es la pantalla donde peor
 * sientan: alguien que no consigue entrar y encima no entiende el motivo, se va.
 */
export function translate(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Todavía no has confirmado el correo. Mira tu bandeja de entrada.';
  }
  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'Ya existe una cuenta con ese correo. Entra con ella.';
  }
  if (lower.includes('password') && lower.includes('at least')) {
    return 'La contraseña necesita al menos 8 caracteres.';
  }
  if (lower.includes('invalid format') || lower.includes('unable to validate email')) {
    return 'Ese correo no tiene un formato válido.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Demasiados intentos seguidos. Espera un momento.';
  }
  if (lower.includes('refresh token') || lower.includes('invalid grant')) {
    return 'Tu sesión ha caducado. Vuelve a entrar.';
  }

  return message || 'No se ha podido completar.';
}

/** Nombre de jugador: al menos tres letras, como máximo veinticuatro. */
export function cleanName(value: unknown): string {
  return String(value ?? '').trim().slice(0, 24);
}
