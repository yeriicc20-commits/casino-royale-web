import { createClient } from '@supabase/supabase-js';

/**
 * Cliente con la clave de SERVICIO. Se salta Row Level Security por completo.
 *
 * Reglas de uso, sin excepciones:
 *   - Solo en código de servidor: rutas de API y Server Actions.
 *   - Nunca importado desde un componente marcado 'use client'.
 *   - Nunca en una variable que empiece por NEXT_PUBLIC_, porque todo lo que
 *     lleva ese prefijo se copia dentro del paquete que baja el navegador.
 *
 * Si esta clave se filtra, cualquiera puede leer y borrar la base de datos
 * entera. El `import 'server-only'` de abajo convierte un uso indebido en un
 * error de compilación en lugar de en una fuga silenciosa.
 */
import 'server-only';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.',
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
