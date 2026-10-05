/**
 * Azar para los bots. Todo lo que decide un bot recibe el generador como
 * parámetro: en producción es criptográfico y en las pruebas es una semilla
 * fija, así que cada decisión se puede reproducir.
 */
import { randomBytes } from 'node:crypto';

export type Rng = () => number;

/** [0,1) con el generador criptográfico. */
export const cryptoRng: Rng = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

/** Generador con semilla (mulberry32). Solo para pruebas y simulaciones. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.min(max - min, Math.floor(rng() * (max - min + 1)));
}

export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** Elige con pesos. Los pesos <= 0 no salen nunca. */
export function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of entries) if (w > 0) total += w;
  if (total <= 0) return entries[0][0];
  let x = rng() * total;
  for (const [v, w] of entries) {
    if (w <= 0) continue;
    x -= w;
    if (x < 0) return v;
  }
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i][1] > 0) return entries[i][0];
  return entries[0][0];
}

/** Normal estándar (Box-Muller). */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Log-normal alrededor de una mediana. Es la forma de los tiempos humanos: la
 * mayoría cerca de lo normal y alguno mucho más largo (nunca negativo).
 */
export function logNormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(sigma * gaussian(rng));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** Retardo humano en ms: mediana en segundos, dispersión y límites. Nunca un número redondo. */
export function humanDelayMs(rng: Rng, medianSeconds: number, sigma: number, minSeconds: number, maxSeconds: number): number {
  const s = clamp(logNormal(rng, medianSeconds, sigma), minSeconds, maxSeconds);
  return Math.round(s * 1000 + rng() * 997);
}

/** Un identificador corto y aleatorio (dueño del turno, lotes de eventos...). */
export function randomId(rng: Rng = cryptoRng, length = 12): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += abc[Math.floor(rng() * abc.length)];
  return out;
}
