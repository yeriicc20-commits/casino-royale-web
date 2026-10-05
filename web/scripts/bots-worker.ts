/**
 * Worker de bots: mueve a los bots sin parar, en un proceso propio.
 *
 *   npm run bots:worker
 *
 * Para una máquina siempre encendida (un PC, una Raspberry, un VPS gratuito...).
 * Lee las mismas variables que la web (.env.local): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY y las BOTS_*. Puede convivir con el cron de
 * /api/cron/bots: el turno de la base de datos hace que solo uno mueva bots.
 *
 * Ctrl+C (o SIGTERM) lo para con orden: guarda y suelta el turno.
 */
import { BotManager } from '../lib/bots/manager';
import { readBotsConfig } from '../lib/bots/config';
import { runFor } from '../lib/bots/runner';
import { createSupabasePorts } from '../lib/bots/supabase-ports';

async function main() {
  const cfg = readBotsConfig();
  const manager = new BotManager(createSupabasePorts(), cfg);
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => stop.abort());

  console.log('[bots] worker', manager.owner, cfg.enabled ? `encendido (${cfg.minOnline}-${cfg.maxOnline})` : 'APAGADO (BOTS_ENABLED=false): solo desconecta');
  const summary = await runFor(manager, cfg.enabled ? Infinity : 3000, stop.signal);
  console.log('[bots] parado:', summary.stoppedBy, `${summary.ticks} vueltas, ${summary.steps} acciones`);
}

main().catch((e) => {
  console.error('[bots] worker', e);
  process.exit(1);
});
