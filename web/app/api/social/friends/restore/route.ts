import { body, corsPreflight, currentUser, db, json, needsAccount } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { playerIdOf } from '@/lib/ranking';

/**
 * POST /api/social/friends/restore   { ids: [...] }
 *
 * El juego guarda en su partida (que va a la nube) la lista de amigos que
 * tenía. Si al abrir la lista el servidor no los tiene -se perdieron por lo que
 * fuera-, los manda aquí y se vuelven a poner, en las dos direcciones.
 *
 * Solo ids de cuentas que existen, como mucho 100, y nunca uno mismo. Quitar a
 * un amigo lo saca también de la lista guardada del juego, así que esto no
 * resucita amistades que alguien haya quitado a propósito.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<{ ids?: unknown }>(request);
  const me = await playerIdOf(user.id);
  const wanted = [...new Set((Array.isArray(input.ids) ? input.ids : [])
    .map((v) => String(v ?? '').trim())
    .filter((v) => UUID.test(v) && v !== me && v !== user.id))].slice(0, 100);

  if (!wanted.length) return json({ ok: true, restored: 0 });

  const client = db();
  const { data: accounts } = await client.from('profiles').select('id').in('id', wanted);
  // Los que se quitaron a propósito (en cualquiera de las dos direcciones) no vuelven.
  const [mine, theirs] = await Promise.all([
    client.from('audit_log').select('detail').eq('action', 'friend.remove').eq('target', me).limit(1000),
    client.from('audit_log').select('target').eq('action', 'friend.remove').in('target', wanted).eq('detail->>friend_id', me).limit(1000),
  ]);
  const removed = new Set<string>([
    ...((mine.data ?? []) as { detail: { friend_id?: string } | null }[]).map((r: { detail: { friend_id?: string } | null }) => String(r.detail?.friend_id ?? '')),
    ...((theirs.data ?? []) as { target: string }[]).map((r: { target: string }) => String(r.target)),
  ]);
  const real: string[] = ((accounts ?? []) as { id: string }[]).map((a: { id: string }) => String(a.id)).filter((id: string) => !removed.has(id));
  if (!real.length) return json({ ok: true, restored: 0 });

  const rows = real.flatMap((id: string) => [
    { player_id: me, friend_id: id },
    { player_id: id, friend_id: me },
  ]);

  const { error } = await client.from('online_friends').upsert(rows, { onConflict: 'player_id,friend_id', ignoreDuplicates: true });
  if (error) {
    console.error('[social/friends/restore]', error);
    return json({ ok: false, restored: 0 });
  }

  return json({ ok: true, restored: real.length });
}

export async function OPTIONS() {
  return corsPreflight();
}
