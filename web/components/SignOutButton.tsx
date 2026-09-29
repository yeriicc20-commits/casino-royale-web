'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        router.push('/');
        router.refresh();
      }}
      className="btn-ghost"
    >
      {busy ? 'Cerrando…' : 'Cerrar sesión'}
    </button>
  );
}
