import 'server-only';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Lo que comparten las ocho rutas que habla el juego.
 *
 * El contrato no me lo he inventado: sale de `BackendRoutes.cs`,
 * `SocialModels.cs` y `HttpBackendService.cs` del proyecto de Unity. Cada campo
 * de cada respuesta se llama exactamente como el campo que JsonUtility espera
 * rellenar, porque JsonUtility empareja por nombre y **deja en su valor por
 * defecto todo lo que no reconoce, sin avisar**. Un campo mal escrito aquí no
 * da error: da una lista de amigos vacía y una tarde de depuración.
 */

/** Segundos sin dar señales tras los cuales alguien deja de contar como conectado. */
export const ONLINE_WINDOW_SECONDS = 90;

/** Cuánta gente entra en una página de clasificación. */
export const LEADERBOARD_LIMIT = 50;

export const dynamic = 'force-dynamic';

export function db() {
  return createAdminClient();
}

/**
 * Respuesta JSON.
 *
 * Siempre 200 salvo que el juego distinga el código, porque
 * `HttpBackendService` trata cualquier 4xx/5xx como fallo de servidor y baja el
 * modo a Degraded. "Ese código no existe" no es un fallo del servidor: es una
 * respuesta perfectamente correcta que el juego tiene que poder enseñar.
 */
export function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function ok(message?: string) {
  return json({ ok: true, message: message ?? '' });
}

export function fail(message: string) {
  return json({ ok: false, message });
}

/** Lee el cuerpo sin dejar que un JSON roto tumbe la ruta. */
export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function text(value: unknown, max = 64): string {
  return String(value ?? '').trim().slice(0, max);
}

export function int(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Segundos desde que se vio por última vez a alguien. -1 si nunca. */
export function secondsSince(lastSeen: string | null): number {
  if (!lastSeen) return -1;

  const seen = new Date(lastSeen).getTime();
  if (!Number.isFinite(seen)) return -1;

  return Math.max(0, Math.floor((Date.now() - seen) / 1000));
}

export function isOnline(lastSeen: string | null): boolean {
  const seconds = secondsSince(lastSeen);
  return seconds >= 0 && seconds <= ONLINE_WINDOW_SECONDS;
}

/** Una fila de online_players, como la devuelve Supabase. */
export interface PlayerRow {
  player_id: string;
  name: string;
  avatar_id: number;
  friend_code: string | null;
  balance_cents: number;
  biggest_win_cents: number;
  rounds: number;
  last_seen: string;
  /** Cosméticos que lleva puestos (columnas de 14_pase_temporada.sql; pueden no existir aún). */
  title_id?: string | null;
  frame_id?: string | null;
}

/** Convierte una fila en la entrada de clasificación que espera el juego. */
export function toLeaderboardEntry(row: PlayerRow, rank: number) {
  return {
    rank,
    playerId: row.player_id,
    name: row.name,
    avatarId: row.avatar_id,
    valueCents: row.balance_cents,
    titleId: row.title_id ?? '',
    frameId: row.frame_id ?? '',
  };
}

/**
 * Quien llama, segun su sesion de Supabase.
 *
 * El juego manda su token en la cabecera Authorization, igual que el navegador.
 * Se comprueba SIEMPRE contra el servidor de autenticacion y nunca se cree lo
 * que venga en el cuerpo: el playerId que mandaba antes el cliente era una
 * cadena elegida por el propio movil, asi que cualquiera podia escribir la de
 * otro y publicar su saldo.
 *
 * Devuelve null si no hay sesion o si el token ya no vale.
 */
export async function currentUser(request: Request): Promise<{ id: string; email: string | null } | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) return null;

  try {
    const { data, error } = await db().auth.getUser(token);
    if (error || !data.user) return null;

    return { id: data.user.id, email: data.user.email ?? null };
  } catch (error) {
    console.error('[online.currentUser]', error);
    return null;
  }
}

/**
 * El identificador con el que este jugador existe en el online, que es el de su
 * cuenta.
 *
 * La primera vez adopta lo que tuviera el dispositivo -saldo, amigos, partida-
 * para que actualizar no cueste el progreso. Lo hace la base de datos en una
 * sola sentencia porque son cuatro tablas que tienen que moverse juntas.
 */
export async function claimIdentity(userId: string, deviceId?: string, name?: string): Promise<string> {
  const { data, error } = await db().rpc('online_claim_identity', {
    p_user: userId,
    p_device: deviceId ?? null,
    p_name: name ?? null,
  });

  if (error) {
    console.error('[online.claimIdentity]', error);
    return userId;
  }

  return String(data ?? userId);
}

/**
 * La respuesta a quien llama sin sesion.
 *
 * 401 y no 200: el juego distingue ese codigo y sabe que tiene que pedir la
 * cuenta, en vez de quedarse en "no hay conexion" con la wifi funcionando.
 */
export function needsAccount() {
  return json(
    { ok: false, error: 'AUTH_REQUIRED', message: 'Entra con tu cuenta para jugar en línea.' },
    401,
  );
}

export function corsPreflight() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Game-Version, X-Game-Platform',
    },
  });
}
