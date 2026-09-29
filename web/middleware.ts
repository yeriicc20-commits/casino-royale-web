import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refresca la sesión en cada navegación.
 *
 * Los tokens de Supabase caducan en una hora. Sin este middleware, un
 * componente de servidor puede encontrarse un token vencido y tratar como
 * anónimo a alguien que sí ha iniciado sesión —que es la clase de fallo que
 * aparece solo después de tener la pestaña abierta un rato y es un infierno de
 * reproducir.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() y no getSession(): getSession lee la cookie sin comprobarla, así
  // que una cookie manipulada pasaría. getUser valida contra el servidor.
  const { data: { user } } = await supabase.auth.getUser();

  // Las zonas privadas se cierran aquí, antes de renderizar nada.
  const path = request.nextUrl.pathname;
  const isPrivate = path.startsWith('/account') || path.startsWith('/admin');

  if (isPrivate && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todo menos estáticos e imágenes. La API entera queda fuera a propósito:
     * la consulta el juego, que no manda cookies y lleva su sesión en la
     * cabecera Authorization. Refrescarle una cookie que no tiene solo añade
     * una llamada al servidor de autenticación en cada latido.
     */
    '/((?!_next/static|_next/image|favicon|api/|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
