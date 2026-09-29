import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Vuelta de Google, Apple o del enlace de correo.
 *
 * Supabase manda aquí un código de un solo uso que se cambia por la sesión.
 * El destino se valida antes de redirigir: aceptar cualquier `next` que llegue
 * por la URL convierte esta ruta en un redirector abierto, que es lo que se usa
 * para enviar a alguien a una web falsa desde un enlace que parece legítimo.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/account';

  // Solo rutas internas: tiene que empezar por una sola barra.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);

    console.error('[auth/callback]', error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
