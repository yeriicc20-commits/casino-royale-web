import 'server-only';

import { db } from '@/lib/online';
import { readBotsConfig } from './config';
import type { BotState, Runtime } from './types';

/**
 * Métricas de los bots para el panel, SIEMPRE separadas de las personas.
 * Salen de online_bots (estado de cada uno) y del runtime (acciones/minuto).
 */
export interface BotMetrics {
  enabled: boolean;
  installed: boolean;
  total: number;
  online: number;
  offline: number;
  byState: Record<BotState, number>;
  /** Jugando = máquinas + eventos + 1v1. */
  playing: number;
  idle: number;
  inEvents: number;
  lookingFor1v1: number;
  in1v1: number;
  actionsPerMinute: number;
  target: number;
  min: number;
  max: number;
  lastTickAt: string | null;
}

export async function botMetrics(): Promise<BotMetrics> {
  const cfg = readBotsConfig();
  const byState = {
    OFFLINE: 0, IDLE: 0, BROWSING: 0, BETTING: 0, PLAYING: 0, EVENT: 0, LOOKING_FOR_DUEL: 0, IN_DUEL: 0, COOLDOWN: 0,
  } as Record<BotState, number>;
  const out: BotMetrics = {
    enabled: cfg.enabled, installed: true, total: 0, online: 0, offline: 0, byState, playing: 0, idle: 0,
    inEvents: 0, lookingFor1v1: 0, in1v1: 0, actionsPerMinute: 0, target: 0, min: cfg.minOnline, max: cfg.maxOnline, lastTickAt: null,
  };
  const client = db();
  const [bots, runtime] = await Promise.all([
    client.from('online_bots').select('status').limit(5000),
    client.from('online_bot_runtime').select('state').eq('id', 1).maybeSingle(),
  ]);
  if (bots.error) return { ...out, installed: false };
  for (const r of (bots.data ?? []) as { status: BotState }[]) {
    out.total++;
    if (r.status in byState) byState[r.status]++;
  }
  out.offline = byState.OFFLINE;
  out.online = out.total - out.offline;
  out.playing = byState.PLAYING + byState.BETTING + byState.EVENT + byState.IN_DUEL;
  out.idle = byState.IDLE + byState.BROWSING + byState.COOLDOWN;
  out.inEvents = byState.EVENT;
  out.lookingFor1v1 = byState.LOOKING_FOR_DUEL;
  out.in1v1 = byState.IN_DUEL;
  const rt = (runtime.data as { state?: Partial<Runtime> } | null)?.state;
  if (rt) {
    out.target = Number(rt.target || 0);
    out.lastTickAt = rt.lastTickAt ? new Date(rt.lastTickAt).toISOString() : null;
    const minute = Math.floor(Date.now() / 60_000);
    const last5 = [1, 2, 3, 4, 5].map((k) => Number(rt.actions?.[String(minute - k)] ?? 0));
    out.actionsPerMinute = Math.round(last5.reduce((a, b) => a + b, 0) / 5);
  }
  return out;
}
