import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_CONFIG, formatBytes, formatDate } from '@/lib/config';
import type { AppConfig, Release } from '@/lib/types';
import { Badge } from '@/components/ui';
import { ConfigForm } from '@/components/admin/ConfigForm';
import { ReleaseForm } from '@/components/admin/ReleaseForm';
import { ReleaseRow } from '@/components/admin/ReleaseRow';

export const metadata: Metadata = {
  title: 'Panel',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/admin');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .maybeSingle();

  // Segunda comprobación, además de la del middleware. Una página de
  // administración que confía en una sola capa es una página que se abre sola
  // el día que esa capa cambie.
  if (profile?.role !== 'admin') {
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

  const admin = createAdminClient();

  const [{ data: configRows }, { data: releaseRows }, { count: userCount }] = await Promise.all([
    admin.from('app_config').select('*').order('channel'),
    admin
      .from('releases')
      .select('*')
      .order('channel')
      .order('major', { ascending: false })
      .order('minor', { ascending: false })
      .order('patch', { ascending: false }),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
  ]);

  const configs = (configRows ?? []) as AppConfig[];
  const releases = (releaseRows ?? []) as Release[];
  const production = configs.find((c) => c.channel === PUBLIC_CONFIG.CHANNEL) ?? configs[0];

  return (
    <div className="shell py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Panel</p>
          <h1 className="heading mt-2 text-3xl">Administración</h1>
          <p className="mt-1 text-sm text-slate-400">
            {profile.display_name} · {userCount ?? 0} usuarios registrados
          </p>
        </div>

        <div className="flex items-center gap-3">
          {production?.maintenance_mode && <Badge tone="red">Mantenimiento activo</Badge>}

          <Link href="/admin/en-vivo" className="btn-gold">
            En vivo
          </Link>
          <Link href="/admin/jugadores" className="btn-ghost">
            Jugadores
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------ interruptor general */}
      <section className="mb-12">
        <h2 className="heading mb-4 text-xl">Configuración del canal</h2>

        <div className="panel-gold p-7">
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
            <strong className="text-gold-300">Versión mínima online</strong> es el
            interruptor con más alcance de este panel: en cuanto la subas, todo el que
            tenga una versión inferior dejará de poder entrar al modo online y verá la
            ventana de actualización. El modo sin conexión no se ve afectado. Súbela solo
            cuando la versión nueva ya esté publicada y descargable.
          </p>

          {production ? (
            <ConfigForm config={production} />
          ) : (
            <p className="text-sm text-red-300">
              No hay configuración para el canal {PUBLIC_CONFIG.CHANNEL}. Ejecuta{' '}
              <code>03_seed.sql</code>.
            </p>
          )}
        </div>
      </section>

      {/* -------------------------------------------------------- versiones */}
      <section className="mb-12">
        <h2 className="heading mb-4 text-xl">Versiones ({releases.length})</h2>

        {releases.length === 0 ? (
          <div className="panel p-8 text-center text-sm text-slate-400">
            Todavía no hay ninguna versión. Crea la primera abajo.
          </div>
        ) : (
          <div className="space-y-3">
            {releases.map((release) => (
              <ReleaseRow key={release.id} release={release} />
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------- nueva versión */}
      <section>
        <h2 className="heading mb-4 text-xl">Publicar una versión nueva</h2>

        <div className="panel p-7">
          <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
            Sube primero el APK a GitHub Releases y pega aquí su enlace directo. El binario
            no se guarda en Supabase: el plan gratuito son 1 GB en total, unos trece APK, y
            GitHub no tiene ese límite.
          </p>

          <ReleaseForm />
        </div>
      </section>

      {/* -------------------------------------------------------- resumen */}
      <section className="mt-12">
        <h2 className="heading mb-4 text-xl">Resumen de binarios</h2>

        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Versión</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Android</th>
                <th className="px-4 py-3">Windows</th>
                <th className="px-4 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {releases.map((release) => (
                <tr key={release.id} className="bg-ink-900/50">
                  <td className="px-4 py-3 font-display font-bold text-gold-300">{release.version}</td>
                  <td className="px-4 py-3 text-slate-400">{release.channel}</td>
                  <td className="px-4 py-3">
                    <Badge tone={release.status === 'published' ? 'green' : 'slate'}>
                      {release.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {release.android_url ? formatBytes(release.android_size_bytes) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {release.windows_url ? formatBytes(release.windows_size_bytes) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(release.released_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
