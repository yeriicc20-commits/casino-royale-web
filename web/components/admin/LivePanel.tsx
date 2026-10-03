'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { adjustPlayerMoney, deletePlayer, deleteWebAccount } from '@/app/admin/players-actions';
import { formatCents, formatSince } from '@/lib/config';
import { Badge } from '@/components/ui';

interface LivePlayer {
  player_id: string;
  name: string;
  balance_cents: number;
  biggest_win_cents: number;
  rounds: number;
  last_seen: string;
  playing?: string | null;
  user_id?: string | null;
  pending_grants: number;
  pending_cents: number;
  online: boolean;
}

interface Activity { id: number; at: string; balance_cents: number; delta_cents: number; rounds: number; rounds_delta: number; game: string | null; flag: string | null }
interface Grant { id: number; amount_cents: number; reason: string; created_at: string; delivered_at: string | null }
interface Detail {
  activity: Activity[];
  grants: Grant[];
  byGame: { game: string; delta: number; rounds: number }[];
  flags: number;
  bestPerRoundCents: number;
  email: string | null;
  activityMissing: boolean;
}

const GAME_NAMES: Record<string, string> = {
  sala: 'En la sala', slots: 'Tragaperras', blackjack: 'Blackjack', roulette: 'Ruleta', holdem: "Hold'em",
  crash: 'Crash', mines: 'Minas', plinko: 'Plinko', keno: 'Keno', horses: 'Caballos', tute: 'Tute',
  dice: 'Dados', baccarat: 'Bacarrá', hilo: 'Mayor o menor', scratch: 'Rasca', videopoker: 'Video póker',
};
const gameName = (g?: string | null) => (g ? GAME_NAMES[g] ?? g : '—');

export function LivePanel() {
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [changed, setChanged] = useState<Record<string, number>>({});
  const prev = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/live' + (openId ? '?player=' + encodeURIComponent(openId) : ''), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? 'No se pudo cargar.'); return; }
      setError(null);
      const list = data.players as LivePlayer[];
      // Cuanto ha cambiado el saldo desde la ultima vez (se ve unos segundos).
      const diff: Record<string, number> = {};
      for (const p of list) {
        const before = prev.current.get(p.player_id);
        if (before !== undefined && before !== p.balance_cents) diff[p.player_id] = p.balance_cents - before;
        prev.current.set(p.player_id, p.balance_cents);
      }
      if (Object.keys(diff).length) {
        setChanged((c) => ({ ...c, ...diff }));
        setTimeout(() => setChanged((c) => { const n = { ...c }; for (const k of Object.keys(diff)) delete n[k]; return n; }), 6000);
      }
      setPlayers(list);
      setDetail(data.detail ?? null);
    } catch {
      setError('Sin conexión con el servidor.');
    }
  }, [openId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const shown = players
    .filter((p) => !onlyOnline || p.online)
    .sort((a, b) => Number(b.online) - Number(a.online) || b.balance_cents - a.balance_cents);
  const online = players.filter((p) => p.online).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge tone={online ? 'green' : 'slate'}>{online} conectados ahora</Badge>
        <span className="text-sm text-slate-400">{players.length} jugadores en total</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} />
          Solo conectados
        </label>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-white/10 px-5 py-10 text-center text-slate-400">
          {onlyOnline ? 'Ahora mismo no hay nadie conectado.' : 'Todavía no hay jugadores.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((p) => (
            <Row
              key={p.player_id}
              player={p}
              delta={changed[p.player_id]}
              open={openId === p.player_id}
              detail={openId === p.player_id ? detail : null}
              onToggle={() => { setOpenId(openId === p.player_id ? null : p.player_id); setDetail(null); }}
              onDone={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ player, delta, open, detail, onToggle, onDone }: {
  player: LivePlayer; delta?: number; open: boolean; detail: Detail | null; onToggle: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [alsoAccount, setAlsoAccount] = useState(false);

  function money(sign: 1 | -1) {
    const euros = Number(String(amount).replace(',', '.'));
    if (!Number.isFinite(euros) || euros <= 0) { setMsg({ ok: false, text: 'Pon una cantidad.' }); return; }
    const text = reason.trim() || (sign > 0 ? 'Regalo del administrador' : 'Ajuste del administrador');
    start(async () => {
      const r = await adjustPlayerMoney(player.player_id, sign * euros, text);
      setMsg(r.ok ? { ok: true, text: (sign > 0 ? 'Enviado +' : 'Enviado -') + formatCents(euros * 100) + '. Le llega en unos segundos con tu mensaje.' } : { ok: false, text: r.error });
      if (r.ok) { setAmount(''); setReason(''); onDone(); }
    });
  }

  function remove() {
    if (!window.confirm('¿Borrar a ' + player.name + ' del online' + (alsoAccount ? ' Y su cuenta de la web (correo y contraseña)' : '') + '? No se puede deshacer.')) return;
    start(async () => {
      const r = await deletePlayer(player.player_id);
      if (r.ok && alsoAccount && player.user_id) await deleteWebAccount(String(player.user_id));
      setMsg(r.ok ? { ok: true, text: 'Borrado.' } : { ok: false, text: r.error });
      onDone();
    });
  }

  return (
    <div className={`rounded-2xl border ${player.online ? 'border-emerald-500/30' : 'border-white/10'} bg-ink-900/60`}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-left">
        <span className={`h-2.5 w-2.5 rounded-full ${player.online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        <span className="min-w-[8rem] font-semibold text-slate-100">{player.name}</span>
        <span className="min-w-[9rem] font-display text-lg font-bold text-gold-400">
          {formatCents(player.balance_cents)}
          {delta !== undefined && (
            <span className={`ml-2 text-sm ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {delta >= 0 ? '+' : ''}{formatCents(delta)}
            </span>
          )}
        </span>
        <span className="text-sm text-slate-300">{player.online ? gameName(player.playing) : formatSince(player.last_seen)}</span>
        <span className="text-xs text-slate-500">{player.rounds} rondas · mayor premio {formatCents(player.biggest_win_cents)}</span>
        {player.pending_grants > 0 && <Badge tone="gold">{formatCents(player.pending_cents)} sin recoger</Badge>}
        <span className="ml-auto text-xs text-slate-500">{open ? 'Cerrar ▲' : 'Abrir ▼'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/10 px-4 py-4">
          {/* dinero con mensaje */}
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto]">
            <input className="rounded-lg border border-white/15 bg-ink-950 px-3 py-2 text-sm" placeholder="Euros" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="rounded-lg border border-white/15 bg-ink-950 px-3 py-2 text-sm" placeholder="Mensaje que verá en el juego (ej: Regalo por los fallos)" maxLength={140} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" disabled={pending} onClick={() => money(1)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Dar</button>
            <button type="button" disabled={pending} onClick={() => money(-1)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Quitar</button>
          </div>
          {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}

          {/* resumen anti-trampas */}
          {detail ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {detail.email && <Badge tone="slate">{detail.email}</Badge>}
                <Badge tone={detail.flags ? 'gold' : 'green'}>{detail.flags ? detail.flags + ' avisos sospechosos' : 'Sin avisos'}</Badge>
                <Badge tone="slate">Mejor ganancia por ronda: {formatCents(detail.bestPerRoundCents)}</Badge>
              </div>
              {detail.activityMissing && (
                <p className="text-sm text-amber-300">Falta ejecutar <code>15_panel_vivo.sql</code> en Supabase para ver el historial.</p>
              )}

              {detail.byGame.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-300">Por máquina (últimos movimientos)</h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.byGame.map((g) => (
                      <span key={g.game} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300">
                        {gameName(g.game)}: <b className={g.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>{g.delta >= 0 ? '+' : ''}{formatCents(g.delta)}</b> · {g.rounds} rondas
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-300">Historial del saldo</h3>
                <div className="max-h-80 overflow-y-auto rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-ink-950 text-slate-400">
                      <tr><th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Máquina</th><th className="px-3 py-2">Cambio</th><th className="px-3 py-2">Rondas</th><th className="px-3 py-2">Saldo</th><th className="px-3 py-2">Aviso</th></tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {detail.activity.map((a) => (
                        <tr key={a.id} className={a.flag ? 'bg-amber-500/10' : ''}>
                          <td className="px-3 py-1.5 text-slate-500">{new Date(a.at).toLocaleString('es-ES')}</td>
                          <td className="px-3 py-1.5 text-slate-300">{gameName(a.game)}</td>
                          <td className={`px-3 py-1.5 font-semibold ${a.delta_cents >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{a.delta_cents >= 0 ? '+' : ''}{formatCents(a.delta_cents)}</td>
                          <td className="px-3 py-1.5 text-slate-400">+{a.rounds_delta}</td>
                          <td className="px-3 py-1.5 text-slate-300">{formatCents(a.balance_cents)}</td>
                          <td className="px-3 py-1.5 text-amber-300">{a.flag ?? ''}</td>
                        </tr>
                      ))}
                      {detail.activity.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">Sin movimientos todavía.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail.grants.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-300">Dinero que le has dado o quitado</h3>
                  <ul className="space-y-1 text-xs text-slate-400">
                    {detail.grants.map((g) => (
                      <li key={g.id}>
                        <b className={g.amount_cents >= 0 ? 'text-emerald-300' : 'text-red-300'}>{g.amount_cents >= 0 ? '+' : ''}{formatCents(g.amount_cents)}</b> · {g.reason} · {formatSince(g.created_at)} · {g.delivered_at ? 'entregado' : 'esperando'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">Cargando historial…</p>
          )}

          {/* borrar */}
          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button type="button" disabled={pending} onClick={remove} className="rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">Borrar jugador</button>
            {player.user_id && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={alsoAccount} onChange={(e) => setAlsoAccount(e.target.checked)} />
                Borrar también su cuenta de la web (correo/Google)
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
