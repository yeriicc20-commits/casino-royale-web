import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LivePanel } from '@/components/admin/LivePanel';

export const metadata: Metadata = {
  title: 'En vivo',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/en-vivo');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') {
    return (
      <div className="shell flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="heading text-2xl">Sin acceso</h1>
        <p className="mt-3 max-w-md text-sm text-slate-400">Esta zona es solo para administradores.</p>
      </div>
    );
  }

  return (
    <div className="shell py-10">
      <header className="mb-8">
        <Link href="/admin" className="text-xs text-slate-500 transition-colors hover:text-gold-400">
          ← Panel
        </Link>
        <h1 className="heading mt-2 text-3xl">Jugadores en vivo</h1>
        <p className="mt-1 text-sm text-slate-400">
          Se actualiza solo cada 3 segundos. El saldo llega del juego cada 10 segundos.
        </p>
      </header>
      <LivePanel />
    </div>
  );
}
