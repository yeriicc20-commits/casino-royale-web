import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidVersion } from '@/lib/semver';

/**
 * POST /api/admin/release
 *
 * Publica una versión desde la línea de comandos, sin pasar por el panel.
 *
 * Existe para que `publicar-version.py` pueda cerrar el círculo: compila, sube
 * los binarios a GitHub y avisa a la web en la misma ejecución. Sin esto, cada
 * versión nueva terminaba con alguien copiando URLs a mano en un formulario, y
 * ese es justo el paso que se olvida.
 *
 * Va protegida por un secreto compartido en RELEASE_TOKEN, no por la sesión de
 * administrador, porque quien llama es un script y no un navegador. Si la
 * variable no está puesta, la ruta se niega a funcionar en lugar de quedarse
 * abierta: una puerta sin cerradura es peor que ninguna puerta.
 */
export const dynamic = 'force-dynamic';

interface Payload {
  version?: string;
  title?: string;
  summary?: string;

  added?: string[];
  fixed?: string[];
  changed?: string[];
  technical?: string[];

  androidUrl?: string;
  androidVersionCode?: number;
  androidSizeBytes?: number;

  windowsUrl?: string;
  windowsSizeBytes?: number;

  /** Cierto para publicarla ya; falso la deja en borrador. */
  publish?: boolean;

  /** Cierto para exigir esta versión al modo online. */
  requireForOnline?: boolean;
}

export async function POST(request: Request) {
  const secret = process.env.RELEASE_TOKEN;

  if (!secret) {
    return NextResponse.json(
      { error: 'RELEASE_TOKEN no está configurado en el servidor.' },
      { status: 503 },
    );
  }

  const provided = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (provided !== secret) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let payload: Payload;

  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'Cuerpo ilegible.' }, { status: 400 });
  }

  const version = String(payload.version ?? '').trim();

  if (!isValidVersion(version)) {
    return NextResponse.json(
      { error: 'La versión debe tener el formato 0.1.0.' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const publish = payload.publish !== false;

  const row = {
    version,
    channel: 'production' as const,
    status: publish ? ('published' as const) : ('draft' as const),

    title: String(payload.title ?? `Versión ${version}`).slice(0, 120),
    summary: String(payload.summary ?? '').slice(0, 600),

    notes_added: payload.added ?? [],
    notes_fixed: payload.fixed ?? [],
    notes_changed: payload.changed ?? [],
    notes_technical: payload.technical ?? [],

    android_url: payload.androidUrl ?? null,
    android_version_code: payload.androidVersionCode ?? null,
    android_size_bytes: payload.androidSizeBytes ?? null,

    windows_url: payload.windowsUrl ?? null,
    windows_size_bytes: payload.windowsSizeBytes ?? null,

    released_at: new Date().toISOString(),
  };

  // upsert por (channel, version): volver a publicar la misma versión la
  // actualiza en lugar de fallar, que es lo que hace falta cuando se recompila
  // por un fallo tonto y se vuelve a subir.
  const { error } = await supabase
    .from('releases')
    .upsert(row, { onConflict: 'channel,version' });

  if (error) {
    console.error('[admin/release]', error);
    return NextResponse.json({ error: 'No se pudo guardar la versión.' }, { status: 500 });
  }

  // El interruptor general. latest_version sube siempre; la mínima del online
  // solo si se pide, porque subirla deja fuera a quien no se haya actualizado.
  const config: Record<string, unknown> = { latest_version: version };
  if (payload.requireForOnline) config.minimum_online_version = version;

  const { error: configError } = await supabase
    .from('app_config')
    .update(config)
    .eq('channel', 'production');

  if (configError) {
    console.error('[admin/release] config', configError);
    return NextResponse.json({ error: 'Versión guardada, pero no se pudo activar.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    version,
    published: publish,
    requiredForOnline: Boolean(payload.requireForOnline),
  });
}
