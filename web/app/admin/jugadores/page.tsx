import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatCents, formatSince } from '@/lib/config';
import type { AdminGrant, AdminPlayer, Profile, WebAccount } from '@/lib/types';
import { Badge, Empty } from '@/components/ui';
import { PlayerRow } from '@/components/admin/PlayerRow';
import { AccountRow } from '@/components/admin/AccountRow';

export const metadata: Metadata = {
  title: 'Jugadores',
  robots: { index: false, follow: false },
};

/**
 * Nunca cacheada.
 *
 * Es un panel de mando: una página de saldos servida desde caché es una página
 * que miente, y aquí mentir significa dar dos veces el mismo dinero porque la
 * primera no se veía.
 */
export const dynamic = 'force-dynamic';

const ONLINE_WINDOW_SECONDS = 90;

export default async function PlayersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/admin/jugadores');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  // Segunda comprobación, además de la del middleware. Una página de
  // administración que confía en una sola capa es una página que se abre sola
  // el día que esa capa cambie.
  if (profile?.role !== 'admin') return <NoAccess />;

  const admin = createAdminClient();

  const [everyone, grants, accounts] = await Promise.all([
    loadPlayers(),
    loadGrants(),
    loadAccounts(),
  ]);

  // Los bots no son jugadores para las cuentas de esta página: van aparte (y
  // con su detalle en /admin/en-vivo).
  const isBot = (p: AdminPlayer) => (p as AdminPlayer & { is_bot?: boolean }).is_bot === true;
  const players = everyone.filter((p) => !isBot(p));
  const botCount = everyone.length - players.length;

  const online = players.filter(
    (p) => Date.now() - new Date(p.last_seen).getTime() <= ONLINE_WINDOW_SECONDS * 1000,
  ).length;

  const total = players.reduce((sum, p) => sum + p.balance_cents, 0);
  const pending = grants.filter((g) => !g.delivered_at);

  async function loadPlayers(): Promise<AdminPlayer[]> {
    const { data, error } = await admin
      .from('admin_players_overview')
      .select('*')
      .order('balance_cents', { ascending: false })
      .limit(500);

    if (error) console.error('[admin/jugadores] players', error);
    return (data ?? []) as AdminPlayer[];
  }

  async function loadGrants(): Promise<AdminGrant[]> {
    const { data, error } = await admin
      .from('online_grants')
      .select('*')
      .order('id', { ascending: false })
      .limit(60);

    if (error) console.error('[admin/jugadores] grants', error);
    return (data ?? []) as AdminGrant[];
  }

  /**
   * Las cuentas de la web salen de dos sitios que hay que juntar aquí: el correo
   * vive en auth.users, al que solo llega la clave de servicio, y el rol vive en
   * profiles. No hay forma de pedirlos en una sola consulta.
   */
  async function loadAccounts(): Promise<WebAccount[]> {
    try {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) throw error;

      const { data: profiles } = await admin.from('profiles').select('*');
      const byId = new Map((profiles ?? []).map((p) => [(p as Profile).id, p as Profile]));

      return data.users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        display_name: byId.get(u.id)?.display_name ?? '—',
        role: byId.get(u.id)?.role ?? 'player',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }));
    } catch (error) {
      console.error('[admin/jugadores] accounts', error);
      return [];
    }
  }

  return (
    <div className="shell py-12">
      <header className="mb-10">
        <Link href="/admin" className="text-xs text-slate-500 transition-colors hover:text-gold-400">
          ← Panel
        </Link>

        <h1 className="heading mt-2 text-3xl">Jugadores</h1>
        <p className="mt-1 text-sm text-slate-400">
          {players.length} en el online · {online} conectados ahora · {formatCents(total)} en
          circulación{botCount > 0 ? ` · ${botCount} bots aparte` : ''}
        </p>
      </header>

      {/* ------------------------------------------------------ los jugadores */}
      <section className="mb-14">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="heading text-xl">Del juego ({players.length})</h2>

          {pending.length > 0 && (
            <Badge tone="gold">{pending.length} ajustes sin recoger</Badge>
          )}
        </div>

        {players.length === 0 ? (
          <Empty title="Todavía no hay nadie en el online">
            En cuanto alguien abra el juego y elija jugar en línea, aparecerá aquí.
          </Empty>
        ) : (
          <div className="space-y-2">
            {players.map((player) => (
              <PlayerRow key={player.player_id} player={player} />
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- el historial */}
      <section className="mb-14">
        <h2 className="heading mb-4 text-xl">Movimientos recientes</h2>

        {grants.length === 0 ? (
          <Empty title="Sin movimientos">
            Aquí aparece cada vez que das o quitas dinero, y si el juego ya se lo ha llevado.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Jugador</th>
                  <th className="px-4 py-3">Cantidad</th>
                  <th className="px-4 py-3">Motivo</th>
                  <th className="px-4 py-3">Cuándo</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {grants.map((grant) => {
                  const name =
                    players.find((p) => p.player_id === grant.player_id)?.name ??
                    grant.player_id.slice(0, 8);

                  return (
                    <tr key={grant.id} className="bg-ink-900/50">
                      <td className="px-4 py-3 text-slate-300">{name}</td>
                      <td
                        className={`px-4 py-3 font-display font-bold ${
                          grant.amount_cents >= 0 ? 'text-emerald-300' : 'text-red-300'
                        }`}
                      >
                        {grant.amount_cents >= 0 ? '+' : ''}
                        {formatCents(grant.amount_cents)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-400">
                        {grant.reason}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatSince(grant.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={grant.delivered_at ? 'green' : 'slate'}>
                          {grant.delivered_at ? 'entregado' : 'esperando'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- cuentas de la web */}
      <section>
        <h2 className="heading mb-2 text-xl">Cuentas de la web ({accounts.length})</h2>
        <p className="mb-4 max-w-2xl text-sm leading-relaxed text-slate-400">
          Quien se ha registrado en el sitio. Es una lista distinta de la de arriba: el juego
          todavía no pide cuenta, se identifica con el código que genera el propio móvil.
          Borrar una cuenta aquí borra sus credenciales y su partida en la nube, y no se puede
          deshacer.
        </p>

        {accounts.length === 0 ? (
          <Empty title="Sin cuentas registradas">
            Si esperabas ver alguna, comprueba que SUPABASE_SERVICE_ROLE_KEY está puesta en
            Vercel.
          </Empty>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} me={user.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="heading text-2xl">Sin acceso</h1>
      <p className="mt-3 max-w-md text-sm text-slate-400">
        Esta zona es solo para administradores. Si deberías tener acceso, ejecuta{' '}
        <code className="text-gold-400">09_panel_admin.sql</code> con tu correo en el SQL
        Editor de Supabase.
      </p>
    </div>
  );
}
