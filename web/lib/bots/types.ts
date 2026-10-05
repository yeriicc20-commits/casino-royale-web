/** Tipos compartidos del sistema de bots. Sin dependencias de servidor: se usan en pruebas. */
import type { BotProgress } from './meta';

export const BOT_STATES = [
  'OFFLINE', 'IDLE', 'BROWSING', 'BETTING', 'PLAYING', 'EVENT', 'LOOKING_FOR_DUEL', 'IN_DUEL', 'COOLDOWN',
] as const;
export type BotState = (typeof BOT_STATES)[number];

export const PERSONALITIES = [
  'CASUAL', 'ACTIVE', 'HIGH_ROLLER', 'LOW_RISK', 'EVENT_PLAYER', 'DUEL_PLAYER', 'MIXED',
] as const;
export type Personality = (typeof PERSONALITIES)[number];

export type QueueMode = 'casual' | 'competitive';

/** Lo que el bot está haciendo ahora mismo. Se guarda en online_bots.activity. */
export interface BotActivity {
  kind?: 'machine' | 'event' | 'queue' | 'match' | 'duel' | 'consider_ticket' | 'consider_duel';
  /** Máquina (slots, roulette...) o juego del 1v1 (roulette, blackjack, dice, poker). */
  game?: string;
  mode?: QueueMode;
  stakeCents?: number;
  roundsLeft?: number;
  /** Ms en que empezó. */
  since?: number;
  /** Ms en que se rinde (buscar rival, pensar). */
  until?: number;
  matchId?: string;
  duelId?: string;
  /** Persona que busca rival y que el bot está considerando. */
  target?: string;
  ticketKey?: string;
  instanceId?: string;
  /** "fase:ronda" de la partida para la que ya tiene decidido cuándo actuar. */
  phaseKey?: string;
  actAt?: number;
  /** Estado al que vuelve después de una tarea corta (responder un reto). */
  resume?: BotState;
}

export interface BotStats {
  sessions: number;
  roundsPlayed: number;
  wageredCents: number;
  wonCents: number;
  matches: number;
  matchWins: number;
  duels: number;
  duelWins: number;
  eventsJoined: number;
  /** Ruletas, regalos, misiones y niveles del pase cobrados. */
  bonuses: number;
  passesBought: number;
  accepted: number;
  declined: number;
  lastEventClaimAt: number;
}

export function emptyStats(): BotStats {
  return {
    sessions: 0, roundsPlayed: 0, wageredCents: 0, wonCents: 0, matches: 0, matchWins: 0,
    duels: 0, duelWins: 0, eventsJoined: 0, bonuses: 0, passesBought: 0, accepted: 0, declined: 0, lastEventClaimAt: 0,
  };
}

/** Un bot en memoria. Las horas van en ms (0 = nunca). */
export interface Bot {
  id: string;
  username: string;
  personality: Personality;
  state: BotState;
  walletCents: number;
  rounds: number;
  biggestWinCents: number;
  avatarId: number;
  friendCode: string;
  platform: string;
  rhythm: number;
  onlineSince: number;
  sessionEndsAt: number;
  nextOnlineAt: number;
  nextActionAt: number;
  lastHeartbeatAt: number;
  lastBonusAt: number;
  activity: BotActivity;
  stats: BotStats;
  /** Ruleta, regalo, misiones, pase y cosméticos (online_bots.progress). */
  progress: BotProgress;
  version: number;
}

/** Una persona buscando rival en la cola del 1v1. */
export interface HumanTicket {
  playerId: string;
  gameId: string;
  mode: QueueMode;
  mmr: number;
  joinedAt: number;
}

/** Un reto de blackjack abierto en el que participa algún bot. */
export interface OpenDuel {
  id: string;
  challengerId: string;
  opponentId: string;
  stakeCents: number;
  status: 'pending' | 'active';
  challengerCards: string[];
  opponentCards: string[];
  challengerDone: boolean;
  opponentDone: boolean;
  updatedAt: number;
}

/** Lo que los bots saben del mundo en cada vuelta (una consulta de cada cosa). */
export interface World {
  humansOnline: number;
  humanTickets: HumanTicket[];
  openDuels: OpenDuel[];
  /** Partidas del 1v1 en curso de cada bot (para volver a ellas pase lo que pase). */
  liveMatches: { botId: string; matchId: string; gameId: string }[];
}

/** Estado del gestor que sobrevive a reinicios (online_bot_runtime.state). */
export interface Runtime {
  /** Cuántos bots se quieren conectados ahora (sube y baja poco a poco). */
  target: number;
  /** Hacia dónde camina `target`. */
  goal: number;
  goalUntil: number;
  nextStepAt: number;
  nextJoinAt: number;
  nextLeaveAt: number;
  /** Desafíos humanos ya considerados: "jugador@llegada" -> intentos. */
  tickets: Record<string, { tries: number; nextAt: number }>;
  /** Acciones por minuto (minuto -> número), las últimas diez. */
  actions: Record<string, number>;
  lastTickAt: number;
}

export function emptyRuntime(): Runtime {
  return { target: 0, goal: 0, goalUntil: 0, nextStepAt: 0, nextJoinAt: 0, nextLeaveAt: 0, tickets: {}, actions: {}, lastTickAt: 0 };
}
