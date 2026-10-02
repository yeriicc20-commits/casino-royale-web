import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { guardOnlineAccess } from '@/lib/versions';

/**
 * GET/POST /api/user/profile
 *
 * El perfil y el guardado del jugador. Esta ruta es el ejemplo de cómo se
 * protege TODO lo online:
 *
 *   1. guardOnlineAccess() comprueba la versión del cliente contra la mínima
 *      que hay en la base de datos. Un cliente modificado que se salte el
 *      diálogo de actualización llega hasta aquí y se lleva un 426.
 *   2. Solo después se mira quién es, con la sesión real de Supabase.
 *
 * El orden importa: primero la versión, después la identidad. Así una versión
 * prohibida recibe siempre el mismo error, tenga sesión válida o no, y no se
 * puede deducir nada sobre las cuentas probando.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return NextResponse.json(rejected.body, { status: rejected.status });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' },
      { status: 401 },
    );
  }

  const [{ data: profile }, { data: stats }, { data: save }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('player_stats').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('game_saves').select('*').eq('user_id', user.id)
      .eq('channel', 'production').maybeSingle(),
  ]);

  return NextResponse.json({ profile, stats, save });
}

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return NextResponse.json(rejected.body, { status: rejected.status });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'AUTH_REQUIRED', message: 'Inicia sesión para continuar.' },
      { status: 401 },
    );
  }

  let body: { displayName?: string; avatarIndex?: number; save?: unknown; gameVersion?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // El perfil se valida aquí y no se confía en lo que llegue: un nombre de
  // cuarenta mil caracteres rompería cualquier lista donde aparezca.
  if (typeof body.displayName === 'string' || typeof body.avatarIndex === 'number') {
    const update: Record<string, unknown> = {};

    if (typeof body.displayName === 'string') {
      const name = body.displayName.trim().slice(0, 24);
      if (name.length >= 2) update.display_name = name;
    }

    if (typeof body.avatarIndex === 'number') {
      update.avatar_index = Math.max(0, Math.min(63, Math.floor(body.avatarIndex)));
    }

    if (Object.keys(update).length > 0) {
      await supabase.from('profiles').update(update).eq('id', user.id);
    }
  }

  // El guardado se acepta tal cual PORQUE no decide nada: es una copia para
  // recuperar la partida en otro móvil. Lo que sale en la clasificación vive en
  // player_stats y solo lo escribe submit_round() tras validar cada jugada.
  if (body.save !== undefined) {
    await supabase.from('game_saves').upsert(
      {
        user_id: user.id,
        channel: 'production',
        data: body.save as Record<string, unknown>,
        game_version: typeof body.gameVersion === 'string' ? body.gameVersion : null,
      },
      { onConflict: 'user_id,channel' },
    );
  }

  return NextResponse.json({ ok: true });
}
