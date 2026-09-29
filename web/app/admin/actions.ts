'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidVersion } from '@/lib/semver';
import type { ReleaseChannel, ReleaseStatus } from '@/lib/types';

/**
 * Operaciones del panel.
 *
 * Todas empiezan por requireAdmin(). Esconder el enlace al panel no protege
 * nada: una Server Action es un endpoint HTTP con un nombre difícil de
 * adivinar, y "difícil de adivinar" no es una medida de seguridad. La
 * comprobación tiene que estar dentro de cada acción, y está.
 *
 * La escritura se hace con la clave de servicio DESPUÉS de haber confirmado el
 * rol con la sesión del usuario. Nunca al revés.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

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

async function audit(actor: string, action: string, target: string, detail: unknown) {
  try {
    await createAdminClient()
      .from('audit_log')
      .insert({ actor, action, target, detail: detail as Record<string, unknown> });
  } catch (error) {
    // Un fallo al registrar no debe tumbar la operación que sí funcionó.
    console.error('[audit]', error);
  }
}

/** Convierte un textarea de una línea por punto en un array limpio. */
function toList(value: FormDataEntryValue | null): string[] {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toNumberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTextOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------- versiones

export async function saveRelease(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const version = String(formData.get('version') ?? '').trim();

  if (!isValidVersion(version)) {
    return { ok: false, error: 'La versión debe tener el formato 1.4.0.' };
  }

  const id = toTextOrNull(formData.get('id'));
  const channel = (String(formData.get('channel') ?? 'production') as ReleaseChannel);
  const status = (String(formData.get('status') ?? 'draft') as ReleaseStatus);

  const row = {
    version,
    channel,
    status,
    title: String(formData.get('title') ?? '').trim().slice(0, 120),
    summary: String(formData.get('summary') ?? '').trim().slice(0, 600),

    notes_added: toList(formData.get('notes_added')),
    notes_fixed: toList(formData.get('notes_fixed')),
    notes_changed: toList(formData.get('notes_changed')),
    notes_technical: toList(formData.get('notes_technical')),

    android_url: toTextOrNull(formData.get('android_url')),
    android_version_code: toNumberOrNull(formData.get('android_version_code')),
    android_size_bytes: toNumberOrNull(formData.get('android_size_bytes')),

    ios_store_url: toTextOrNull(formData.get('ios_store_url')),

    windows_url: toTextOrNull(formData.get('windows_url')),
    windows_size_bytes: toNumberOrNull(formData.get('windows_size_bytes')),

    released_at: toTextOrNull(formData.get('released_at')) ?? new Date().toISOString(),
  };

  const supabase = createAdminClient();

  const { error } = id
    ? await supabase.from('releases').update(row).eq('id', id)
    : await supabase.from('releases').insert(row);

  if (error) {
    console.error('[saveRelease]', error);

    return {
      ok: false,
      error: error.code === '23505'
        ? `Ya existe la versión ${version} en el canal ${channel}.`
        : 'No se pudo guardar. Revisa los datos.',
    };
  }

  await audit(admin.id, id ? 'release.update' : 'release.create', version, { channel, status });

  revalidatePath('/admin');
  revalidatePath('/updates');
  revalidatePath('/download');
  revalidatePath('/');

  return { ok: true };
}

export async function setReleaseStatus(id: string, status: ReleaseStatus): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const { error } = await createAdminClient()
    .from('releases')
    .update({ status })
    .eq('id', id);

  if (error) {
    console.error('[setReleaseStatus]', error);
    return { ok: false, error: 'No se pudo cambiar el estado.' };
  }

  await audit(admin.id, 'release.status', id, { status });

  revalidatePath('/admin');
  revalidatePath('/updates');
  revalidatePath('/');

  return { ok: true };
}

export async function deleteRelease(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const { error } = await createAdminClient().from('releases').delete().eq('id', id);

  if (error) {
    console.error('[deleteRelease]', error);
    return { ok: false, error: 'No se pudo borrar.' };
  }

  await audit(admin.id, 'release.delete', id, {});

  revalidatePath('/admin');
  revalidatePath('/updates');

  return { ok: true };
}

// ------------------------------------------------------------ configuración

export async function saveConfig(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'No tienes permiso.' };

  const channel = (String(formData.get('channel') ?? 'production') as ReleaseChannel);
  const latest = String(formData.get('latest_version') ?? '').trim();
  const minimum = String(formData.get('minimum_online_version') ?? '').trim();

  if (!isValidVersion(latest) || !isValidVersion(minimum)) {
    return { ok: false, error: 'Las versiones deben tener el formato 1.4.0.' };
  }

  const row = {
    latest_version: latest,
    minimum_online_version: minimum,
    maintenance_mode: formData.get('maintenance_mode') === 'on',
    maintenance_message:
      String(formData.get('maintenance_message') ?? '').trim() ||
      'El modo online está temporalmente en mantenimiento.',
    ios_store_url: toTextOrNull(formData.get('ios_store_url')),
  };

  const { error } = await createAdminClient()
    .from('app_config')
    .update(row)
    .eq('channel', channel);

  if (error) {
    console.error('[saveConfig]', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }

  await audit(admin.id, 'config.update', channel, row);

  // Subir minimum_online_version deja fuera del online a todo el que no llegue.
  // Se registra en el log precisamente porque es la acción con más alcance de
  // todo el panel.
  revalidatePath('/admin');
  revalidatePath('/');

  return { ok: true };
}
