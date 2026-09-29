'use client';

import { useState, useTransition } from 'react';
import { deleteWebAccount, setAccountRole } from '@/app/admin/players-actions';
import { formatDate } from '@/lib/config';
import type { WebAccount } from '@/lib/types';
import { Badge } from '@/components/ui';

/**
 * Una cuenta de la web.
 *
 * Es otra cosa que un jugador del online: aquí vive quien se ha registrado en
 * el sitio, con su correo. El juego todavía no pide cuenta -se identifica con
 * el código que genera el móvil- así que las dos listas no se solapan.
 */
export function AccountRow({ account, me }: { account: WebAccount; me: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isMe = account.id === me;
  const isAdmin = account.role === 'admin';

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? 'No se pudo.');
    });
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
          {account.email ?? '(sin correo)'}
        </span>

        <span className="hidden text-xs text-slate-500 sm:inline">{account.display_name}</span>

        {isAdmin && <Badge tone="gold">admin</Badge>}
        {isMe && <Badge tone="slate">tú</Badge>}

        <span className="text-xs text-slate-500">{formatDate(account.created_at)}</span>

        <button
          type="button"
          disabled={pending || isMe}
          onClick={() => run(() => setAccountRole(account.id, isAdmin ? 'player' : 'admin'))}
          className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-200
                     transition-colors hover:border-gold-500/40 hover:text-gold-300
                     disabled:opacity-30"
        >
          {isAdmin ? 'Quitar admin' : 'Hacer admin'}
        </button>

        {confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                run(() => deleteWebAccount(account.id));
              }}
              className="rounded-lg border border-ruby-500/40 bg-ruby-500/15 px-3 py-1.5 text-xs
                         text-red-300 disabled:opacity-50"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-400"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isMe}
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-400
                       transition-colors hover:border-ruby-500/40 hover:text-red-300
                       disabled:opacity-30"
          >
            Borrar
          </button>
        )}
      </div>

      {error && (
        <p className="border-t border-white/8 bg-ruby-500/5 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
