import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Cliente de Supabase para componentes de servidor y rutas de API.
 *
 * Lee la sesión de las cookies, así que las consultas salen con la identidad
 * real del usuario y las políticas RLS se aplican igual que en el navegador.
 * Sigue siendo la clave anónima: esto NO da privilegios extra.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un componente de servidor, donde no se pueden
            // escribir cookies. El middleware ya refresca la sesión, así que
            // ignorarlo aquí es correcto y no pierde nada.
          }
        },
      },
    },
  );
}
