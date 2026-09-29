/**
 * Comparación semántica de versiones.
 *
 * Existe porque comparar versiones como texto está mal y falla justo cuando el
 * proyecto empieza a ir en serio: `"1.10.0" < "1.2.0"` es cierto para una
 * comparación de cadenas, porque "1" va antes que "2" carácter a carácter. La
 * décima versión menor se consideraría anterior a la segunda y el juego dejaría
 * de pedir la actualización precisamente a quien más la necesita.
 *
 * La misma lógica está escrita tres veces a propósito —aquí, en
 * `compare_versions()` dentro de PostgreSQL y en `GameVersion.cs` en Unity—
 * porque cada una de las tres tiene que poder decidir por su cuenta, sin
 * preguntar a las otras. La de Postgres es la que manda.
 */

/** Divide "1.4.2" en [1, 4, 2]. Tolera sufijos como "1.4.2-beta". */
export function parseVersion(version: string): number[] {
  const cleaned = String(version ?? '')
    .trim()
    .split(/[-+]/)[0]          // descarta "-beta", "+build"
    .replace(/[^0-9.]/g, '');

  if (!cleaned) return [0];

  return cleaned.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

/**
 * Devuelve -1 si a < b, 0 si son la misma y 1 si a > b.
 *
 * Las versiones de distinta longitud se comparan rellenando con ceros, así que
 * "1.4" y "1.4.0" son la misma versión, que es lo que espera cualquiera.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;

    if (x > y) return 1;
    if (x < y) return -1;
  }

  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function isAtLeast(candidate: string, minimum: string): boolean {
  return compareVersions(candidate, minimum) >= 0;
}

/** Comprueba el formato antes de guardar. El panel lo usa para no aceptar basura. */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(String(version ?? '').trim());
}

/** Ordena versiones de más nueva a más antigua. */
export function sortByVersionDesc<T extends { version: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => compareVersions(b.version, a.version));
}
