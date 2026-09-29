'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente de Supabase para el navegador.
 *
 * Usa la clave ANÓNIMA, que es pública por diseño: va dentro del JavaScript que
 * cualquiera puede leer. Eso no es un descuido y no hay forma de evitarlo —lo
 * que impide que alguien la use para leer o escribir lo que no debe no es la
 * clave, son las políticas de Row Level Security de `02_policies.sql`, que se
 * evalúan dentro de Postgres.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
