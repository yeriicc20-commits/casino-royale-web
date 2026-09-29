import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_CONFIG } from '@/lib/config';
import type { AppConfig, Release } from '@/lib/types';

/**
 * Lecturas que hacen las páginas del sitio.
 *
 * Todas devuelven un valor utilizable aunque la base de datos no responda. Una
 * web de descargas que enseña una pantalla de error porque el backend está
 * dormido es peor que una que enseña "todavía no hay versiones publicadas": lo
 * primero parece rota, lo segundo parece nueva.
 */

const channel = PUBLIC_CONFIG.CHANNEL;

export async function getPublishedReleases(): Promise<Release[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('releases')
      .select('*')
      .eq('channel', channel)
      .eq('status', 'published')
      .order('major', { ascending: false })
      .order('minor', { ascending: false })
      .order('patch', { ascending: false });

    if (error) throw error;
    return (data ?? []) as Release[];
  } catch (error) {
    console.error('[queries.getPublishedReleases]', error);
    return [];
  }
}

export async function getRelease(version: string): Promise<Release | null> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('releases')
      .select('*')
      .eq('channel', channel)
      .eq('status', 'published')
      .eq('version', version)
      .maybeSingle();

    if (error) throw error;
    return (data as Release) ?? null;
  } catch (error) {
    console.error('[queries.getRelease]', error);
    return null;
  }
}

export async function getAppConfig(): Promise<AppConfig | null> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('app_config')
      .select('*')
      .eq('channel', channel)
      .maybeSingle();

    if (error) throw error;
    return (data as AppConfig) ?? null;
  } catch (error) {
    console.error('[queries.getAppConfig]', error);
    return null;
  }
}

/** La versión más reciente que trae binario para una plataforma. */
export function latestWith(
  releases: Release[],
  platform: 'android' | 'windows',
): Release | null {
  const key = platform === 'android' ? 'android_url' : 'windows_url';
  return releases.find((release) => Boolean(release[key])) ?? null;
}
