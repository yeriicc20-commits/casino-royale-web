/**
 * Pruebas del motor de eventos (sin base de datos).
 *
 *   npx tsx tests/eventos.test.ts
 */
import assert from 'node:assert/strict';
import rawConfig from '../lib/events/config.json';
import type { EventsConfig, RoundIn } from '../lib/events/types';
import {
  activeInstance, instanceById, instanceOn, nextInstance, previousDayInstance, spainParts, spainToUtc,
} from '../lib/events/schedule';
import {
  applyRounds, cash, contextAt, finalScore, liveScore, newState, objectiveProgress, pot, risk, rulesFor, surpriseWindows,
} from '../lib/events/engine';
import { eventView, meView } from '../lib/events/view';

const cfg = rawConfig as unknown as EventsConfig;
const SECRET = 'test';
let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
const never = () => 0.999999;

// ------------------------------------------------------------------ horarios

test('horario diario y semanal en hora de España (verano e invierno)', () => {
  // Lunes 5 de octubre de 2026, verano (UTC+2): 17:00 España = 15:00 UTC.
  const mon = instanceOn(cfg, 'daily', 2026, 10, 5)!;
  assert.equal(mon.id, 'd-2026-10-05');
  assert.equal(mon.eventId, 'racha_mortal');
  assert.equal(new Date(mon.opensMs).toISOString(), '2026-10-05T15:00:00.000Z');
  assert.equal(new Date(mon.closesMs).toISOString(), '2026-10-05T16:00:00.000Z');
  // Lunes 2 de noviembre, invierno (UTC+1): 17:00 España = 16:00 UTC.
  const nov = instanceOn(cfg, 'daily', 2026, 11, 2)!;
  assert.equal(new Date(nov.opensMs).toISOString(), '2026-11-02T16:00:00.000Z');
  // Sábado 3 de octubre: semanal 11-14.
  const sat = instanceOn(cfg, 'weekly', 2026, 10, 3)!;
  assert.equal(sat.eventId, 'casino_royale');
  assert.equal(new Date(sat.opensMs).toISOString(), '2026-10-03T09:00:00.000Z');
  assert.equal(instanceOn(cfg, 'weekly', 2026, 10, 4), null);
  // Cada día su evento.
  const ids = [4, 5, 6, 7, 8, 9].map((d) => instanceOn(cfg, 'daily', 2026, 10, d)!.eventId);
  assert.deepEqual(ids, ['caza_tesoro', 'racha_mortal', 'jackpot_rush', 'casino_caos', 'todo_o_nada', 'high_roller']);
  assert.equal(spainParts(Date.parse('2026-10-05T15:30:00Z')).hour, 17);
  assert.equal(spainToUtc(2026, 3, 29, '17:00'), Date.parse('2026-03-29T15:00:00Z'));
});

test('evento activo, siguiente, por id y el viernes antes del sábado', () => {
  assert.equal(activeInstance(cfg, Date.parse('2026-10-05T15:30:00Z'))!.id, 'd-2026-10-05');
  assert.equal(activeInstance(cfg, Date.parse('2026-10-05T16:00:00Z')), null); // a las 18:00 ya está cerrado
  assert.equal(activeInstance(cfg, Date.parse('2026-10-03T10:00:00Z'))!.id, 'w-2026-10-03');
  assert.equal(nextInstance(cfg, 'weekly', Date.parse('2026-10-05T10:00:00Z'))!.id, 'w-2026-10-10');
  assert.equal(nextInstance(cfg, 'daily', Date.parse('2026-10-05T17:00:00Z'))!.id, 'd-2026-10-06');
  assert.equal(instanceById(cfg, 'd-2026-10-09')!.eventId, 'high_roller');
  assert.equal(instanceById(cfg, 'x-1'), null);
  assert.equal(previousDayInstance(cfg, instanceById(cfg, 'w-2026-10-10')!)!.eventId, 'high_roller');
});

// ------------------------------------------------------------------ racha mortal

const mon = instanceOn(cfg, 'daily', 2026, 10, 5)!;
const monDef = cfg.events.racha_mortal;
const at = (inst: { opensMs: number }, minute: number) => inst.opensMs + minute * 60000;
const round = (g: string, s: number, r: number, t: number): RoundIn => ({ g, s, r, t });

test('racha mortal: puntos progresivos, hitos, récord y derrota que reinicia', () => {
  const st = newState(monDef);
  const now = at(mon, 10);
  const wins = Array.from({ length: 5 }, () => round('blackjack', 100, 200, now));
  const res = applyRounds(cfg, monDef, mon, st, wins, now, never, SECRET, 'r1');
  assert.equal(res.counted, 5);
  assert.equal(st.streak, 5);
  assert.equal(st.bestStreak, 5);
  // 5×100 + 50×(1+2+3+4) + hito 3 (300) + hito 5 (800)
  assert.equal(st.points, 500 + 500 + 300 + 800);
  assert.ok(res.feedback.some((f) => f.type === 'milestone' && f.title.includes('MEDIO')));
  assert.ok(res.feedback.some((f) => f.type === 'record'));

  applyRounds(cfg, monDef, mon, st, [round('roulette', 100, 0, now)], now, never, SECRET, 'r2');
  assert.equal(st.streak, 0);
  assert.equal(st.bestStreak, 5);
});

test('racha mortal: una victoria "segura" (x1,01) no cuenta ni rompe; apuesta mínima', () => {
  const st = newState(monDef);
  const now = at(mon, 10);
  applyRounds(cfg, monDef, mon, st, [round('dice', 100, 200, now), round('dice', 100, 101, now)], now, never, SECRET, 'r1');
  assert.equal(st.streak, 1);
  assert.equal(st.points, 100);
  const low = applyRounds(cfg, monDef, mon, st, [round('dice', 10, 20, now)], now, never, SECRET, 'r2');
  assert.equal(low.lowStake, 1);
  assert.equal(st.rounds, 2);
});

test('racha mortal: a partir de 20 seguidas todo vale doble', () => {
  const st = newState(monDef);
  st.streak = 19; st.bestStreak = 19;
  const now = at(mon, 10);
  const res = applyRounds(cfg, monDef, mon, st, [round('slots', 100, 300, now)], now, never, SECRET, 'r1');
  assert.equal(st.points, (100 + 50 * 19) * 2);
  assert.ok(res.feedback.some((f) => f.type === 'streak_mult'));
});

test('rondas falsas o fuera de horario se ignoran', () => {
  const st = newState(monDef);
  const now = at(mon, 10);
  const res = applyRounds(cfg, monDef, mon, st, [
    round('noexiste', 100, 200, now),
    round('slots', 100, 100 * 5000, now), // multiplicador imposible
    round('slots', 100, 200, mon.opensMs - 60000), // antes de abrir
    round('slots', 100, 200, now + 60000), // en el futuro
    round('slots', 100, 200, now),
  ], now, never, SECRET, 'r1');
  assert.equal(res.ignored, 4);
  assert.equal(res.counted, 1);
});

test('límite de rondas por minuto', () => {
  const st = newState(monDef);
  const now = at(mon, 10);
  for (let k = 0; k < 3; k++) {
    applyRounds(cfg, monDef, mon, st, Array.from({ length: 60 }, () => round('plinko', 100, 0, now)), now, never, SECRET, 'b' + k);
  }
  assert.equal(st.rounds, cfg.limits.maxRoundsPerMinute);
});

// ------------------------------------------------------------------ jackpot rush

const tue = instanceOn(cfg, 'daily', 2026, 10, 6)!;
const tueDef = cfg.events.jackpot_rush;

test('jackpot rush: el sorteo da jackpots, puntos y fichas con llave única', () => {
  const st = newState(tueDef);
  const now = at(tue, 5);
  // 0.0001 < ultra; 0.002 -> mega; 0.02 -> mini; 0.9 -> nada
  const res = applyRounds(cfg, tueDef, tue, st, [
    round('slots', 100, 0, now), round('slots', 100, 0, now), round('slots', 100, 0, now), round('slots', 100, 0, now),
  ], now, seq([0.0001, 0.002, 0.02, 0.9]), SECRET, 'rep');
  assert.deepEqual(st.jackpots, [1, 1, 1]);
  assert.equal(st.bestJackpot, 2);
  assert.equal(st.points, 500 + 2000 + 6000);
  assert.equal(res.awards.length, 3);
  assert.deepEqual(res.awards.map((a) => a.claimId), ['d-2026-10-06:jp:rep:0', 'd-2026-10-06:jp:rep:1', 'd-2026-10-06:jp:rep:2']);
  assert.equal(res.awards[0].cents, 500000);
  assert.ok(res.feedback.some((f) => f.title === '¡ULTRA JACKPOT!'));
});

test('racha mortal no sortea jackpots', () => {
  const st = newState(monDef);
  applyRounds(cfg, monDef, mon, st, [round('slots', 100, 0, at(mon, 3))], at(mon, 3), () => 0, SECRET, 'x');
  assert.deepEqual(st.jackpots, [0, 0, 0]);
});

// ------------------------------------------------------------------ caos

const wed = instanceOn(cfg, 'daily', 2026, 10, 7)!;
const wedDef = cfg.events.casino_caos;

test('casino caos: modificadores por tramo y caos total', () => {
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 2), SECRET).modifier!.id, 'mult_x2');
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 2), SECRET).pointsMult >= 2, true);
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 15), SECRET).streakMult, 2);
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 25), SECRET).jackpotScale >= 0.6 - 1e-9, true);
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 35), SECRET).flat, 150);
  const table = contextAt(cfg, wedDef, wed, at(wed, 55), SECRET);
  assert.equal(table.featured.length, 2);
  assert.equal(table.featuredMult, 3);
  assert.equal(contextAt(cfg, wedDef, wed, at(wed, 5), SECRET).featured.length, 0); // solo con "mesas locas"

  const windows = surpriseWindows(wedDef, wed, SECRET);
  assert.equal(windows.length, 2);
  assert.ok(windows[1].startMs >= windows[0].endMs);
  const mid = windows[0].startMs + 30000;
  const ctx = contextAt(cfg, wedDef, wed, mid, SECRET);
  assert.ok(ctx.surprise);
  const plain = contextAt(cfg, wedDef, wed, windows[0].startMs - 1, SECRET);
  assert.ok(Math.abs(ctx.pointsMult / plain.pointsMult - 5) < 1e-9 || ctx.modifier!.id !== plain.modifier!.id);

  const st = newState(wedDef);
  applyRounds(cfg, wedDef, wed, st, [round('blackjack', 100, 200, at(wed, 2))], at(wed, 2), never, SECRET, 'a');
  assert.ok(st.points === 200 || st.points === 1000); // x2 (o x10 si cae dentro del caos)
});

test('casino caos: no se puede "fechar" una ronda dentro del caos total', () => {
  const windows = surpriseWindows(wedDef, wed, SECRET);
  const st = newState(wedDef);
  const now = windows[0].endMs + 5 * 60000; // cinco minutos después de acabar
  applyRounds(cfg, wedDef, wed, st, [round('blackjack', 100, 200, windows[0].startMs + 1000)], now, never, SECRET, 'a');
  const ctxNow = contextAt(cfg, wedDef, wed, now - 60000, SECRET);
  assert.equal(st.points, Math.round(100 * ctxNow.pointsMult + ctxNow.flat * ctxNow.pointsMult));
});

// ------------------------------------------------------------------ todo o nada

const thu = instanceOn(cfg, 'daily', 2026, 10, 8)!;
const thuDef = cfg.events.todo_o_nada;

test('todo o nada: bote, arriesgar, cobrar, perder y protección', () => {
  const st = newState(thuDef);
  const now = at(thu, 5);
  applyRounds(cfg, thuDef, thu, st, Array.from({ length: 5 }, () => round('roulette', 100, 200, now)), now, never, SECRET, 'a');
  const earned = 100 * 5 + 20 * (1 + 2 + 3 + 4);
  assert.equal(pot(thuDef, st), earned);
  assert.equal(st.shields, 1); // racha de 5 -> 1 protección
  assert.equal(liveScore(thuDef, st), 0); // sin cobrar no cuenta

  assert.ok(risk(thuDef, st, () => 0).ok); // x2
  assert.equal(pot(thuDef, st), earned * 2);
  assert.ok(risk(thuDef, st, () => 0).ok); // x3
  assert.equal(pot(thuDef, st), earned * 3);

  const saved = risk(thuDef, st, () => 0.99); // pierde, pero hay protección
  assert.equal(saved.feedback[0].type, 'risk_shield');
  assert.equal(st.shields, 0);
  assert.equal(pot(thuDef, st), earned);

  assert.equal(cash(thuDef, st).feedback[0].type, 'cash');
  assert.equal(st.banked, earned);
  assert.equal(pot(thuDef, st), 0);

  applyRounds(cfg, thuDef, thu, st, [round('roulette', 100, 200, now)], now, never, SECRET, 'b');
  const lost = risk(thuDef, st, () => 0.99);
  assert.equal(lost.feedback[0].type, 'risk_lose');
  assert.equal(pot(thuDef, st), 0);
  assert.equal(st.banked, earned);
  assert.equal(cash(thuDef, st).ok, false);
});

test('todo o nada: cuatro aciertos llegan a x10 y se cobra solo; al cerrar se cobra el bote', () => {
  const st = newState(thuDef);
  st.potBase = 100;
  for (let i = 0; i < 4; i++) assert.ok(risk(thuDef, st, () => 0).ok);
  assert.equal(st.banked, 1000);
  st.potBase = 50;
  assert.equal(finalScore(thuDef, st), 1050);
  assert.equal(liveScore(thuDef, st), 1000);
});

// ------------------------------------------------------------------ high roller

const fri = instanceOn(cfg, 'daily', 2026, 10, 9)!;
const friDef = cfg.events.high_roller;

test('high roller: apuesta mínima, x1,5, desafíos y pase VIP', () => {
  const st = newState(friDef);
  const now = at(fri, 3);
  const low = applyRounds(cfg, friDef, fri, st, [round('blackjack', 100, 200, now)], now, never, SECRET, 'a');
  assert.equal(low.lowStake, 1);
  assert.equal(st.rounds, 0);

  const ctx = contextAt(cfg, friDef, fri, now, SECRET);
  const plain = cfg.machines.find((g) => !ctx.featured.includes(g))!;
  applyRounds(cfg, friDef, fri, st, [round(plain, 1000, 2000, now)], now, never, SECRET, 'b');
  assert.equal(st.points, 150);

  const many = Array.from({ length: 30 }, () => round(plain, 1000, 2000, now + 1000));
  const res = applyRounds(cfg, friDef, fri, st, many, now + 1000, never, SECRET, 'c');
  assert.ok(st.done.includes('hr_wins'));
  assert.ok(st.done.includes('hr_streak'));
  assert.ok(st.unlocked.includes('vip_pass'));
  assert.ok(res.awards.some((a) => a.claimId === 'd-2026-10-09:unlock:vip_pass' && a.perk!.vip));
});

// ------------------------------------------------------------------ casino royale

const sat = instanceOn(cfg, 'weekly', 2026, 10, 10)!;
const satDef = cfg.events.casino_royale;

test('casino royale: tres fases, desafíos por fase y comodín de racha', () => {
  assert.equal(contextAt(cfg, satDef, sat, at(sat, 30), SECRET).phase!.id, 'clasificacion');
  assert.equal(contextAt(cfg, satDef, sat, at(sat, 90), SECRET).phase!.id, 'high_stakes');
  assert.equal(contextAt(cfg, satDef, sat, at(sat, 150), SECRET).phase!.id, 'final');
  assert.equal(contextAt(cfg, satDef, sat, at(sat, 30), SECRET).featured.length, 0);
  assert.equal(contextAt(cfg, satDef, sat, at(sat, 90), SECRET).featured.length, 2);
  const w = surpriseWindows(satDef, sat, SECRET);
  assert.ok(w.every((x) => x.startMs >= at(sat, 120)));

  const st = newState(satDef);
  st.perks.streakShields = 1;
  const t1 = at(sat, 10);
  const ctx1 = contextAt(cfg, satDef, sat, t1, SECRET);
  const g = cfg.machines.find((m) => !ctx1.featured.includes(m))!;
  applyRounds(cfg, satDef, sat, st, Array.from({ length: 4 }, () => round(g, 100, 200, t1)), t1, never, SECRET, 'a');
  assert.ok(st.done.includes('r1_streak'));
  const res = applyRounds(cfg, satDef, sat, st, [round(g, 100, 0, t1)], t1, never, SECRET, 'b');
  assert.equal(st.streak, 4); // el comodín salva la racha
  assert.ok(res.feedback.some((f) => f.type === 'shield_used'));

  // Los desafíos de la final no avanzan en la fase 1.
  const fin = satDef.objectives!.find((o) => o.id === 'r3_wins')!;
  assert.equal(objectiveProgress(fin, st), 0);
  const t3 = at(sat, 121);
  applyRounds(cfg, satDef, sat, st, [round(g, 100, 200, t3)], t3, never, SECRET, 'c');
  assert.equal(st.ph.id, 'final');
  assert.equal(objectiveProgress(fin, st), 1);
});

// ------------------------------------------------------------------ caza del tesoro

const sun = instanceOn(cfg, 'daily', 2026, 10, 11)!;
const sunDef = cfg.events.caza_tesoro;

test('caza del tesoro: todos los objetivos abren el cofre', () => {
  const st = newState(sunDef);
  const t = at(sun, 30);
  const ctx = contextAt(cfg, sunDef, sun, t, SECRET);
  const table = ctx.featured[0];
  const rounds = [
    round('blackjack', 100, 200, t), round('roulette', 100, 200, t), round('slots', 100, 600, t),
    round(table, 100, 200, t), round(table, 100, 200, t),
  ];
  const res = applyRounds(cfg, sunDef, sun, st, rounds, t, seq([0.9, 0.9, 0.9, 0.9, 0.001]), SECRET, 'a');
  assert.ok(sunDef.objectives!.every((o) => st.done.includes(o.id)), 'faltan: ' + sunDef.objectives!.filter((o) => !st.done.includes(o.id)).map((o) => o.id));
  assert.ok(res.feedback.some((f) => f.type === 'chest_ready'));
  const me = meView(sunDef, st, 1, 1, true, -1);
  assert.equal(me.chestReady, true);
});

// ------------------------------------------------------------------ vistas y textos

test('vistas y reglas', () => {
  for (const [id, def] of Object.entries(cfg.events)) {
    const inst = id === 'casino_royale' ? sat : id === 'racha_mortal' ? mon : id === 'jackpot_rush' ? tue : id === 'casino_caos' ? wed : id === 'todo_o_nada' ? thu : id === 'high_roller' ? fri : sun;
    const v = eventView(cfg, def, id, inst, at(inst, 1), SECRET);
    assert.equal(v.open, true);
    assert.ok(v.rules.length >= 3, id);
    assert.ok(rulesFor(cfg, def).every((l) => !l.includes('undefined') && !l.includes('NaN')), id);
    const closed = eventView(cfg, def, id, inst, inst.opensMs - 3600000, SECRET);
    assert.equal(closed.open, false);
    assert.equal(closed.secondsToOpen, 3600);
    assert.equal(closed.surpriseActive, false);
  }
});

console.log('\n' + passed + ' pruebas OK');
