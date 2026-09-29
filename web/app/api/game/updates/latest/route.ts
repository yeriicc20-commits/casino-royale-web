import { NextResponse } from 'next/server';
import { resolveVersionState } from '@/lib/versions';

/** GET /api/game/updates/latest — solo la versión más reciente y sus novedades. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = await resolveVersionState(url.searchParams.get('version'));

  return NextResponse.json({
    latestVersion: state.latestVersion,
    notes: state.releaseNotes[0] ?? null,
  });
}
