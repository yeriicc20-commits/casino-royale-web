import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Release, ReleaseChannel } from '@/lib/types';

/**
 * GET /api/game/updates
 *
 * Historial completo de versiones publicadas. Lo usa la web y puede usarlo el
 * juego para la pantalla de "qué hay de nuevo".
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const channel = (url.searchParams.get('channel') ?? 'production') as ReleaseChannel;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('releases')
    .select('*')
    .eq('channel', channel)
    .eq('status', 'published')
    .order('major', { ascending: false })
    .order('minor', { ascending: false })
    .order('patch', { ascending: false });

  if (error) {
    console.error('[api/game/updates]', error);
    return NextResponse.json({ updates: [] }, { status: 200 });
  }

  const updates = (data as Release[]).map((release) => ({
    version: release.version,
    title: release.title,
    summary: release.summary,
    releasedAt: release.released_at,
    added: release.notes_added ?? [],
    fixed: release.notes_fixed ?? [],
    changed: release.notes_changed ?? [],
    technical: release.notes_technical ?? [],
  }));

  return NextResponse.json({ updates });
}
