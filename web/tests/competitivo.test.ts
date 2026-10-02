/**
 * Pruebas del competitivo (sin base de datos).
 *
 *   npx tsx tests/competitivo.test.ts
 */
import assert from 'node:assert/strict';
import rawConfig from '../lib/competitive/config.json';
import type { CompetitiveConfig, GameDef } from '../lib/competitive/types';
import type { LadderRow as LadderRowLike } from '../lib/competitive/ranks';
import {
  applyResult, divisionFor, divisions, expected, legendTitle, mmrWindow, seasonAt, seasonByNumber, softReset,
} from '../lib/competitive/ranks';
import { newMatch, placeBet, playAction, setReady, tick, viewFor } from '../lib/competitive/match';
import { ROULETTE_BETS } from '../lib/competitive/games';

const cfg = rawConfig as unknown as CompetitiveConfig;
const game = (id: string) => cfg.games.find((g) => g.id === id) as GameDef;
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log('ok  ' + name); }
const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

const ladder = (points = 0, mmr = 1000): LadderRowLike => ({
  points, mmr, games: 20, wins: 10, losses: 10, draws: 0, streak: 0, bestStreak: 0, peakPoints: points, peakDivision: 0, protectLeft: 0,
});

test('22 divisiones en orden, de FICHA III a LEYENDA DEL CASINO', () => {
  const all = divisions(cfg);
  assert.equal(all.length, 22);
  assert.equal(all[0].label, 'FICHA III');
  assert.equal(all[2].label, 'FICHA I');
  assert.equal(all[3].label, 'JUGADOR III');
  assert.equal(all[21].label, 'LEYENDA DEL CASINO');
  assert.equal(divisionFor(cfg, 0).label, 'FICHA III');
  assert.equal(divisionFor(cfg, 99).label, 'FICHA III');
  assert.equal(divisionFor(cfg, 100).label, 'FICHA II');
  assert.equal(divisionFor(cfg, 1284).label, 'HIGH ROLLER I');
  assert.equal(divisionFor(cfg, 2999).label, 'PROPIETARIO I');
  assert.equal(divisionFor(cfg, 99999).label, 'LEYENDA DEL CASINO');
});

test('puntos según el rival: más por ganar a uno mejor, menos por perder con uno mejor', () => {
  const eq = applyResult(cfg, ladder(1000), 1000, 'win', true, false);
  assert.equal(eq.pointsDelta, 25);
  const up = applyResult(cfg, ladder(1000), 1400, 'win', true, false);
  assert.ok(up.pointsDelta > 25 && up.pointsDelta <= 30, String(up.pointsDelta));
  const down = applyResult(cfg, ladder(1000), 600, 'win', true, false);
  assert.ok(down.pointsDelta < 25 && down.pointsDelta >= 20, String(down.pointsDelta));
  const lossEq = applyResult(cfg, ladder(1000), 1000, 'loss', true, false);
  assert.equal(lossEq.pointsDelta, -20);
  const lossUp = applyResult(cfg, ladder(1000), 1400, 'loss', true, false);
  assert.ok(lossUp.pointsDelta > -20, String(lossUp.pointsDelta));
  const lossDown = applyResult(cfg, ladder(1000), 600, 'loss', true, false);
  assert.ok(lossDown.pointsDelta < -20, String(lossDown.pointsDelta));
});

test('MMR oculto: sube al ganar, baja al perder, y no cambia en casual', () => {
  const w = applyResult(cfg, ladder(500, 1500), 1500, 'win', true, false);
  assert.ok(w.mmrAfter > 1500);
  const l = applyResult(cfg, ladder(500, 1500), 1500, 'loss', true, false);
  assert.ok(l.mmrAfter < 1500);
  const casual = applyResult(cfg, ladder(500, 1500), 1500, 'win', false, false);
  assert.equal(casual.mmrAfter, 1500);
  assert.equal(casual.pointsDelta, 0);
  assert.ok(Math.abs(expected(1000, 1000) - 0.5) < 1e-9);
});

test('ascenso, protección contra descenso y descenso', () => {
  const row = ladder(1090);
  const up = applyResult(cfg, row, 1000, 'win', true, false);
  assert.equal(up.promoted, true);
  assert.equal(divisionFor(cfg, row.points).label, 'HIGH ROLLER II');
  assert.equal(row.protectLeft, 3);
  // Recién ascendido: perder no le baja de división.
  const fall = applyResult(cfg, row, 1000, 'loss', true, false);
  assert.equal(fall.demoted, false);
  assert.equal(fall.protectedFall, true);
  assert.equal(row.points, 1100);
  row.protectLeft = 0;
  const down = applyResult(cfg, row, 1000, 'loss', true, false);
  assert.equal(down.demoted, true);
  assert.equal(divisionFor(cfg, row.points).label, 'HIGH ROLLER III');
});

test('rangos bajos pierden menos, racha da bonus, abandono resta más, no baja de 0', () => {
  const ficha = applyResult(cfg, ladder(50), 1000, 'loss', true, false);
  assert.equal(ficha.pointsDelta, -10);
  const r = ladder(1000); r.streak = 2;
  const streak = applyResult(cfg, r, 1000, 'win', true, false);
  assert.equal(streak.pointsDelta, 28);
  const ab = applyResult(cfg, ladder(1000), 1000, 'loss', true, true);
  assert.equal(ab.pointsDelta, -30);
  const zero = applyResult(cfg, ladder(3), 1000, 'loss', true, false);
  assert.equal(zero.pointsAfter, 0);
});

test('ventana de emparejamiento que se amplía y casual amplio', () => {
  assert.equal(mmrWindow(cfg, 0, false), 50);
  assert.equal(mmrWindow(cfg, 12, false), 100);
  assert.equal(mmrWindow(cfg, 25, false), 150);
  assert.equal(mmrWindow(cfg, 60, false), 400);
  assert.equal(mmrWindow(cfg, 0, true), 2000);
});

test('temporadas: la 1 y las siguientes solas; reset parcial; Leyenda', () => {
  const s1 = seasonAt(cfg, Date.parse('2026-10-10T12:00:00Z'));
  assert.equal(s1.number, 1);
  assert.equal(s1.name, 'NOCHES DE NEÓN');
  const s2 = seasonAt(cfg, s1.endMs + 1000);
  assert.equal(s2.number, 2);
  assert.equal(s2.name, 'TEMPORADA 2');
  assert.equal(seasonByNumber(cfg, 3).number, 3);
  assert.equal(softReset(3000, 1000, 0.65), 2300);
  assert.equal(softReset(800, 1000, 0.65), 800);
  assert.equal(legendTitle(1, true), 'REY DEL CASINO');
  assert.equal(legendTitle(7, true), 'TOP 10');
  assert.equal(legendTitle(47, true), 'TOP 100');
  assert.equal(legendTitle(1, false), '');
});

// ------------------------------------------------------------------ partidas

test('ruleta: misma bola para los dos, apuestas a ciegas, gana quien acaba con más', () => {
  const def = game('roulette');
  const st = newMatch(cfg, def, 'competitive', 0);
  setReady(st, 'a'); setReady(st, 'b');
  tick(cfg, def, st, 1000, Math.random);
  assert.equal(st.phase, 'bet');
  assert.equal(placeBet(def, st, 'a', { amount: 100, type: 'red' }, 1000), null);
  assert.equal(viewFor(def, st, 'b', 1000).theirBetPlaced, true);
  assert.equal(placeBet(def, st, 'b', { amount: 100, type: 'black' }, 1000), null);
  // 1/37 → índice 1 → número 1 (rojo).
  tick(cfg, def, st, 1500, () => 1.5 / 37);
  assert.equal(st.history[0].outcome, '1 ROJO');
  assert.equal(st.stacks.a, 1100);
  assert.equal(st.stacks.b, 900);
  assert.equal(st.round, 2);
  assert.equal(placeBet(def, st, 'a', { amount: 5, type: 'red' }, 9000), 'La apuesta mínima es 10.');
  assert.equal(placeBet(def, st, 'a', { amount: 50, type: 'number', number: 40 }, 9000), 'Elige un número del 0 al 36.');
  assert.ok(ROULETTE_BETS.number.pays === 35);
});

test('nadie se escapa desconectándose: tres rondas sin apostar = abandono y pierde', () => {
  const def = game('dice');
  const st = newMatch(cfg, def, 'competitive', 0);
  let t = 20000; // pasa el tiempo del VS
  tick(cfg, def, st, t, Math.random);
  for (let r = 0; r < 3; r++) {
    placeBet(def, st, 'a', { amount: 10, chance: 50 }, t + 4000);
    t = st.deadline + 1;
    tick(cfg, def, st, t, () => 0.99);
  }
  assert.equal(st.phase, 'done');
  assert.equal(st.abandon, 'b');
  assert.equal(st.result, 'a');
  assert.equal(viewFor(def, st, 'b', t).result, 'loss');
  assert.equal(viewFor(def, st, 'b', t).abandoned, true);
});

test('el reloj juega solo: aunque nadie mire en un rato, la partida avanza bien', () => {
  const def = game('roulette');
  const st = newMatch(cfg, def, 'casual', 0);
  tick(cfg, def, st, 10 * 60 * 1000, Math.random);
  assert.equal(st.phase, 'done');
  assert.equal(st.result, 'void');
  assert.equal(st.abandon, 'both');
});

test('dados: misma tirada, paga 100/probabilidad', () => {
  const def = game('dice');
  const st = newMatch(cfg, def, 'competitive', 0);
  setReady(st, 'a'); setReady(st, 'b'); tick(cfg, def, st, 1, Math.random);
  placeBet(def, st, 'a', { amount: 100, chance: 50 }, 1);
  placeBet(def, st, 'b', { amount: 100, chance: 20 }, 1);
  tick(cfg, def, st, 2, () => 0.3); // tirada 30,00
  assert.equal(st.stacks.a, 1100); // 30 < 50 gana x2
  assert.equal(st.stacks.b, 900); // 30 >= 20 pierde
  assert.equal(st.history[0].outcome, '30,00');
});

test('blackjack: mismas cartas para los dos, cada uno decide, el crupier con su montón', () => {
  const def = game('blackjack');
  const st = newMatch(cfg, def, 'competitive', 0);
  setReady(st, 'a'); setReady(st, 'b'); tick(cfg, def, st, 1, Math.random);
  placeBet(def, st, 'a', { amount: 100 }, 1);
  placeBet(def, st, 'b', { amount: 100 }, 1);
  tick(cfg, def, st, 2, seq([0.37, 0.11, 0.73, 0.5, 0.91, 0.2, 0.64]));
  if (st.phase === 'play') {
    const va = viewFor(def, st, 'a', 2);
    const vb = viewFor(def, st, 'b', 2);
    assert.deepEqual(va.myCards, vb.myCards);
    assert.equal(va.dealerCards[1], 'back');
    assert.equal(playAction(def, st, 'a', 'hit'), null);
    assert.equal(playAction(def, st, 'b', 'hit'), null);
    assert.deepEqual(st.bj!.hands.a.cards, st.bj!.hands.b.cards);
    playAction(def, st, 'a', 'stand');
    playAction(def, st, 'b', 'stand');
    tick(cfg, def, st, 3, Math.random);
  }
  assert.equal(st.round, 2);
  assert.equal(st.history[0].a.delta, st.history[0].b.delta);
  assert.equal(viewFor(def, st, 'a', 3).lastDealer.length >= 2, true);
});

console.log('\n' + passed + ' pruebas OK');
