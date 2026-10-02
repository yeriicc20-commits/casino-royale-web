/**
 * Lo que el juego ve de un evento y de su progreso.
 *
 * Los nombres de los campos son exactamente los de EventModels.cs: JsonUtility
 * empareja por nombre y deja en blanco, sin avisar, lo que no reconoce. Sin
 * objetos nulos ni diccionarios por la misma razón: banderas (hasX) y listas.
 */
import type { EventDef, EventsConfig, PlayerState } from './types';
import type { Instance } from './schedule';
import {
  contextAt, isRisk, liveScore, objectiveProgress, pot, riskMultiplier, rulesFor, surpriseWindows,
} from './engine';

const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

export function eventView(cfg: EventsConfig, def: EventDef, eventId: string, inst: Instance, nowMs: number, secret: string) {
  const open = nowMs >= inst.opensMs && nowMs < inst.closesMs;
  const ctx = contextAt(cfg, def, inst, open ? nowMs : inst.opensMs, secret);

  // El siguiente modificador (para "en 3 min: JACKPOTS x3").
  let nextModifierTitle = '';
  let nextModifierInSeconds = 0;
  if (open && def.modifiers && ctx.modifier) {
    const idx = def.modifiers.indexOf(ctx.modifier);
    const next = def.modifiers[idx + 1];
    if (next) {
      nextModifierTitle = next.title;
      nextModifierInSeconds = secs(inst.opensMs + next.fromMinute * 60000 - nowMs);
    }
  }

  // La sorpresa solo se cuenta cuando ya ha empezado.
  const surprise = open ? ctx.surprise : null;
  const s = def.surprise;
  const phase = ctx.phase;

  return {
    instanceId: inst.id,
    eventId,
    kind: def.kind,
    slot: inst.slot,
    name: def.name,
    tagline: def.tagline,
    description: def.description,
    rules: rulesFor(cfg, def),
    opensUtc: new Date(inst.opensMs).toISOString(),
    closesUtc: new Date(inst.closesMs).toISOString(),
    open,
    secondsToOpen: open ? 0 : secs(inst.opensMs - nowMs),
    secondsLeft: open ? secs(inst.closesMs - nowMs) : 0,

    hasPhase: !!phase,
    phaseId: phase?.id ?? '',
    phaseName: phase?.name ?? '',
    phaseBanner: phase?.banner ?? '',
    phaseColor: phase?.color ?? '',
    phaseIndex: ctx.phaseIndex,
    phaseCount: def.phases?.length ?? 0,
    phaseSecondsLeft: phase && open ? secs(inst.opensMs + phase.toMinute * 60000 - nowMs) : 0,
    phases: (def.phases ?? []).map((p) => ({ id: p.id, name: p.name, multiplier: p.pointsMultiplier, color: p.color })),

    hasModifier: open && !!ctx.modifier,
    modifierId: ctx.modifier?.id ?? '',
    modifierTitle: ctx.modifier?.title ?? '',
    modifierMessage: ctx.modifier?.message ?? '',
    modifierColor: ctx.modifier?.color ?? '',
    modifierSound: ctx.modifier?.sound ?? '',
    modifierFx: ctx.modifier?.fx ?? '',
    modifierSecondsLeft: open && ctx.modifier ? secs(ctx.modifierEndsMs - nowMs) : 0,
    nextModifierTitle,
    nextModifierInSeconds,
    modifiers: (def.modifiers ?? []).map((m) => ({ id: m.id, title: m.title, message: m.message, fromMinute: m.fromMinute, color: m.color })),

    surpriseActive: !!surprise,
    surpriseTitle: s?.title ?? '',
    surpriseMessage: s?.message ?? '',
    surpriseColor: s?.color ?? '',
    surpriseSound: s?.sound ?? '',
    surpriseFx: s?.fx ?? '',
    surpriseSecondsLeft: surprise ? secs(surprise.endMs - nowMs) : 0,

    featured: open ? ctx.featured : [],
    featuredNames: open ? ctx.featured.map((g) => cfg.machineNames[g] ?? g) : [],
    featuredMultiplier: ctx.featuredMult,
    featuredSecondsLeft: open && ctx.featured.length ? secs(ctx.featuredEndsMs - nowMs) : 0,

    pointsMultiplier: Math.round(ctx.pointsMult * 100) / 100,
    minStakeCents: Math.max(cfg.limits.minStakeCents, def.minStakeCents ?? 0),
    minWinMultiplier: def.scoring.minWinMultiplier,
    rankBy: def.rankBy,
    rankSorts: def.rankSorts ?? ['points'],
    hasJackpots: def.jackpotScale > 0,
    jackpotTiers: cfg.jackpotTiers.map((t) => ({ id: t.id, name: t.name, points: t.points, coinsCents: t.coinsCents })),
    hasRisk: isRisk(def),
    riskSteps: (def.risk?.steps ?? []).map((st) => ({ multiplier: st.multiplier, chance: st.chance })),
    maxShields: def.risk?.maxShields ?? 0,
    hasChest: !!def.chest,
    chestCoinsCents: def.chest?.coinsCents ?? 0,
    milestones: def.scoring.milestones.map((m) => ({ streak: m.streak, points: m.points, label: m.label })),
    streakMultiplierFrom: def.scoring.streakMultiplierFrom ?? 0,
    streakMultiplier: def.scoring.streakMultiplier ?? 0,
    rewards: def.rewards.map((r) => ({
      id: r.id,
      label: r.label,
      range: r.participation ? 'Jugando ' + (r.minRounds ?? 1) + ' rondas' : r.fromRank === r.toRank ? 'Puesto ' + r.fromRank : 'Puestos ' + r.fromRank + '-' + r.toRank,
      coinsCents: r.coinsCents,
      cosmetics: r.cosmetics,
    })),
    unlocks: (def.unlocks ?? []).map((u) => ({ id: u.id, label: u.label, detail: u.detail, cosmetics: u.cosmetics, minPoints: u.minPoints ?? 0, maxRank: u.maxRank ?? 0 })),
    surprisesToday: s && (!def.phases || def.phases.some((p) => p.surprise)) ? surpriseWindows(def, inst, secret).length : 0,
  };
}

export function meView(def: EventDef, st: PlayerState, rank: number, total: number, participating: boolean, phaseIndexNow: number) {
  const risk = isRisk(def);
  const steps = def.risk?.steps ?? [];
  const next = risk && st.riskStep < steps.length ? steps[st.riskStep] : null;
  const potNow = risk ? pot(def, st) : 0;
  const base = st.riskStep === 0 ? st.potBase + st.potExtra : st.potBase;
  const phaseIdx = (id?: string) => (id && def.phases ? def.phases.findIndex((p) => p.id === id) : -1);
  const totalJackpots = st.jackpots.reduce((a, b) => a + b, 0);

  return {
    participating,
    score: liveScore(def, st),
    points: st.points,
    banked: st.banked,
    pot: potNow,
    riskStep: st.riskStep,
    riskMultiplier: riskMultiplier(def, st.riskStep),
    hasNextRisk: !!next,
    nextMultiplier: next?.multiplier ?? 0,
    nextChance: next?.chance ?? 0,
    nextPot: next ? Math.floor(base * next.multiplier + (st.riskStep === 0 ? 0 : st.potExtra)) : 0,
    shields: st.shields,
    streakShields: st.perks.streakShields,
    vip: st.perks.vip,
    streak: st.streak,
    bestStreak: st.bestStreak,
    wins: st.wins,
    losses: st.losses,
    rounds: st.rounds,
    jackpotsMini: st.jackpots[0] || 0,
    jackpotsMega: st.jackpots[1] || 0,
    jackpotsUltra: st.jackpots[2] || 0,
    jackpotsTotal: totalJackpots,
    bestJackpot: st.bestJackpot,
    bestMultiplier: Math.round(st.bestMultiplier * 100) / 100,
    rank,
    total,
    objectives: (def.objectives ?? []).map((o) => {
      const pi = phaseIdx(o.phase);
      const done = st.done.includes(o.id);
      return {
        id: o.id,
        label: o.label,
        type: o.type,
        progress: objectiveProgress(o, st),
        target: o.target,
        points: o.points,
        done,
        phaseName: pi >= 0 ? def.phases![pi].name : '',
        locked: !done && pi > phaseIndexNow,
        missed: !done && pi >= 0 && pi < phaseIndexNow,
      };
    }),
    chestReady: !!def.chest && !st.chestClaimed && (def.objectives ?? []).every((o) => st.done.includes(o.id)),
    chestClaimed: st.chestClaimed,
    unlocked: st.unlocked,
  };
}
