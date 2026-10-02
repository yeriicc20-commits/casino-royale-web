import { corsPreflight, json } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * POST /api/system/time
 *
 * La primera llamada que hace el juego al elegir "jugar online": si esta
 * responde, el modo pasa a Online; si no, a Degraded. Es el latido.
 *
 * El campo tiene que llamarse `utc` y ser una fecha que DateTime.TryParse sepa
 * leer. ISO 8601 con Z al final, que es lo que da toISOString().
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones que ya no pueden jugar online (o mantenimiento): ni entrar ni
  // renovar la sesión. Así el juego viejo se entera al conectar, no a medias.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  return json({ utc: new Date().toISOString() });
}

export async function OPTIONS() {
  return corsPreflight();
}
