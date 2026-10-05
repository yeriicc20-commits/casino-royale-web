import { NextResponse } from 'next/server';
import { BotManager } from '@/lib/bots/manager';
import { readBotsConfig } from '@/lib/bots/config';
import { runFor } from '@/lib/bots/runner';
import { createSupabasePorts } from '@/lib/bots/supabase-ports';

/**
 * GET /api/cron/bots
 *
 * Mueve a los bots durante BOTS_TICK_BUDGET_SECONDS (50 s por defecto) y suelta
 * el turno. Pensada para un cron que la llame CADA MINUTO (cron-job.org, que es
 * gratis y admite un minuto, o GitHub Actions con su mínimo de cinco). Si dos
 * llamadas se solapan no pasa nada: el turno de online_bot_runtime hace que
 * solo una mueva bots y la otra termine enseguida.
 *
 * Con BOTS_ENABLED=false la llamada solo desconecta con orden a los que
 * quedaran conectados y termina.
 *
 * Protegida con CRON_SECRET, como /api/cron/keepalive.
 *
 * Alternativa sin cron: el worker (npm run bots:worker) en cualquier máquina
 * que esté siempre encendida. Ver README → Jugadores bot.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const cfg = readBotsConfig();
  const manager = new BotManager(createSupabasePorts(), cfg);
  // Un poco menos que el límite de la función, para soltar el turno con calma.
  const budget = Math.min(cfg.tickBudgetSeconds, maxDuration - 8) * 1000;
  // Apagado: una vuelta basta para desconectar a los que quedaran.
  const summary = await runFor(manager, cfg.enabled ? budget : 2000);

  return NextResponse.json({
    ok: true,
    enabled: cfg.enabled,
    ticks: summary.ticks,
    steps: summary.steps,
    joined: summary.joined,
    left: summary.left,
    online: summary.last?.online ?? 0,
    target: summary.last?.target ?? 0,
    lease: summary.last?.reason === 'lease' ? 'otro proceso tiene el turno' : 'ok',
  });
}
