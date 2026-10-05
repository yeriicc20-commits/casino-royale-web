/**
 * El bucle que hace girar al BotManager. Uno solo por proceso, con UN
 * temporizador a la vez (nada de un setInterval por bot): vuelta, dormir lo
 * que diga la vuelta (entre 0,25 y 3 s, con un poco de azar), otra vuelta.
 *
 * Lo usan las dos formas de tener bots en marcha:
 *   - el cron (app/api/cron/bots): gira durante BOTS_TICK_BUDGET_SECONDS y suelta
 *   - el worker (scripts/bots-worker.ts): gira hasta que se le pare
 */
import type { BotManager, TickReport } from './manager';

export interface RunSummary {
  ticks: number;
  steps: number;
  joined: number;
  left: number;
  last: TickReport | null;
  stoppedBy: 'budget' | 'signal' | 'error';
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** Gira durante `budgetMs` (Infinity = hasta la señal) y suelta el turno al acabar. */
export async function runFor(manager: BotManager, budgetMs: number, signal?: AbortSignal): Promise<RunSummary> {
  const end = Date.now() + budgetMs;
  const out: RunSummary = { ticks: 0, steps: 0, joined: 0, left: 0, last: null, stoppedBy: 'budget' };
  try {
    while (Date.now() < end && !signal?.aborted) {
      let r: TickReport;
      try {
        r = await manager.tick();
      } catch (error) {
        console.error('[bots] vuelta fallida', error instanceof Error ? error.message : error);
        r = { ran: false, reason: 'error', online: 0, target: 0, steps: 0, joined: 0, left: 0, nextInMs: 5000 };
      }
      out.ticks++;
      out.steps += r.steps;
      out.joined += r.joined;
      out.left += r.left;
      out.last = r;
      // Otro proceso tiene el turno: se reintenta con calma.
      const wait = r.ran ? r.nextInMs + Math.floor(Math.random() * 180) : 4000 + Math.floor(Math.random() * 2000);
      await sleep(Math.max(0, Math.min(wait, end - Date.now())), signal);
    }
    if (signal?.aborted) out.stoppedBy = 'signal';
  } finally {
    await manager.stop().catch((e) => console.error('[bots] al soltar el turno', e));
  }
  return out;
}
