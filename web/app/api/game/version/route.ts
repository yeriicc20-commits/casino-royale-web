import { NextResponse } from 'next/server';
import { resolveVersionState } from '@/lib/versions';
import type { ReleaseChannel } from '@/lib/types';

/**
 * GET /api/game/version
 *
 * La consulta que hace Unity al arrancar. Es la única que necesita para saber
 * si puede entrar al online, si hay una actualización y de dónde bajarla.
 *
 *   ?version=1.3.0     la versión instalada (o la cabecera X-Game-Version)
 *   ?channel=beta      canal, por defecto production
 *
 * Nunca devuelve 500 con el cuerpo vacío: si algo falla responde un estado
 * SERVER_UNAVAILABLE bien formado, porque un juego que recibe basura al
 * arrancar es un juego que se queda en blanco.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const version =
      url.searchParams.get('version') ??
      request.headers.get('X-Game-Version') ??
      null;

    const channel = (url.searchParams.get('channel') ?? 'production') as ReleaseChannel;
    const allowed: ReleaseChannel[] = ['production', 'beta', 'development'];

    const state = await resolveVersionState(
      version,
      allowed.includes(channel) ? channel : 'production',
    );

    return NextResponse.json(state, {
      headers: {
        // Corta pero no nula: quita el pico cuando mucha gente abre el juego a
        // la vez, sin que una actualización tarde en notarse.
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('[api/game/version]', error);

    return NextResponse.json(
      {
        state: 'SERVER_UNAVAILABLE',
        latestVersion: '0.0.0',
        minimumOnlineVersion: '0.0.0',
        updateRequired: false,
        updateAvailable: false,
        onlineAllowed: false,
        maintenance: false,
        maintenanceMessage: null,
        androidDownloadUrl: null,
        androidVersionCode: null,
        androidSizeBytes: null,
        iosStoreUrl: null,
        windowsDownloadUrl: null,
        windowsSizeBytes: null,
        releaseNotes: [],
        serverTime: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
