/**
 * Configuración de los bots, toda por variables de entorno (Vercel →
 * Settings → Environment Variables, o .env.local). Sin ninguna, los bots están
 * APAGADOS: hay que encenderlos a propósito con BOTS_ENABLED=true.
 *
 *   BOTS_ENABLED=true            el interruptor general. false = todo parado
 *                                (los bots conectados se desconectan solos)
 *   BOTS_MIN_ONLINE=3            nunca menos conectados (con el sistema encendido)
 *   BOTS_MAX_ONLINE=50           nunca más
 *   BOTS_ALLOW_EVENTS=true       pueden entrar en los eventos
 *   BOTS_ALLOW_1V1=true          pueden buscar 1 contra 1 y retarse entre ellos
 *   BOTS_ALLOW_HUMAN_1V1=true    pueden aceptar (y, con amigos, proponer) 1v1 con personas
 *   BOTS_IN_LEADERBOARD=true     salen en la clasificación global como cualquiera
 *   BOTS_POOL_SIZE=80            cuántas cuentas de bot puede llegar a haber
 *   BOTS_TIMEZONE=Europe/Madrid  la hora que decide la franja de actividad
 *   BOTS_SCHEDULE=[...]          franjas propias (JSON, ver DEFAULT_SCHEDULE)
 *   BOTS_TICK_BUDGET_SECONDS=50  cuánto trabaja cada llamada del cron
 */

export interface Band {
  /** Hora de inicio (incluida) y fin (excluida), 0..24, en BOTS_TIMEZONE. */
  from: number;
  to: number;
  min: number;
  max: number;
  /** Solo esos días (0 domingo .. 6 sábado). Sin días = todos. */
  days?: number[];
}

export interface BotsConfig {
  enabled: boolean;
  minOnline: number;
  maxOnline: number;
  allowEvents: boolean;
  allow1v1: boolean;
  allowHuman1v1: boolean;
  inLeaderboard: boolean;
  poolSize: number;
  timeZone: string;
  schedule: Band[];
  tickBudgetSeconds: number;
  /** Segundos de arriendo del turno (si el proceso muere, otro entra a los pocos segundos). */
  leaseSeconds: number;
  /** Bots a los que se atiende como mucho en una vuelta. */
  maxStepsPerTick: number;
}

/**
 * Franjas por defecto (hora de España). Las de más gente son la tarde y la
 * noche, y la franja de los eventos (17:00-18:00, sábados 11:00-14:00) sube
 * un poco más por su cuenta. Las madrugadas, pocas.
 */
export const DEFAULT_SCHEDULE: Band[] = [
  { from: 0, to: 2, min: 6, max: 18 },
  { from: 2, to: 8, min: 3, max: 9 },
  { from: 8, to: 12, min: 8, max: 22 },
  { from: 12, to: 16, min: 12, max: 30 },
  { from: 16, to: 19, min: 26, max: 50 },
  { from: 19, to: 23, min: 22, max: 45 },
  { from: 23, to: 24, min: 10, max: 28 },
  // Sábado por la mañana: el evento semanal.
  { from: 10, to: 14, min: 22, max: 46, days: [6] },
];

type Env = Record<string, string | undefined>;

function flag(env: Env, key: string, fallback: boolean): boolean {
  const v = String(env[key] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function num(env: Env, key: string, fallback: number, min: number, max: number): number {
  const v = Number(String(env[key] ?? '').trim());
  if (!String(env[key] ?? '').trim() || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/** Las franjas de BOTS_SCHEDULE, o las de serie si no hay o están mal escritas. */
export function parseSchedule(raw: string | undefined): Band[] {
  if (!raw || !raw.trim()) return DEFAULT_SCHEDULE;
  try {
    const list = JSON.parse(raw) as Partial<Band>[];
    if (!Array.isArray(list) || !list.length) return DEFAULT_SCHEDULE;
    const bands: Band[] = [];
    for (const b of list) {
      const from = Number(b.from);
      const to = Number(b.to);
      const min = Number(b.min);
      const max = Number(b.max);
      if (![from, to, min, max].every(Number.isFinite) || from < 0 || to > 24 || from >= to || min > max) continue;
      const days = Array.isArray(b.days) ? b.days.map(Number).filter((d) => d >= 0 && d <= 6) : undefined;
      bands.push({ from, to, min: Math.floor(min), max: Math.floor(max), ...(days && days.length ? { days } : {}) });
    }
    return bands.length ? bands : DEFAULT_SCHEDULE;
  } catch {
    console.warn('[bots] BOTS_SCHEDULE no es JSON válido: se usan las franjas de serie.');
    return DEFAULT_SCHEDULE;
  }
}

export function readBotsConfig(env: Env = process.env): BotsConfig {
  const maxOnline = num(env, 'BOTS_MAX_ONLINE', 50, 1, 500);
  const minOnline = Math.min(maxOnline, num(env, 'BOTS_MIN_ONLINE', 3, 0, 500));
  return {
    enabled: flag(env, 'BOTS_ENABLED', false),
    minOnline,
    maxOnline,
    allowEvents: flag(env, 'BOTS_ALLOW_EVENTS', true),
    allow1v1: flag(env, 'BOTS_ALLOW_1V1', true),
    allowHuman1v1: flag(env, 'BOTS_ALLOW_HUMAN_1V1', true),
    inLeaderboard: flag(env, 'BOTS_IN_LEADERBOARD', true),
    poolSize: Math.max(maxOnline, num(env, 'BOTS_POOL_SIZE', maxOnline + 30, 1, 2000)),
    timeZone: String(env.BOTS_TIMEZONE || 'Europe/Madrid'),
    schedule: parseSchedule(env.BOTS_SCHEDULE),
    tickBudgetSeconds: num(env, 'BOTS_TICK_BUDGET_SECONDS', 50, 1, 290),
    leaseSeconds: 20,
    maxStepsPerTick: 40,
  };
}
