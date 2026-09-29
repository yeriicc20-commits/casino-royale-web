import { corsPreflight, json } from '@/lib/online';

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

export async function POST() {
  return json({ utc: new Date().toISOString() });
}

export async function OPTIONS() {
  return corsPreflight();
}
