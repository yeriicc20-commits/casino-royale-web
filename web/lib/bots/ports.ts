/**
 * Todo lo que el gestor de bots puede hacer en el mundo, en una interfaz.
 *
 * La implementación de verdad (supabase-ports.ts) llama a los MISMOS servicios
 * que las rutas del juego: searchStep y mutateMatch del competitivo,
 * respondDuel / actDuel de los retos, reportRounds / claimReward de los
 * eventos, la cola de ajustes (online_grant_claim) y online_players para la
 * presencia. Las pruebas usan otra en memoria con las mismas garantías.
 *
 * El gestor (manager.ts) no sabe nada de la base de datos: solo decide.
 */
import type { GameDef, MatchState, Side } from '../competitive/types';
import type { RoundIn } from '../events/types';
import type { MatchMove } from './strategy';
import type { Bot, QueueMode, Runtime, World } from './types';

export interface MatchSnapshot {
  matchId: string;
  side: Side;
  def: GameDef;
  /** Ya puesta al día con el reloj (solo para mirar: no se guarda). */
  state: MatchState;
  status: 'live' | 'done';
  settled: boolean;
  /** Cómo le fue a este bot, cuando ya está liquidada. */
  outcome: '' | 'win' | 'loss' | 'draw' | 'void';
}

export interface DuelSnapshot {
  id: string;
  status: string;
  role: 'challenger' | 'opponent';
  stakeCents: number;
  myCards: string[];
  myDone: boolean;
  outcome: '' | 'win' | 'lose' | 'push';
}

export type SearchResult = { kind: 'match'; matchId: string } | { kind: 'searching' } | { kind: 'stop'; reason: string };

export interface EventReport { counted: number; pot: number; canChest: boolean }

export interface BotPorts {
  // ---- turno y estado propio
  lease(owner: string, seconds: number): Promise<boolean>;
  release(owner: string): Promise<void>;
  loadRuntime(): Promise<Runtime>;
  saveRuntime(rt: Runtime): Promise<void>;
  loadBots(): Promise<Bot[]>;
  /** Guarda si nadie lo ha cambiado (versión). Sube bot.version si guarda. */
  saveBot(bot: Bot): Promise<boolean>;
  insertBot(bot: Bot): Promise<boolean>;
  /** Nombres en uso (cuentas, jugadores y bots), en minúsculas. */
  takenNames(): Promise<Set<string>>;

  // ---- presencia y dinero
  /** Publica en online_players (conectados: con hora; desconectados: sin máquina). */
  publish(bots: Bot[], nowMs: number): Promise<void>;
  /** Recoge sus apuntes de la cola de ajustes. Devuelve la suma en céntimos. */
  claimGrants(botId: string): Promise<number>;
  world(botIds: string[], nowMs: number): Promise<World & { pendingGrants: string[] }>;

  // ---- 1 contra 1
  search(botId: string, gameId: string, mode: QueueMode): Promise<SearchResult>;
  cancelSearch(botId: string): Promise<void>;
  pairWith(botId: string, targetId: string, gameId: string, mode: QueueMode): Promise<string | null>;
  activeMatch(botId: string): Promise<string | null>;
  readMatch(botId: string, matchId: string, nowMs: number): Promise<MatchSnapshot | null>;
  /** Aplica una jugada (o nada: solo pone el reloj al día y liquida si toca). */
  applyMatch(botId: string, matchId: string, move: MatchMove | 'forfeit' | null): Promise<MatchSnapshot | null>;

  // ---- retos de blackjack entre amigos
  friendsOf(botId: string): Promise<string[]>;
  befriend(botId: string, otherId: string): Promise<boolean>;
  createDuel(botId: string, friendId: string, stakeCents: number): Promise<boolean>;
  respondDuel(botId: string, duelId: string, accept: boolean): Promise<boolean>;
  actDuel(botId: string, duelId: string, action: 'hit' | 'stand'): Promise<boolean>;
  duel(botId: string, duelId: string): Promise<DuelSnapshot | null>;

  // ---- eventos
  reportEvent(botId: string, instanceId: string, reportId: string, rounds: RoundIn[]): Promise<EventReport | null>;
  eventRisk(botId: string, instanceId: string, op: 'risk' | 'cash'): Promise<boolean>;
  eventChest(botId: string, instanceId: string): Promise<boolean>;
  /** Recoge los premios de eventos ya cerrados. Devuelve cuántos. */
  claimEvents(botId: string, nowMs: number): Promise<number>;
}
