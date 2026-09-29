import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/config';
import { Badge, Section, Stat } from '@/components/ui';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata: Metadata = {
  title: 'Mi cuenta',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function euros(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // El middleware ya redirige, pero esto lo vuelve a comprobar: una página que
  // depende de otra capa para no filtrar datos es una página frágil.
  if (!user) redirect('/login?next=/account');

  const [{ data: profile }, { data: stats }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('player_stats').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  return (
    <Section kicker="Tu cuenta" title={profile?.display_name ?? 'Jugador'}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="panel-gold p-7 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">Saldo</p>
              <p className="mt-1 font-display text-4xl font-bold text-gold-300">
                {euros(stats?.balance_cents)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Dinero ficticio, sin valor real.</p>
            </div>

            {profile?.friend_code && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-slate-500">Código de amigo</p>
                <p className="mt-1 font-display text-2xl font-bold tracking-widest text-gold-300">
                  {profile.friend_code}
                </p>
              </div>
            )}
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-white/8 pt-6 sm:grid-cols-4">
            <Stat label="Rondas" value={stats?.rounds_played ?? 0} />
            <Stat label="Apostado" value={euros(stats?.total_staked_cents)} />
            <Stat label="Ganado" value={euros(stats?.total_won_cents)} />
            <Stat label="Mayor premio" value={euros(stats?.biggest_win_cents)} />
          </dl>
        </div>

        <div className="panel space-y-5 p-7">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">Correo</p>
            <p className="mt-1 break-all text-sm text-slate-200">{user.email ?? '—'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">Cuenta creada</p>
            <p className="mt-1 text-sm text-slate-200">{formatDate(user.created_at)}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">Acceso</p>
            <p className="mt-1">
              {profile?.role === 'admin' ? <Badge tone="gold">Administrador</Badge> : <Badge tone="slate">Jugador</Badge>}
            </p>
          </div>

          <div className="space-y-3 border-t border-white/8 pt-5">
            {profile?.role === 'admin' && (
              <Link href="/admin" className="btn-gold w-full">Panel de administración</Link>
            )}
            <SignOutButton />
          </div>
        </div>
      </div>

      <div className="panel mt-8 p-7">
        <h2 className="heading text-lg">Tu progreso en otro dispositivo</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Inicia sesión con esta misma cuenta en el juego y tu saldo, tus estadísticas y tus
          amigos aparecerán allí. El modo sin conexión sigue funcionando con o sin cuenta;
          lo que no se sincroniza mientras juegas desconectado se envía la próxima vez que
          entres con red.
        </p>
      </div>
    </Section>
  );
}
