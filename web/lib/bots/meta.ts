/**
 * La "vida fuera de las máquinas" de un bot: lo mismo que hace una persona en
 * la barra de abajo del casino.
 *
 *   - ruleta diaria y regalo diario (con su racha de 7 días que se reinicia si
 *     falla un día)
 *   - tres misiones al día del catálogo del juego (rondas, victorias,
 *     apostado, devuelto, rondas en una máquina), que pagan euros y XP
 *   - el pase de temporada: XP por ronda con sus topes, 100 niveles con sus
 *     premios gratis, y el PREMIUM (2.500 €) que el bot compra si le compensa
 *   - cosméticos ganados, y el título / marco / avatar que se pone (salen en
 *     la clasificación por las columnas title_id y frame_id de siempre)
 *
 * En una persona todo esto vive en la partida del móvil. En un bot vive en
 * online_bots.progress, y las cifras salen de los assets de Unity
 * (meta.json, generado a partir de ellos): no hay premios inventados.
 *
 * Funciones puras: reciben el progreso y devuelven lo ganado.
 */
import { spainParts } from '../events/schedule';
import rawMeta from './meta.json';
import type { PersonalityDef } from './personalities';
import { chance, pick, weighted, type Rng } from './random';

interface RewardSide { coins: number; xp: number; cosmetics: string[] }
interface MetaData {
  pass: {
    seasonOneStartUtc: string; seasonDays: number; maxLevel: number; xpPerLevel: number;
    roundXpBase: number; roundXpPerEuro: number; roundXpMax: number; roundXpPerDay: number;
    firstRoundOfDayXp: number; missionXp: number; premiumPriceEuros: number;
    levels: { level: number; free: RewardSide; premium: RewardSide }[];
  };
  wheel: { euros: number; weight: number }[];
  gift: number[];
  giftRestartOnMiss: boolean;
  missions: { id: string; metric: 'rounds' | 'wins' | 'wagered' | 'returned'; machineId: string; target: number; rewardEuros: number }[];
  dailyMissions: number;
}

export const META = rawMeta as unknown as MetaData;
export const PREMIUM_PRICE_CENTS = Math.round(META.pass.premiumPriceEuros * 100);

export interface MissionState { id: string; progress: number; done: boolean }

export interface BotProgress {
  /** Día (hora de España) de las misiones y los topes de XP. */
  day: string;
  wheelDay: string;
  giftDay: string;
  /** Día del regalo que tocó la última vez (0..6). */
  giftStreak: number;
  missions: MissionState[];
  passSeason: number;
  passXp: number;
  passLevel: number;
  premium: boolean;
  roundXpToday: number;
  firstRoundDay: string;
  cosmetics: string[];
  titleId: string;
  frameId: string;
}

export function emptyProgress(): BotProgress {
  return {
    day: '', wheelDay: '', giftDay: '', giftStreak: -1, missions: [], passSeason: 0, passXp: 0, passLevel: 0,
    premium: false, roundXpToday: 0, firstRoundDay: '', cosmetics: [], titleId: '', frameId: '',
  };
}

/** Completa un progreso guardado (campos nuevos a su valor por defecto). */
export function loadProgress(raw: unknown): BotProgress {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...(raw as Partial<BotProgress>) };
  p.missions = Array.isArray(p.missions) ? p.missions : [];
  p.cosmetics = Array.isArray(p.cosmetics) ? p.cosmetics.map(String) : [];
  return p;
}

function pad(n: number) { return n < 10 ? '0' + n : String(n); }

export function dayKey(nowMs: number): string {
  const p = spainParts(nowMs);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

/** Temporada del pase (la misma cuenta que BattlePassConfig.SeasonAt). */
export function passSeasonAt(nowMs: number): number {
  const start = Date.parse(META.pass.seasonOneStartUtc);
  const days = (nowMs - start) / 86_400_000;
  return Math.max(1, Math.floor(days / Math.max(1, META.pass.seasonDays)) + 1);
}

export interface MetaGain {
  /** Céntimos que entran en el monedero. */
  cents: number;
  cosmetics: string[];
  notes: string[];
}

function gain(): MetaGain { return { cents: 0, cosmetics: [], notes: [] }; }

function addCosmetics(p: BotProgress, list: string[], out: MetaGain) {
  for (const c of list) if (c && !p.cosmetics.includes(c)) { p.cosmetics.push(c); out.cosmetics.push(c); }
}

/** Sube XP del pase y cobra los niveles que se pasen (gratis y, si lo tiene, premium). */
function addPassXp(p: BotProgress, xp: number, out: MetaGain) {
  const P = META.pass;
  p.passXp += Math.max(0, Math.floor(xp));
  const level = Math.min(P.maxLevel, Math.floor(p.passXp / P.xpPerLevel));
  while (p.passLevel < level) {
    p.passLevel++;
    const lv = P.levels.find((l) => l.level === p.passLevel);
    if (!lv) continue;
    out.cents += lv.free.coins * 100;
    addCosmetics(p, lv.free.cosmetics, out);
    if (p.premium) {
      out.cents += lv.premium.coins * 100;
      addCosmetics(p, lv.premium.cosmetics, out);
    }
    out.notes.push('Pase nivel ' + p.passLevel);
  }
}

/**
 * Lo que cambia al empezar un día o una temporada: misiones nuevas, topes de XP
 * a cero, y el pase reiniciado si ha empezado temporada (los cosméticos se quedan).
 */
export function rollDay(p: BotProgress, rng: Rng, nowMs: number) {
  const season = passSeasonAt(nowMs);
  if (p.passSeason !== season) {
    p.passSeason = season;
    p.passXp = 0;
    p.passLevel = 0;
    p.premium = false;
  }
  const today = dayKey(nowMs);
  if (p.day === today) return;
  p.day = today;
  p.roundXpToday = 0;
  const pool = [...META.missions];
  const chosen: MissionState[] = [];
  while (chosen.length < META.dailyMissions && pool.length) {
    const i = Math.floor(rng() * pool.length);
    chosen.push({ id: pool[i].id, progress: 0, done: false });
    pool.splice(i, 1);
  }
  p.missions = chosen;
}

/** Ruleta diaria (una vez al día). */
export function spinWheel(p: BotProgress, rng: Rng, nowMs: number): MetaGain {
  const out = gain();
  const today = dayKey(nowMs);
  if (p.wheelDay === today) return out;
  p.wheelDay = today;
  const euros = weighted(rng, META.wheel.map((w) => [w.euros, w.weight] as const));
  out.cents += euros * 100;
  out.notes.push('Ruleta diaria ' + euros + ' €');
  return out;
}

/** Regalo diario: racha de 7 días; si falla un día, vuelve a empezar. */
export function collectGift(p: BotProgress, nowMs: number): MetaGain {
  const out = gain();
  const today = dayKey(nowMs);
  if (p.giftDay === today || !META.gift.length) return out;
  const consecutive = p.giftDay === previousDay(today);
  p.giftStreak = consecutive || !META.giftRestartOnMiss ? (p.giftStreak + 1) % META.gift.length : 0;
  p.giftDay = today;
  const euros = META.gift[Math.max(0, p.giftStreak)];
  out.cents += euros * 100;
  out.notes.push('Regalo día ' + (p.giftStreak + 1) + ' ' + euros + ' €');
  return out;
}

export interface PlayedRound { machine: string; stakeCents: number; returnedCents: number }

/**
 * Lo que unas rondas jugadas dan fuera de la máquina: progreso de misiones (y
 * su premio al completarlas) y XP del pase con sus topes (por ronda, por día y
 * la primera ronda del día).
 */
export function recordRounds(p: BotProgress, rounds: PlayedRound[], nowMs: number): MetaGain {
  const out = gain();
  if (!rounds.length) return out;
  const P = META.pass;
  const today = dayKey(nowMs);

  let xp = 0;
  if (p.firstRoundDay !== today) { p.firstRoundDay = today; xp += P.firstRoundOfDayXp; }
  for (const r of rounds) {
    const perRound = Math.min(P.roundXpMax, Math.floor(P.roundXpBase + P.roundXpPerEuro * (r.stakeCents / 100)));
    const room = P.roundXpPerDay > 0 ? Math.max(0, P.roundXpPerDay - p.roundXpToday) : perRound;
    const got = Math.min(perRound, room);
    p.roundXpToday += got;
    xp += got;
  }

  for (const m of p.missions) {
    if (m.done) continue;
    const def = META.missions.find((x) => x.id === m.id);
    if (!def) continue;
    for (const r of rounds) {
      if (def.machineId && def.machineId !== r.machine) continue;
      if (def.metric === 'rounds') m.progress += 1;
      else if (def.metric === 'wins') m.progress += r.returnedCents > r.stakeCents ? 1 : 0;
      else if (def.metric === 'wagered') m.progress += r.stakeCents / 100;
      else if (def.metric === 'returned') m.progress += r.returnedCents / 100;
    }
    if (m.progress >= def.target) {
      m.done = true;
      out.cents += Math.round(def.rewardEuros * 100);
      xp += P.missionXp;
      out.notes.push('Misión ' + def.id);
    }
  }

  addPassXp(p, xp, out);
  return out;
}

/**
 * ¿Compra el pase premium? Solo si no lo tiene esta temporada, le sobra el
 * dinero según su personalidad (un prudente quiere tener mucho más que el
 * precio) y le apetece. Al comprarlo cobra los premios premium de los niveles
 * que ya tenía, como en el juego. Devuelve lo que cuesta (0 si no compra).
 */
export function maybeBuyPremium(p: BotProgress, walletCents: number, def: PersonalityDef, rng: Rng, out: MetaGain): number {
  if (p.premium) return 0;
  const cushion = 12 - 9 * def.risk; // veces el precio que quiere tener antes de gastarlo
  if (walletCents < PREMIUM_PRICE_CENTS * cushion) return 0;
  if (!chance(rng, 0.05 + 0.25 * def.risk)) return 0;
  p.premium = true;
  for (const lv of META.pass.levels) {
    if (lv.level > p.passLevel) break;
    out.cents += lv.premium.coins * 100;
    addCosmetics(p, lv.premium.cosmetics, out);
  }
  out.notes.push('Pase premium');
  return PREMIUM_PRICE_CENTS;
}

/** De vez en cuando estrena título, marco o avatar de los que tiene. */
export function maybeEquip(p: BotProgress, rng: Rng): { avatarId: number | null } {
  const titles = p.cosmetics.filter((c) => c.startsWith('title_'));
  const frames = p.cosmetics.filter((c) => c.startsWith('frame_'));
  const avatars = p.cosmetics.filter((c) => /^avatar_\d+$/.test(c));
  if (titles.length && (!p.titleId || chance(rng, 0.3))) p.titleId = pick(rng, titles);
  if (frames.length && (!p.frameId || chance(rng, 0.3))) p.frameId = pick(rng, frames);
  if (avatars.length && chance(rng, 0.25)) return { avatarId: Number(pick(rng, avatars).slice(7)) };
  return { avatarId: null };
}

/** Une dos ganancias. */
export function merge(a: MetaGain, b: MetaGain): MetaGain {
  return { cents: a.cents + b.cents, cosmetics: [...a.cosmetics, ...b.cosmetics], notes: [...a.notes, ...b.notes] };
}
