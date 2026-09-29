import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { compareVersions, isAtLeast, isNewer } from '@/lib/semver';
import type {
  AppConfig,
  GameState,
  Release,
  ReleaseChannel,
  ReleaseNote,
  VersionResponse,
} from '@/lib/types';

/**
 * Resuelve en qué situación está una versión concreta del juego.
 *
 * Todo lo que decide sale de la base de datos; lo único que aporta el cliente
 * es qué versión dice tener, y eso solo sirve para elegir el mensaje. La
 * respuesta a "¿puede jugar online?" la calcula el servidor y la vuelve a
 * comprobar en cada petición protegida, así que decir una versión falsa no
 * abre ninguna puerta: como mucho hace que el juego no avise de que hay que
 * actualizar, y el servidor rechazará la conexión igualmente.
 */
export async function resolveVersionState(
  clientVersion: string | null,
  channel: ReleaseChannel = 'production',
): Promise<VersionResponse> {
  // Se usa la clave de servicio para poder leer también lo que RLS esconde
  // (borradores) y decidir con la foto completa. Lo que sale de esta función
  // ya está filtrado a lo que es público.
  const supabase = createAdminClient();

  const [{ data: configRow }, { data: releaseRows }] = await Promise.all([
    supabase.from('app_config').select('*').eq('channel', channel).maybeSingle(),
    supabase
      .from('releases')
      .select('*')
      .eq('channel', channel)
      .eq('status', 'published')
      .order('major', { ascending: false })
      .order('minor', { ascending: false })
      .order('patch', { ascending: false })
      .limit(50),
  ]);

  const config = configRow as AppConfig | null;
  const releases = (releaseRows ?? []) as Release[];

  // Sin configuración no se inventa nada permisivo: se responde que el servidor
  // no está disponible, que deja el juego en modo offline en lugar de abrir el
  // online por accidente.
  if (!config) {
    return unavailable();
  }

  const latestVersion = config.latest_version;
  const minimumOnlineVersion = config.minimum_online_version;

  // La versión publicada más alta manda sobre lo que diga app_config, por si
  // alguien publica una versión y olvida mover el interruptor.
  const newest = releases[0];
  const effectiveLatest =
    newest && isNewer(newest.version, latestVersion) ? newest.version : latestVersion;

  const current = clientVersion?.trim() || null;

  const meetsMinimum = current ? isAtLeast(current, minimumOnlineVersion) : false;
  const hasNewer = current ? isNewer(effectiveLatest, current) : true;

  const maintenance = config.maintenance_mode;
  const onlineAllowed = Boolean(current) && meetsMinimum && !maintenance;

  const state: GameState = maintenance
    ? 'MAINTENANCE'
    : !current
      ? 'SERVER_UNAVAILABLE'
      : !meetsMinimum
        ? 'UPDATE_REQUIRED'
        : hasNewer
          ? 'OPTIONAL_UPDATE'
          : 'UP_TO_DATE';

  // De dónde se baja: de la versión publicada más alta que tenga enlace. Así
  // una versión antigua sin binario no deja al jugador sin sitio del que
  // descargar.
  const androidSource = releases.find((r) => r.android_url) ?? null;
  const windowsSource = releases.find((r) => r.windows_url) ?? null;

  return {
    state,

    latestVersion: effectiveLatest,
    minimumOnlineVersion,

    updateRequired: Boolean(current) && !meetsMinimum,
    updateAvailable: Boolean(current) && hasNewer,
    onlineAllowed,

    maintenance,
    maintenanceMessage: maintenance ? config.maintenance_message : null,

    androidDownloadUrl: androidSource?.android_url ?? null,
    androidVersionCode: androidSource?.android_version_code ?? null,
    androidSizeBytes: androidSource?.android_size_bytes ?? null,

    iosStoreUrl: config.ios_store_url ?? releases.find((r) => r.ios_store_url)?.ios_store_url ?? null,

    windowsDownloadUrl: windowsSource?.windows_url ?? null,
    windowsSizeBytes: windowsSource?.windows_size_bytes ?? null,

    // Solo lo que el jugador todavía no tiene. Enseñarle novedades de versiones
    // que ya tenía instaladas convierte la pantalla de "qué hay de nuevo" en
    // ruido.
    releaseNotes: releases
      .filter((r) => !current || compareVersions(r.version, current) > 0)
      .slice(0, 10)
      .map(toNote),

    serverTime: new Date().toISOString(),
  };
}

function toNote(release: Release): ReleaseNote {
  return {
    version: release.version,
    title: release.title,
    summary: release.summary,
    releasedAt: release.released_at,
    added: asList(release.notes_added),
    fixed: asList(release.notes_fixed),
    changed: asList(release.notes_changed),
  };
}

/** jsonb llega como array, pero una fila escrita a mano puede traer cualquier cosa. */
function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function unavailable(): VersionResponse {
  return {
    state: 'SERVER_UNAVAILABLE',
    latestVersion: '0.0.0',
    minimumOnlineVersion: '0.0.0',
    updateRequired: false,
    updateAvailable: false,
    onlineAllowed: false,
    maintenance: false,
    maintenanceMessage: null,
    androidDownloadUrl: null,
    androidVersionCode: null,
    androidSizeBytes: null,
    iosStoreUrl: null,
    windowsDownloadUrl: null,
    windowsSizeBytes: null,
    releaseNotes: [],
    serverTime: new Date().toISOString(),
  };
}

/**
 * Portero del modo online, para usar desde cualquier ruta protegida.
 *
 * Devuelve null cuando el cliente puede pasar, o el objeto de error que hay que
 * responder cuando no. Esta es la comprobación que de verdad protege: el
 * diálogo que enseña Unity se lo puede saltar cualquiera que modifique el
 * cliente, esto no.
 */
export async function guardOnlineAccess(
  request: Request,
  channel: ReleaseChannel = 'production',
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const clientVersion = request.headers.get('X-Game-Version');
  const state = await resolveVersionState(clientVersion, channel);

  if (state.maintenance) {
    return {
      status: 503,
      body: {
        error: 'MAINTENANCE',
        message: state.maintenanceMessage,
      },
    };
  }

  if (!clientVersion) {
    return {
      status: 400,
      body: {
        error: 'CLIENT_UPDATE_REQUIRED',
        message: 'La petición no indica la versión del juego.',
        minimumVersion: state.minimumOnlineVersion,
        latestVersion: state.latestVersion,
      },
    };
  }

  if (!state.onlineAllowed) {
    return {
      status: 426, // Upgrade Required
      body: {
        error: 'CLIENT_UPDATE_REQUIRED',
        message: 'Para usar las funciones online necesitas actualizar el juego.',
        minimumVersion: state.minimumOnlineVersion,
        latestVersion: state.latestVersion,
      },
    };
  }

  return null;
}
