'use client';

import { useState, useTransition } from 'react';
import {
  adjustPlayerMoney,
  deletePlayer,
  renamePlayer,
} from '@/app/admin/players-actions';
import { formatCents, formatSince } from '@/lib/config';
import type { AdminPlayer } from '@/lib/types';
import { Badge } from '@/components/ui';

/** Segundos sin dar señales tras los cuales alguien deja de contar como conectado. */
const ONLINE_WINDOW_SECONDS = 90;

/** Atajos de cantidad. Los que se usan el noventa por ciento de las veces. */
const QUICK = [100, 1000, 10000];

export function PlayerRow({ player }: { player: AdminPlayer }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState(player.name);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const online =
    Date.now() - new Date(player.last_seen).getTime() <= ONLINE_WINDOW_SECONDS * 1000;

  function run(work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMessage(null);

    startTransition(async () => {
      const result = await work();

      setMessage(
        result.ok
          ? { tone: 'ok', text: success }
          : { tone: 'bad', text: result.error ?? 'No se pudo.' },
      );
    });
  }

  function give(euros: number) {
    run(
      () => adjustPlayerMoney(player.player_id, euros, reason),
      euros > 0
        ? `Encolados ${formatCents(Math.round(euros * 100))} para ${player.name}.`
        : `Encolado el descuento de ${formatCents(Math.round(-euros * 100))}.`,
    );

    setAmount('');
  }

  function giveTyped(sign: 1 | -1) {
    // Se acepta la coma además del punto: es lo que sale de un teclado español,
    // y Number('12,50') es NaN.
    const euros = Number(amount.replace(',', '.'));

    if (!Number.isFinite(euros) || euros <= 0) {
      setMessage({ tone: 'bad', text: 'Escribe una cantidad en euros.' });
      return;
    }

    give(sign * euros);
  }

  return (
    <div className="panel overflow-hidden">
      {/* ------------------------------------------------------- la fila */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 flex-none rounded-full ${
            online ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60' : 'bg-slate-600'
          }`}
        />

        <span className="min-w-0 flex-1 truncate font-display font-bold text-slate-100">
          {player.name}
        </span>

        {player.email && (
          <span className="hidden min-w-0 max-w-[14rem] truncate text-xs text-slate-500 md:inline">
            {player.email}
          </span>
        )}

        {player.friend_code && (
          <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">
            {player.friend_code}
          </code>
        )}

        <span className="font-display font-bold text-gold-300">
          {formatCents(player.balance_cents)}
        </span>

        {player.pending_grants > 0 && (
          <Badge tone={player.pending_cents >= 0 ? 'green' : 'red'}>
            {player.pending_cents >= 0 ? '+' : ''}
            {formatCents(player.pending_cents)} sin recoger
          </Badge>
        )}

        <span className="hidden text-xs text-slate-500 sm:inline">
          {player.rounds} rondas · {player.friends} amigos · {formatSince(player.last_seen)}
        </span>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-slate-200
                     transition-colors hover:border-gold-500/40 hover:text-gold-300"
        >
          {open ? 'Cerrar' : 'Gestionar'}
        </button>
      </div>

      {message && (
        <p
          className={`border-t border-white/8 px-4 py-2.5 text-sm ${
            message.tone === 'ok'
              ? 'bg-emerald-500/5 text-emerald-300'
              : 'bg-ruby-500/5 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* ---------------------------------------------------- el desplegable */}
      {open && (
        <div className="space-y-6 border-t border-white/8 bg-ink-950/40 p-6">
          {/* ------------------------------------------------------ dinero */}
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-200">Saldo</h4>
            <p className="mb-4 max-w-2xl text-xs leading-relaxed text-slate-500">
              El dinero no se escribe en el servidor: se deja anotado y el juego se lo
              lleva la próxima vez que dé señales, que es cada treinta segundos mientras
              esté abierto. Si ahora mismo no está jugando, lo recogerá al entrar.
            </p>

            <div className="mb-3 flex flex-wrap gap-2">
              {QUICK.map((euros) => (
                <button
                  key={euros}
                  type="button"
                  disabled={pending}
                  onClick={() => give(euros)}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5
                             text-xs text-emerald-300 transition-colors hover:bg-emerald-500/20
                             disabled:opacity-50"
                >
                  +{euros.toLocaleString('es-ES')} €
                </button>
              ))}

              {QUICK.map((euros) => (
                <button
                  key={`-${euros}`}
                  type="button"
                  disabled={pending}
                  onClick={() => give(-euros)}
                  className="rounded-lg border border-ruby-500/30 bg-ruby-500/10 px-3 py-1.5
                             text-xs text-red-300 transition-colors hover:bg-ruby-500/20
                             disabled:opacity-50"
                >
                  −{euros.toLocaleString('es-ES')} €
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Cantidad en €"
                className="w-40 rounded-lg border border-white/12 bg-ink-900 px-3 py-2 text-sm
                           text-slate-100 placeholder:text-slate-600 focus:border-gold-500/50
                           focus:outline-none"
              />

              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo (lo verá el jugador)"
                maxLength={140}
                className="min-w-[14rem] flex-1 rounded-lg border border-white/12 bg-ink-900 px-3
                           py-2 text-sm text-slate-100 placeholder:text-slate-600
                           focus:border-gold-500/50 focus:outline-none"
              />

              <button
                type="button"
                disabled={pending}
                onClick={() => giveTyped(1)}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2
                           text-sm text-emerald-300 disabled:opacity-50"
              >
                Dar
              </button>

              <button
                type="button"
                disabled={pending}
                onClick={() => giveTyped(-1)}
                className="rounded-lg border border-ruby-500/40 bg-ruby-500/10 px-4 py-2 text-sm
                           text-red-300 disabled:opacity-50"
              >
                Quitar
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------ nombre */}
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-200">Nombre en el podio</h4>
            <p className="mb-3 max-w-2xl text-xs leading-relaxed text-slate-500">
              Cambiarlo aquí sirve para quitar un nombre ofensivo del podio ahora mismo. El
              juego volverá a publicar el suyo en el siguiente latido, así que es un parche,
              no una sanción.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={name}
                maxLength={16}
                onChange={(event) => setName(event.target.value)}
                className="w-56 rounded-lg border border-white/12 bg-ink-900 px-3 py-2 text-sm
                           text-slate-100 focus:border-gold-500/50 focus:outline-none"
              />

              <button
                type="button"
                disabled={pending || name.trim() === player.name}
                onClick={() =>
                  run(() => renamePlayer(player.player_id, name), 'Nombre cambiado.')
                }
                className="rounded-lg border border-white/12 px-4 py-2 text-sm text-slate-200
                           transition-colors hover:border-gold-500/40 hover:text-gold-300
                           disabled:opacity-40"
              >
                Cambiar
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------ borrar */}
          <div className="border-t border-white/8 pt-5">
            <h4 className="mb-1 text-sm font-semibold text-slate-200">Borrar del online</h4>
            <p className="mb-3 max-w-2xl text-xs leading-relaxed text-slate-500">
              Quita su ficha del podio, sus amistades y su partida guardada en la nube. La
              partida de su móvil no se toca: si vuelve a entrar con conexión, reaparecerá.
              No se puede deshacer.
            </p>

            {confirming ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirming(false);
                    run(() => deletePlayer(player.player_id), 'Jugador borrado.');
                  }}
                  className="rounded-lg border border-ruby-500/40 bg-ruby-500/15 px-4 py-2 text-sm
                             text-red-300 disabled:opacity-50"
                >
                  Sí, borrar a {player.name}
                </button>

                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg px-4 py-2 text-sm text-slate-400"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-white/12 px-4 py-2 text-sm text-slate-400
                           transition-colors hover:border-ruby-500/40 hover:text-red-300"
              >
                Borrar jugador
              </button>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-white/8 pt-5 text-xs
                         sm:grid-cols-4">
            <Field label="Cuenta" value={player.email ?? 'sin cuenta (versión antigua)'} />
            <Field label="Mayor premio" value={formatCents(player.biggest_win_cents)} />
            <Field label="Rondas" value={String(player.rounds)} />
            <Field label="Partida en la nube" value={player.has_save ? 'Sí' : 'No'} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="uppercase tracking-wider text-slate-600">{label}</dt>
      <dd className={`truncate text-slate-300 ${mono ? 'font-mono text-[0.7rem]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
