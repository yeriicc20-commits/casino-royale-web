/** La forma de config.json. Todo lo que se puede balancear sin tocar código. */

export type EventKind = 'streak' | 'jackpot' | 'chaos' | 'risk' | 'highroller' | 'royale' | 'treasure';

export interface Milestone { streak: number; points: number; label: string }

export interface Scoring {
  winPoints: number;
  lossPoints: number;
  /** Por debajo de esto (devuelto / apostado) una "victoria" no cuenta: ni suma ni rompe. */
  minWinMultiplier: number;
  bigMultiplier: number;
  bigMultiplierPoints: number;
  /** Victoria consecutiva: + streakStepPoints × (racha − 1). */
  streakStepPoints: number;
  breakOnLoss: boolean;
  milestones: Milestone[];
  streakMultiplierFrom?: number;
  streakMultiplier?: number;
}

export interface JackpotTier { id: string; name: string; chance: number; points: number; coinsCents: number }

export type ModifierType = 'points' | 'streak' | 'jackpot' | 'flat' | 'coins' | 'table';

export interface Modifier {
  id: string;
  fromMinute: number;
  toMinute: number;
  type: ModifierType;
  value: number;
  title: string;
  message: string;
  color: string;
  sound: string;
  fx: string;
}

export interface Surprise {
  count: number;
  durationSeconds: number;
  earliestMinute: number;
  latestMinute: number;
  pointsMultiplier: number;
  jackpotScale: number;
  title: string;
  message: string;
  color: string;
  sound: string;
  fx: string;
}

export interface Phase {
  id: string;
  name: string;
  banner: string;
  fromMinute: number;
  toMinute: number;
  pointsMultiplier: number;
  jackpotScale: number;
  featured: boolean;
  surprise: boolean;
  color: string;
}

export interface Featured {
  everyMinutes: number;
  count: number;
  pointsMultiplier: number;
  /** Solo hay mesas especiales mientras dura este modificador (Casino Caos). */
  onlyWithModifier?: string;
}

export type ObjectiveType = 'wins' | 'rounds' | 'streak' | 'jackpot' | 'games' | 'multiplier' | 'featuredWins' | 'points';

export interface Objective {
  id: string;
  type: ObjectiveType;
  target: number;
  points: number;
  label: string;
  /** Solo avanza durante esta fase (Casino Royale). */
  phase?: string;
}

export interface RiskStep { multiplier: number; chance: number }

export interface RiskConfig {
  steps: RiskStep[];
  shieldEveryStreak: number;
  maxShields: number;
  startShields: number;
  autoCashAtEnd: boolean;
}

export interface Perk { streakShields?: number; vip?: boolean }

export interface Unlock {
  id: string;
  minPoints?: number;
  maxRank?: number;
  label: string;
  detail: string;
  cosmetics: string[];
  perk: Perk;
}

export interface RewardTier {
  id: string;
  fromRank?: number;
  toRank?: number;
  participation?: boolean;
  minRounds?: number;
  label: string;
  coinsCents: number;
  cosmetics: string[];
}

export interface Chest { coinsCents: number; cosmeticsPool: string[]; duplicateCoinsCents: number }

export interface EventDef {
  name: string;
  kind: EventKind;
  tagline: string;
  description: string;
  rankBy: 'points' | 'banked';
  rankSorts?: string[];
  minStakeCents?: number;
  pointsMultiplier?: number;
  scoring: Scoring;
  jackpotScale: number;
  modifiers?: Modifier[];
  featured?: Featured;
  surprise?: Surprise;
  phases?: Phase[];
  risk?: RiskConfig;
  objectives?: Objective[];
  unlocks?: Unlock[];
  chest?: Chest;
  rewards: RewardTier[];
}

export interface EventsConfig {
  version: number;
  schedule: {
    timeZone: string;
    daily: { opens: string; closes: string };
    weekly: { weekday: number; opens: string; closes: string };
    submitGraceSeconds: number;
    claimAfterSeconds: number;
    claimWindowDays: number;
  };
  dailyByWeekday: Record<string, string>;
  weeklyEvent: string;
  machines: string[];
  machineNames: Record<string, string>;
  limits: {
    minStakeCents: number;
    maxRoundsPerReport: number;
    maxRoundsPerMinute: number;
    maxMultiplier: number;
    maxQueuedSeconds: number;
    modifierLookbackSeconds: number;
  };
  jackpotTiers: JackpotTier[];
  events: Record<string, EventDef>;
}

/** Una ronda tal y como la manda el juego. */
export interface RoundIn {
  /** Máquina. */
  g: string;
  /** Apuesta en céntimos. */
  s: number;
  /** Devuelto en céntimos (apuesta incluida). */
  r: number;
  /** Cuándo se jugó (ms UTC, hora del servidor según el juego). */
  t: number;
}

/** Lo que el servidor guarda de cada jugador en cada evento. */
export interface PlayerState {
  v: number;
  points: number;
  // Todo o Nada
  banked: number;
  potBase: number;
  potExtra: number;
  riskStep: number;
  shields: number;
  // Comunes
  streak: number;
  bestStreak: number;
  wins: number;
  losses: number;
  rounds: number;
  jackpots: number[];
  bestJackpot: number;
  bestMultiplier: number;
  games: string[];
  featuredWins: number;
  done: string[];
  chestClaimed: boolean;
  unlocked: string[];
  perks: { streakShields: number; vip: boolean; from: string[] };
  /** Lo que lleva en la fase actual (los desafíos de fase cuentan desde aquí). */
  ph: { id: string; wins: number; rounds: number; streak: number; bestStreak: number; jackpots: number; featuredWins: number; bestMultiplier: number };
  rate: { minute: number; n: number };
  ignored: number;
  /** Los últimos lotes aplicados: un lote repetido (reintento) no cuenta dos veces. */
  reports: string[];
}

export interface Feedback {
  type: string;
  title: string;
  detail: string;
  tier: number;
  points: number;
  color: string;
  sound: string;
  fx: string;
}

export interface CoinAward { claimId: string; cents: number; reason: string; cosmetics: string[]; perk?: Perk }
