/** La forma de config.json del competitivo. */

export interface TierDef {
  id: string;
  name: string;
  from: number;
  step: number;
  divisions: number;
  lossFactor: number;
  winFactor: number;
}

export interface GameDef {
  id: string;
  name: string;
  machine: string;
  kind: 'roulette' | 'blackjack' | 'dice' | 'poker';
  rounds: number;
  startStack: number;
  minBet: number;
  decisionSeconds: number;
  playSeconds: number;
  revealSeconds: number;
}

export interface RewardPack { coinsCents: number; cosmetics: string[] }

export interface CompetitiveConfig {
  version: number;
  tiers: TierDef[];
  points: {
    winMin: number; winMax: number; lossMin: number; lossMax: number; draw: number;
    streakFrom: number; streakBonus: number; streakBonusMax: number; abandonExtra: number;
    promotionProtection: { enabled: boolean; matches: number };
    floor: number;
  };
  mmr: { start: number; kProvisional: number; provisionalGames: number; k: number; min: number };
  matchmaking: {
    windows: { afterSeconds: number; mmr: number }[];
    casualWindowMmr: number;
    maxSearchSeconds: number;
    ticketStaleSeconds: number;
    avoidRecentOpponentMinutes: number;
    avoidRecentUntilSeconds: number;
  };
  antiAbuse: { pairRatedPerDay: number; maxRatedGapMmr: number; rewardedMatchesPerDay: number };
  abandon: { missesToAbandon: number; windowHours: number; freeAbandons: number; banMinutes: number; banGrowth: number; banMaxMinutes: number };
  rewards: Record<'competitive' | 'casual', { winCents: number; lossCents: number; drawCents: number; winXp: number; lossXp: number; drawXp: number }>;
  rankRewards: ({ tier: string; label: string } & RewardPack)[];
  seasons: {
    list: { number: number; name: string; start: string; days: number }[];
    defaultDays: number;
    defaultName: string;
    reset: { pivot: number; keep: number };
    mmrReset: { pivot: number; keep: number };
    rewards: ({ minTier: string } & RewardPack)[];
    participationMatches: number;
    participation: RewardPack;
    topRewards: ({ maxRank: number } & RewardPack)[];
  };
  games: GameDef[];
  ready: { seconds: number };
  leaderboardLimit: number;
}

export type Side = 'a' | 'b';
export type Mode = 'competitive' | 'casual';

/** Una apuesta de una ronda. */
export interface Bet {
  amount: number;
  /** Ruleta: red, black, even, odd, low, high, dozen1..3, col1..3, number. */
  type?: string;
  number?: number;
  /** Dados: probabilidad elegida (5..95): gana si la tirada (0..99,99) es menor. */
  chance?: number;
}

export interface BjHand { cards: string[]; done: boolean; doubled: boolean }

export interface RoundLog {
  round: number;
  outcome: string;
  a: { bet: number; delta: number; detail: string };
  b: { bet: number; delta: number; detail: string };
  cards?: { dealer: string[]; a: string[]; b: string[]; board?: string[] };
  bets?: { a: Bet | null; b: Bet | null };
}

/** Todo lo de una partida. Lo guarda el servidor; cada jugador ve solo lo que le toca. */
export interface MatchState {
  v: number;
  game: string;
  mode: Mode;
  phase: 'ready' | 'bet' | 'play' | 'done';
  round: number;
  rounds: number;
  stacks: { a: number; b: number };
  deadline: number;
  revealUntil: number;
  ready: { a: boolean; b: boolean };
  bets: { a: Bet | null; b: Bet | null };
  misses: { a: number; b: number };
  seen: { a: number; b: number };
  bj: { dealer: string[]; pile: string[]; dealerPile: string[]; hands: { a: BjHand; b: BjHand }; draws: { a: number; b: number } } | null;
  /** Póker cara a cara: cartas de cada uno, las 5 de la mesa y lo que decide cada uno. */
  pk?: { hole: { a: string[]; b: string[] }; board: string[]; choice: { a: string; b: string } } | null;
  history: RoundLog[];
  startedAt: number;
  endedAt: number;
  result: '' | 'a' | 'b' | 'draw' | 'void';
  abandon: '' | Side | 'both';
}
