'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Las operaciones del panel sobre jugadores y cuentas.
 *
 * Todas empiezan por requireAdmin(). Una Server Action es un endpoint HTTP con
 * un nombre difícil de adivinar, y "difícil de adivinar" no es una medida de
 * seguridad: la comprobación va DENTRO de cada acción, y va con la sesión del
 * usuario, no con la clave de servicio. La clave de servicio solo entra después
 * de haber confirmado el rol, nunca antes.
 *
 * El dinero no se escribe aquí: se encola. El porqué está explicado en
 * `backend/09_panel_admin.sql`, y en una frase es que el saldo de verdad vive
 * dentro de un sobre firmado en el móvil del jugador, y reescribirlo desde el
 * servidor le rompe la partida.
 */

export type ActionResult<T = undefined> =
  | { ok: true; value?: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return profile?.role === 'admin' ? { id: user.id } : null;
}

function refresh() {
  revalidatePath('/admin/jugadores');
  revalidatePath('/admin');
}

/** Traduce los errores que levantan las funciones de la base de datos. */
function explain(error: { message?: string; code?: string } | null): string {
  const message = error?.message ?? '';

  if (message.includes('PLAYER_NOT_FOUND')) return 'Ese jugador ya no existe.';
  if (message.includes('NAME_TOO_SHORT')) return 'El nombre necesita al menos tres letras.';

  console.error('[players-actions]', error);
  return 'No se pudo completar la operación.';
}

// ------------------------------------------------------------------ dinero

/**
 * Da o quita dinero. En euros con decimales, porque es lo que se escribe en un
 * formulario; a céntimos enteros en cuanto cruza esta línea.
 */
export async function adjustPlayerMoney(
  playerId: string,
  euros: number,
  reason: string,
): Promise<ActionResult<number>> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  if (!Number.isFinite(euros) || euros === 0) {
    return { ok: false, error: 'Pon una cantidad distinta de cero.' };
  }

  // Un tope por operación. No protege de nada a un administrador decidido
  // -puede repetirla-, pero sí de un cero de más al teclear, que es el fallo
  // que de verdad ocurre.
  if (Math.abs(euros) > 10_000_000) {
    return { ok: false, error: 'Demasiado de una vez. Máximo 10.000.000 €.' };
  }

  const cents = Math.round(euros * 100);

  const { data, error } = await createAdminClient().rpc('admin_adjust_player', {
    p_player_id: playerId,
    p_amount_cents: cents,
    p_reason: reason.trim().slice(0, 140),
    p_actor: admin.id,
  });

  if (error) return { ok: false, error: explain(error) };

  refresh();
  return { ok: true, value: Number(data ?? 0) };
}

/** Deshace un apunte que el juego todavía no se ha llevado. */
export async function cancelGrant(grantId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  // `delivered_at is null` en el propio DELETE: si el juego se lo ha llevado
  // entre que se pintó la página y se pulsó el botón, no se borra nada y el
  // dinero ya está donde tiene que estar.
  const { error } = await createAdminClient()
    .from('online_grants')
    .delete()
    .eq('id', grantId)
    .is('delivered_at', null);

  if (error) return { ok: false, error: explain(error) };

  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ jugadores

export async function renamePlayer(playerId: string, name: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const { error } = await createAdminClient().rpc('admin_rename_player', {
    p_player_id: playerId,
    p_name: name,
    p_actor: admin.id,
  });

  if (error) return { ok: false, error: explain(error) };

  refresh();
  return { ok: true };
}

/**
 * Borra a un jugador del online.
 *
 * No borra su partida del móvil -ahí no llegamos- así que si vuelve a abrir el
 * juego con conexión reaparecerá con su saldo. Eso es correcto: esto es el
 * mando del online, no un castigo al dispositivo de nadie.
 */
export async function deletePlayer(playerId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const { error } = await createAdminClient().rpc('admin_delete_player', {
    p_player_id: playerId,
    p_actor: admin.id,
  });

  if (error) return { ok: false, error: explain(error) };

  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ cuentas web

/**
 * Borra una cuenta de la web entera: credenciales, perfil y partida en la nube.
 *
 * Va por auth.admin.deleteUser y no por un DELETE a profiles porque las
 * credenciales viven en auth.users, y borrar solo el perfil dejaría a alguien
 * pudiendo entrar a una cuenta sin fila en ninguna de nuestras tablas. Lo demás
 * cae solo: profiles, player_stats y game_saves cuelgan de auth.users con
 * `on delete cascade`.
 */
export async function deleteWebAccount(userId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  if (userId === admin.id) {
    return { ok: false, error: 'No puedes borrar tu propia cuenta desde aquí.' };
  }

  const supabase = createAdminClient();

  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    console.error('[deleteWebAccount]', error);
    return { ok: false, error: 'No se pudo borrar la cuenta.' };
  }

  await supabase.from('audit_log').insert({
    actor: admin.id,
    action: 'account.delete',
    target: userId,
    detail: {},
  });

  refresh();
  return { ok: true };
}

/** Da o quita el rol de administrador a una cuenta de la web. */
export async function setAccountRole(
  userId: string,
  role: 'player' | 'admin',
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  if (userId === admin.id && role === 'player') {
    return { ok: false, error: 'No puedes quitarte a ti mismo el permiso.' };
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);

  if (error) {
    console.error('[setAccountRole]', error);
    return { ok: false, error: 'No se pudo cambiar el rol.' };
  }

  await supabase.from('audit_log').insert({
    actor: admin.id,
    action: 'account.role',
    target: userId,
    detail: { role },
  });

  refresh();
  return { ok: true };
}
