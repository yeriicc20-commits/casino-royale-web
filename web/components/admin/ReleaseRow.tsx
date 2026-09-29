'use client';

import { useState } from 'react';
import { deleteRelease, setReleaseStatus } from '@/app/admin/actions';
import { formatDate } from '@/lib/config';
import type { Release } from '@/lib/types';
import { Badge } from '@/components/ui';
import { ReleaseForm } from '@/components/admin/ReleaseForm';

export function ReleaseRow({ release }: { release: Release }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const published = release.status === 'published';

  async function toggle() {
    setBusy(true);
    setError(null);

    const result = await setReleaseStatus(release.id, published ? 'draft' : 'published');

    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  async function remove() {
    setBusy(true);
    setError(null);

    const result = await deleteRelease(release.id);

    setBusy(false);
    setConfirming(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 p-5">
        <span className="font-display text-lg font-bold text-gold-300">{release.version}</span>

        <Badge tone={published ? 'green' : 'slate'}>{release.status}</Badge>
        <Badge tone="slate">{release.channel}</Badge>

        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{release.title}</span>
        <span className="text-xs text-slate-500">{formatDate(release.released_at)}</span>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-200
                       transition-colors hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-50"
          >
            {published ? 'Despublicar' : 'Publicar'}
          </button>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-200
                       transition-colors hover:border-gold-500/40 hover:text-gold-300"
          >
            {open ? 'Cerrar' : 'Editar'}
          </button>

          {confirming ? (
            <>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="rounded-lg border border-ruby-500/40 bg-ruby-500/10 px-3 py-1.5 text-xs
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
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-400
                         transition-colors hover:border-ruby-500/40 hover:text-red-300"
            >
              Borrar
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="border-t border-white/8 bg-ruby-500/5 px-5 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {open && (
        <div className="border-t border-white/8 bg-ink-950/40 p-6">
          <ReleaseForm release={release} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
