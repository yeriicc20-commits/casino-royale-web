/** Tipos compartidos entre la web, la API y el panel. */

export type ReleaseChannel = 'production' | 'beta' | 'development';
export type ReleaseStatus = 'draft' | 'published' | 'archived';
export type UserRole = 'player' | 'admin';

/** Una versión publicada, tal y como está en la tabla `releases`. */
export interface Release {
  id: string;
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;

  major: number;
  minor: number;
  patch: number;

  title: string;
  summary: string;

  notes_added: string[];
  notes_fixed: string[];
  notes_changed: string[];
  notes_technical: string[];

  android_url: string | null;
  android_version_code: number | null;
  android_size_bytes: number | null;

  ios_store_url: string | null;

  windows_url: string | null;
  windows_size_bytes: number | null;

  released_at: string;
  created_at: string;
  updated_at: string;
}

/** El interruptor general de un canal. */
export interface AppConfig {
  channel: ReleaseChannel;
  latest_version: string;
  minimum_online_version: string;
  maintenance_mode: boolean;
  maintenance_message: string;
  ios_store_url: string | null;
  updated_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_index: number;
  role: UserRole;
  friend_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerStats {
  user_id: string;
  balance_cents: number;
  total_staked_cents: number;
  total_won_cents: number;
  rounds_played: number;
  biggest_win_cents: number;
  last_round_at: string | null;
  updated_at: string;
}

/**
 * Los estados con los que el juego decide qué puede hacer.
 *
 * Son cinco y no dos porque "no puedo conectar con el servidor" y "tu versión
 * está prohibida" tienen que llevar a mensajes distintos: el primero es un
 * problema de red y el segundo una acción que el jugador tiene que tomar.
 */
export type GameState =
  | 'UP_TO_DATE'
  | 'OPTIONAL_UPDATE'
  | 'UPDATE_REQUIRED'
  | 'SERVER_UNAVAILABLE'
  | 'MAINTENANCE';

/** Lo que devuelve GET /api/game/version. Es el contrato con Unity. */
export interface VersionResponse {
  state: GameState;

  latestVersion: string;
  minimumOnlineVersion: string;

  /** Cierto cuando la versión que preguntó no llega a la mínima del online. */
  updateRequired: boolean;
  /** Cierto cuando hay una versión más nueva pero la instalada aún vale. */
  updateAvailable: boolean;
  /** Cierto cuando esa versión puede usar el modo online ahora mismo. */
  onlineAllowed: boolean;

  maintenance: boolean;
  maintenanceMessage: string | null;

  androidDownloadUrl: string | null;
  androidVersionCode: number | null;
  androidSizeBytes: number | null;

  iosStoreUrl: string | null;

  windowsDownloadUrl: string | null;
  windowsSizeBytes: number | null;

  /** Notas de las versiones posteriores a la que preguntó, de más nueva a más antigua. */
  releaseNotes: ReleaseNote[];

  /** Hora del servidor, para que el cliente no dependa del reloj del teléfono. */
  serverTime: string;
}

export interface ReleaseNote {
  version: string;
  title: string;
  summary: string;
  releasedAt: string;
  added: string[];
  fixed: string[];
  changed: string[];
}

/** Respuesta cuando el servidor rechaza a un cliente por versión. */
export interface ClientRejectedResponse {
  error: 'CLIENT_UPDATE_REQUIRED' | 'MAINTENANCE' | 'AUTH_REQUIRED';
  message: string;
  minimumVersion?: string;
  latestVersion?: string;
}

// ---------------------------------------------------------------- panel

/** Una fila de `admin_players_overview`: un jugador del online, con su resumen. */
export interface AdminPlayer {
  player_id: string;
  name: string;
  avatar_id: number;
  friend_code: string | null;

  balance_cents: number;
  biggest_win_cents: number;
  rounds: number;
  last_seen: string;

  friends: number;

  /** Ajustes que el juego todavía no se ha llevado. */
  pending_grants: number;
  pending_cents: number;

  /** Cierto si tiene partida guardada en la nube. */
  has_save: boolean;
}

/** Un apunte de la cola de ajustes. */
export interface AdminGrant {
  id: number;
  player_id: string;
  amount_cents: number;
  reason: string;
  created_at: string;
  delivered_at: string | null;
}

/** Una cuenta de la web (Supabase Auth + su perfil). */
export interface WebAccount {
  id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  created_at: string;
  last_sign_in_at: string | null;
}
