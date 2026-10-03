import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/admin/live             -> todos los jugadores (conectados primero)
 * GET /api/admin/live?player=ID   -> ademas el historial de ese jugador
 *
 * Para el panel en vivo (/admin/en-vivo), que pregunta cada pocos segundos.
 * Solo administradores (sesion de la web + rol admin); la clave de servicio
 * entra despues de comprobarlo.
 */
export const dynamic = 'force-dynamic';

const ONLINE_WINDOW_SECONDS = 40;

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return profile?.role === 'admin';
}

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'No tienes permiso.' }, { status: 403 });

  const admin = createAdminClient();
  const url = new URL(request.url);
  const playerId = url.searchParams.get('player');

  const { data: rows, error } = await admin
    .from('admin_players_overview')
    .select('*')
    .order('last_seen', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const players: Record<string, unknown>[] = (rows ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    online: now - new Date(String(p.last_seen)).getTime() <= ONLINE_WINDOW_SECONDS * 1000,
  }));

  let detail: Record<string, unknown> | null = null;
  if (playerId) {
    const [act, grants] = await Promise.all([
      admin.from('online_activity').select('*').eq('player_id', playerId).order('at', { ascending: false }).limit(400),
      admin.from('online_grants').select('*').eq('player_id', playerId).order('id', { ascending: false }).limit(50),
    ]);
    const activity = (act.data ?? []) as { delta_cents: number; rounds_delta: number; game: string | null; flag: string | null; at: string }[];

    // Resumen por maquina: cuanto ha ganado/perdido y cuantas rondas.
    const byGame = new Map<string, { game: string; delta: number; rounds: number }>();
    for (const a of activity) {
      const g = a.game || 'sin dato';
      const cur = byGame.get(g) ?? { game: g, delta: 0, rounds: 0 };
      cur.delta += Number(a.delta_cents || 0);
      cur.rounds += Number(a.rounds_delta || 0);
      byGame.set(g, cur);
    }

    // Senales de trampa: subidas imposibles, subidas sin jugar (sin ajuste del
    // panel) y ganancias enormes por ronda.
    const flags = activity.filter((a) => a.flag).length;
    let fastest = 0;
    for (const a of activity) if (a.rounds_delta > 0 && a.delta_cents > 0) fastest = Math.max(fastest, a.delta_cents / a.rounds_delta);

    let email: string | null = null;
    const player = players.find((p) => p.player_id === playerId) as { user_id?: string } | undefined;
    if (player?.user_id) {
      try {
        const { data } = await admin.auth.admin.getUserById(String(player.user_id));
        email = data.user?.email ?? null;
      } catch { /* sin correo */ }
    }

    detail = {
      activity,
      grants: grants.data ?? [],
      byGame: [...byGame.values()].sort((a, b) => b.rounds - a.rounds),
      flags,
      bestPerRoundCents: Math.round(fastest),
      email,
      activityMissing: !!act.error,
    };
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), players, detail });
}
