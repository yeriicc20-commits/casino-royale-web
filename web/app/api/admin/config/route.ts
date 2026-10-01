import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidVersion } from '@/lib/semver';

/**
 * POST /api/admin/config
 *
 * Cambia el interruptor general del online (tabla app_config) sin pasar por el
 * panel: version minima para jugar online, ultima version anunciada y modo
 * mantenimiento. La usa el agente local "Chat IA Unity".
 *
 * Igual que /api/admin/release, va protegida por RELEASE_TOKEN y se niega a
 * funcionar si la variable no esta puesta.
 *
 *   { "channel": "production", "minimumOnlineVersion": "0.3.0",
 *     "latestVersion": "0.3.0", "maintenance": false, "maintenanceMessage": "..." }
 *
 * Todos los campos son opcionales; solo se cambia lo que venga.
 */
export const dynamic = 'force-dynamic';

interface Payload {
  channel?: 'production' | 'beta' | 'development';
  minimumOnlineVersion?: string;
  latestVersion?: string;
  maintenance?: boolean;
  maintenanceMessage?: string;
}

export async function POST(request: Request) {
  const secret = process.env.RELEASE_TOKEN;

  if (!secret) {
    return NextResponse.json({ error: 'RELEASE_TOKEN no está configurado en el servidor.' }, { status: 503 });
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

  const channel = payload.channel ?? 'production';
  if (!['production', 'beta', 'development'].includes(channel)) {
    return NextResponse.json({ error: 'Canal desconocido.' }, { status: 400 });
  }

  const config: Record<string, unknown> = {};

  if (payload.minimumOnlineVersion !== undefined) {
    const v = String(payload.minimumOnlineVersion).trim();
    if (!isValidVersion(v)) return NextResponse.json({ error: 'La versión mínima debe tener el formato 0.1.0.' }, { status: 400 });
    config.minimum_online_version = v;
  }

  if (payload.latestVersion !== undefined) {
    const v = String(payload.latestVersion).trim();
    if (!isValidVersion(v)) return NextResponse.json({ error: 'La última versión debe tener el formato 0.1.0.' }, { status: 400 });
    config.latest_version = v;
  }

  if (payload.maintenance !== undefined) config.maintenance_mode = Boolean(payload.maintenance);
  if (payload.maintenanceMessage !== undefined) config.maintenance_message = String(payload.maintenanceMessage).slice(0, 300);

  if (Object.keys(config).length === 0) {
    return NextResponse.json({ error: 'No hay nada que cambiar.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('app_config').update(config).eq('channel', channel);

  if (error) {
    console.error('[admin/config]', error);
    return NextResponse.json({ error: 'No se pudo guardar la configuración.' }, { status: 500 });
  }

  revalidatePath('/');
  revalidatePath('/download');
  revalidatePath('/admin');

  return NextResponse.json({ ok: true, channel, changed: Object.keys(config) });
}
