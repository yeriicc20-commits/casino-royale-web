import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/cron/keepalive
 *
 * Existe por una limitación concreta del plan gratuito de Supabase: un proyecto
 * que pasa SIETE DÍAS sin recibir ninguna petición se pausa, y hay que
 * reactivarlo a mano desde el panel. Si eso ocurre, el juego se queda sin
 * servidor de versiones sin que nadie haya tocado nada.
 *
 * Una consulta diaria lo evita. La lanza GitHub Actions, que también es gratis.
 * Va protegida con un secreto para que no la pueda disparar cualquiera.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('app_config').select('channel').limit(1);

    if (error) throw error;

    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    console.error('[cron/keepalive]', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
