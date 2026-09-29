import { NextResponse } from 'next/server';
import { resolveVersionState } from '@/lib/versions';

/**
 * GET /api/game/maintenance
 *
 * Respuesta mínima para el juego cuando solo quiere saber si el online está
 * abierto. Separada de /version porque se puede consultar mucho más a menudo.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await resolveVersionState(null);

  return NextResponse.json({
    maintenance: state.maintenance,
    message: state.maintenanceMessage,
    serverTime: state.serverTime,
  });
}
