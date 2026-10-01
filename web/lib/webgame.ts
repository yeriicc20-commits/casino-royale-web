import info from './webgame.json';

/**
 * Version web del juego (Unity WebGL) servida en /jugar. La genera el menu de
 * Unity "Casino/Build/WebGL (iPhone y navegador)", que tambien reescribe
 * webgame.json. En iPhone se instala gratis con "Anadir a pantalla de inicio".
 */
export interface WebGame {
  available: boolean;
  version: string | null;
  builtAt: string | null;
  sizeBytes: number;
}

export const WEB_GAME: WebGame = {
  available: Boolean(info.available),
  version: (info.version as string | null) ?? null,
  builtAt: (info.builtAt as string | null) ?? null,
  sizeBytes: Number(info.sizeBytes) || 0,
};

export const WEB_GAME_PATH = '/jugar/';
