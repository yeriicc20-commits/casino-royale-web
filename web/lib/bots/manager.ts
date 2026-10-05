/**
 * BotManager: el que mueve a todos los bots.
 *
 * Un solo bucle para toda la población, no un temporizador por bot. Cada bot
 * guarda CUÁNDO le toca su próxima acción (next_action_at, con su propio ritmo
 * y retardos humanos al azar) y en cada vuelta el gestor atiende solo a los que
 * les toca. Entre vuelta y vuelta duerme hasta la próxima acción pendiente.
 *
 * Una vuelta (tick):
 *   1. coge el turno (online_bot_runtime): solo UN proceso mueve bots aunque
 *      haya varias instancias del servidor; si muere, otro lo coge solo
 *   2. apagado (BOTS_ENABLED=false) -> desconecta a todos con orden y para
 *   3. mira el mundo: personas conectadas, personas buscando rival, retos
 *      abiertos, apuntes de saldo pendientes (una consulta de cada cosa)
 *   4. población: entra o sale UN bot como mucho, con huecos al azar
 *   5. desafíos de personas: un bot libre se lo pensará 4-30 s
 *   6. retos de blackjack: responder / jugar la mano
 *   7. atiende a los bots a los que les toca (máquinas, eventos, 1v1...)
 *   8. latidos: publica presencia y saldo, como el juego cada pocos segundos
 *
 * Todo el estado vive en la base de datos: si el servidor se reinicia, el
 * siguiente proceso sigue donde se quedó.
 */
import rawEvents from '../events/config.json';
import { activeInstance, type Instance } from '../events/schedule';
import type { EventsConfig, RoundIn } from '../events/types';
import type { BotsConfig } from './config';
import { LOW_WALLET_CENTS, MACHINES, chooseBet, pickMachine, playRound, roundSeconds, startingWallet } from './economy';
import {
  collectGift, emptyProgress, maybeBuyPremium, maybeEquip, merge, recordRounds, rollDay, spinWheel, type MetaGain, type PlayedRound,
} from './meta';
import { generateUsername } from './names';
import { defFor, pickPersonality, type PersonalityDef, type Range } from './personalities';
import { eventPhaseAt, joinsNow, leavesNow, stepPopulation } from './population';
import type { BotPorts } from './ports';
import {
  chance, clamp, cryptoRng, humanDelayMs, logNormal, pick, randInt, randomId, uniform, weighted, type Rng,
} from './random';
import { acceptDuelChance, acceptTicketChance, blackjackHits, matchMove, thinkMs } from './strategy';
import { emptyRuntime, emptyStats, type Bot, type BotState, type HumanTicket, type OpenDuel, type Runtime, type World } from './types';

const EVENTS = rawEvents as unknown as EventsConfig;

/** Estados en los que un bot está "libre" (puede irse, aceptar un reto, considerar un desafío). */
const FREE: ReadonlySet<BotState> = new Set(['IDLE', 'BROWSING', 'COOLDOWN']);

/** Los juegos del 1v1 y la máquina que se ve en el panel mientras juega cada uno. */
const DUEL_MACHINES: Record<string, string> = { roulette: 'roulette', blackjack: 'blackjack', dice: 'dice', poker: 'holdem' };

const WORLD_TTL_MS = 2500;
const RELOAD_MS = 60_000;
const TICKET_MEMORY_MS = 5 * 60_000;
const EVENT_CLAIM_EVERY_MS = 20 * 60_000;

export interface TickReport {
  ran: boolean;
  reason?: string;
  online: number;
  target: number;
  steps: number;
  joined: number;
  left: number;
  /** Cuándo conviene la siguiente vuelta. */
  nextInMs: number;
}

function minutes(rng: Rng, r: Range): number {
  return clamp(logNormal(rng, r.median, r.sigma), r.min, r.max) * 60_000;
}

export class BotManager {
  private bots: Bot[] = [];
  private loadedAt = 0;
  private runtime: Runtime = emptyRuntime();
  private leaseUntil = 0;
  private world: (World & { pendingGrants: string[] }) | null = null;
  private worldAt = 0;
  private dirty = new Set<string>();
  private runtimeSavedAt = 0;
  private actions = 0;

  constructor(
    private readonly ports: BotPorts,
    private readonly cfg: BotsConfig,
    private readonly rng: Rng = cryptoRng,
    readonly owner: string = 'bm-' + randomId(),
  ) {}

  /** Para el panel y las pruebas. */
  snapshot(): readonly Bot[] {
    return this.bots;
  }

  // ------------------------------------------------------------------ turno

  private async ensureLease(now: number): Promise<boolean> {
    if (now < this.leaseUntil - 5000) return true;
    const ok = await this.ports.lease(this.owner, this.cfg.leaseSeconds);
    if (!ok) {
      this.leaseUntil = 0;
      return false;
    }
    // Si veníamos sin turno, lo que hubiera en memoria puede estar viejo.
    if (now >= this.leaseUntil) this.loadedAt = 0;
    this.leaseUntil = now + this.cfg.leaseSeconds * 1000;
    return true;
  }

  /** Suelta el turno (al parar el worker o al acabar la llamada del cron). */
  async stop(now = Date.now()) {
    await this.flush(now, true);
    await this.ports.release(this.owner);
    this.leaseUntil = 0;
  }

  private async load(now: number) {
    if (this.loadedAt && now - this.loadedAt < RELOAD_MS) return;
    this.bots = await this.ports.loadBots();
    this.runtime = { ...emptyRuntime(), ...(await this.ports.loadRuntime()) };
    this.loadedAt = now;
  }

  private touch(bot: Bot) {
    this.dirty.add(bot.id);
  }

  private async flush(now: number, force = false) {
    if (this.dirty.size) {
      const ids = [...this.dirty];
      this.dirty.clear();
      for (const id of ids) {
        const bot = this.bots.find((b) => b.id === id);
        if (!bot) continue;
        if (!(await this.ports.saveBot(bot))) {
          // Alguien la cambió (otro proceso con el turno caducado): se relee todo.
          console.warn('[bots] conflicto de versión al guardar', bot.username);
          this.loadedAt = 0;
        }
      }
    }
    if (force || now - this.runtimeSavedAt > 5000) {
      this.runtime.lastTickAt = now;
      await this.ports.saveRuntime(this.runtime);
      this.runtimeSavedAt = now;
    }
  }

  // ------------------------------------------------------------------ vuelta

  async tick(now = Date.now()): Promise<TickReport> {
    const report: TickReport = { ran: false, online: 0, target: this.runtime.target, steps: 0, joined: 0, left: 0, nextInMs: 3000 };
    if (!(await this.ensureLease(now))) return { ...report, reason: 'lease' };
    report.ran = true;
    await this.load(now);

    if (!this.cfg.enabled) {
      report.left = await this.shutdown(now);
      report.nextInMs = 30_000;
      return report;
    }

    if (!this.world || now - this.worldAt > WORLD_TTL_MS) {
      // Solo los conectados: los demás recogen sus apuntes y retos al entrar.
      this.world = await this.ports.world(this.bots.filter((b) => b.state !== 'OFFLINE').map((b) => b.id), now);
      this.worldAt = now;
    }
    const world = this.world;
    const event = this.cfg.allowEvents ? activeInstance(EVENTS, now) : null;

    // Apuntes pendientes (premios, retos, partidas): se cobran antes de decidir nada.
    for (const id of world.pendingGrants) {
      const bot = this.bots.find((b) => b.id === id);
      if (bot) await this.collectGrants(bot);
    }
    world.pendingGrants = [];

    // ---- población
    const rt = this.runtime;
    // La afluencia sigue a los eventos aunque los bots no puedan entrar en ellos.
    stepPopulation(rt, this.cfg, now, this.rng, eventPhaseAt(EVENTS, now));
    const online = () => this.bots.filter((b) => b.state !== 'OFFLINE');
    const joins = joinsNow(rt, this.cfg, online().length, now, this.rng);
    for (let i = 0; i < joins; i++) if (await this.join(now)) report.joined++;
    const leaves = leavesNow(rt, this.cfg, online().length, now, this.rng);
    for (let i = 0; i < leaves; i++) {
      // Se va el que menos sesión le quedaba (de los que están libres).
      const free = online().filter((b) => FREE.has(b.state) && b.sessionEndsAt > now);
      if (!free.length) break;
      const bot = free.sort((a, b) => a.sessionEndsAt - b.sessionEndsAt)[0];
      bot.sessionEndsAt = now;
      bot.nextActionAt = Math.min(bot.nextActionAt, now + randInt(this.rng, 300, 4000));
      this.touch(bot);
    }

    // ---- desafíos de personas y retos
    if (this.cfg.allow1v1 && this.cfg.allowHuman1v1) this.considerTickets(world, now);
    else this.runtime.tickets = {};
    this.routeDuels(world, now);

    // ---- partidas en curso: un bot con partida viva SIEMPRE vuelve a ella
    // (le emparejó una persona justo al rendirse, o el proceso se reinició).
    for (const lm of world.liveMatches) {
      const bot = this.bots.find((b) => b.id === lm.botId);
      if (!bot || bot.state === 'OFFLINE' || (bot.state === 'IN_DUEL' && bot.activity.matchId === lm.matchId)) continue;
      if (bot.activity.kind === 'queue') await this.ports.cancelSearch(bot.id);
      this.enterMatch(bot, lm.matchId, lm.gameId, now);
    }

    // ---- los que les toca
    // Una vuelta nunca dura más de 8 s de reloj: el turno dura 20, así que no
    // puede caducar a mitad y dejar a dos procesos moviendo los mismos bots.
    const started = Date.now();
    const due = online().filter((b) => b.nextActionAt <= now).sort((a, b) => a.nextActionAt - b.nextActionAt);
    for (const bot of due.slice(0, this.cfg.maxStepsPerTick)) {
      if (Date.now() - started > 8000) break;
      try {
        await this.step(bot, world, event, now);
      } catch (error) {
        console.error('[bots] paso de', bot.username, error instanceof Error ? error.message : error);
        bot.nextActionAt = now + randInt(this.rng, 5000, 15000);
      }
      this.touch(bot);
      report.steps++;
    }

    // ---- latidos
    await this.heartbeats(now);

    // ---- métricas y guardado
    this.actions += report.steps;
    const minute = String(Math.floor(now / 60_000));
    rt.actions[minute] = (rt.actions[minute] ?? 0) + report.steps;
    for (const k of Object.keys(rt.actions)) if (Number(k) < Number(minute) - 10) delete rt.actions[k];
    await this.flush(now);

    const live = online();
    report.online = live.length;
    report.target = rt.target;
    report.left = report.left || 0;
    const nextAction = live.reduce((m, b) => Math.min(m, b.nextActionAt), now + 3000);
    report.nextInMs = clamp(Math.min(nextAction, rt.nextJoinAt || now + 3000) - now, 250, 3000);
    return report;
  }

  // ------------------------------------------------------------------ entrar y salir

  private async join(now: number): Promise<boolean> {
    if (this.bots.filter((b) => b.state !== 'OFFLINE').length >= this.cfg.maxOnline) return false;
    const ready = this.bots.filter((b) => b.state === 'OFFLINE' && b.nextOnlineAt <= now);
    let bot: Bot | null = ready.length ? pick(this.rng, ready) : null;
    if (!bot && this.bots.length < this.cfg.poolSize) bot = await this.create(now);
    if (!bot) return false;
    await this.login(bot, now);
    return true;
  }

  /** Un bot nuevo: nombre libre, personalidad, saldo coherente, avatar y dispositivo. */
  private async create(now: number): Promise<Bot | null> {
    const taken = await this.ports.takenNames();
    for (const b of this.bots) taken.add(b.username.toLowerCase());
    const username = generateUsername(this.rng, taken);
    if (!username) return null;
    const personality = pickPersonality(this.rng);
    const def = defFor(personality);
    const bot: Bot = {
      id: uuid(this.rng),
      username,
      personality,
      state: 'OFFLINE',
      walletCents: startingWallet(this.rng, def),
      rounds: randInt(this.rng, 0, 400),
      biggestWinCents: 0,
      avatarId: chance(this.rng, 0.9) ? randInt(this.rng, 0, 9) : randInt(this.rng, 10, 29),
      friendCode: randomId(this.rng, 8).toUpperCase(),
      platform: weighted(this.rng, [['android', 60], ['windows', 24], ['ios', 16]] as const),
      rhythm: Math.round(uniform(this.rng, 0.7, 1.5) * 100) / 100,
      onlineSince: 0,
      sessionEndsAt: 0,
      nextOnlineAt: now,
      nextActionAt: now,
      lastHeartbeatAt: 0,
      lastBonusAt: 0,
      activity: {},
      stats: emptyStats(),
      progress: emptyProgress(),
      version: 0,
    };
    if (!(await this.ports.insertBot(bot))) return null;
    this.bots.push(bot);
    return bot;
  }

  private async login(bot: Bot, now: number) {
    const def = defFor(bot.personality);
    bot.state = 'IDLE';
    bot.activity = {};
    bot.onlineSince = now;
    bot.sessionEndsAt = now + minutes(this.rng, def.sessionMinutes);
    bot.nextActionAt = now + randInt(this.rng, 800, 6500);
    bot.lastHeartbeatAt = 0;
    bot.stats = { ...emptyStats(), ...bot.stats, sessions: (bot.stats?.sessions ?? 0) + 1 };
    // Lo primero que hace casi todo el mundo al entrar: la ruleta y el regalo.
    rollDay(bot.progress, this.rng, now);
    let got: MetaGain = { cents: 0, cosmetics: [], notes: [] };
    if (chance(this.rng, 0.85)) got = merge(got, spinWheel(bot.progress, this.rng, now));
    if (chance(this.rng, 0.8)) got = merge(got, collectGift(bot.progress, now));
    this.applyMeta(bot, got);
    const look = maybeEquip(bot.progress, this.rng);
    if (look.avatarId !== null) bot.avatarId = look.avatarId;
    await this.collectGrants(bot);
    this.touch(bot);
  }

  private async logout(bot: Bot, now: number) {
    if (bot.activity.kind === 'queue') await this.ports.cancelSearch(bot.id);
    const def = defFor(bot.personality);
    bot.state = 'OFFLINE';
    bot.activity = {};
    // Sin dinero no vuelve hasta que tenga la ruleta y el regalo del día siguiente.
    const broke = bot.walletCents < LOW_WALLET_CENTS;
    const rest = minutes(this.rng, def.restMinutes);
    bot.nextOnlineAt = now + (broke ? Math.max(rest, 8 * 3600_000) : rest);
    bot.lastHeartbeatAt = 0;
    this.touch(bot);
    await this.ports.publish([bot], now);
  }

  /** BOTS_ENABLED=false: todos fuera, sin dejar a nadie esperando. */
  private async shutdown(now: number): Promise<number> {
    let n = 0;
    const world = await this.ports.world(this.bots.filter((b) => b.state !== 'OFFLINE').map((b) => b.id), now);
    for (const d of world.openDuels) {
      const bot = this.bots.find((b) => b.id === d.opponentId);
      if (bot && d.status === 'pending') await this.ports.respondDuel(bot.id, d.id, false);
    }
    for (const bot of this.bots) {
      if (bot.state === 'OFFLINE') continue;
      await this.ports.cancelSearch(bot.id);
      const match = await this.ports.activeMatch(bot.id);
      if (match) await this.ports.applyMatch(bot.id, match, 'forfeit');
      await this.logout(bot, now);
      n++;
    }
    await this.flush(now, true);
    return n;
  }

  // ------------------------------------------------------------------ dinero

  private async collectGrants(bot: Bot) {
    const cents = await this.ports.claimGrants(bot.id);
    if (!cents) return;
    bot.walletCents = Math.max(0, bot.walletCents + cents);
    if (cents > 0) bot.stats.wonCents += cents;
    this.touch(bot);
  }

  private applyMeta(bot: Bot, got: MetaGain) {
    if (got.cents > 0) {
      bot.walletCents += got.cents;
      bot.stats.bonuses += got.notes.length;
    }
  }

  /** Lo que tiene comprometido en retos (no puede gastarlo dos veces). */
  private reserved(bot: Bot, world: World, exceptDuel = ''): number {
    let n = 0;
    for (const d of world.openDuels) {
      if (d.id === exceptDuel) continue;
      const mine = d.challengerId === bot.id || (d.opponentId === bot.id && d.status === 'active');
      if (mine) n += d.stakeCents;
    }
    return n;
  }

  private available(bot: Bot, world: World, exceptDuel = ''): number {
    return Math.max(0, bot.walletCents - this.reserved(bot, world, exceptDuel));
  }

  // ------------------------------------------------------------------ desafíos de personas

  private considerTickets(world: World, now: number) {
    const rt = this.runtime;
    for (const [k, v] of Object.entries(rt.tickets)) if (v.nextAt < now - TICKET_MEMORY_MS) delete rt.tickets[k];
    const free = this.bots.filter((b) => FREE.has(b.state) && b.sessionEndsAt > now);
    for (const t of world.humanTickets) {
      const key = t.playerId + '@' + t.joinedAt;
      const seen = rt.tickets[key];
      if (seen && (seen.tries >= 3 || now < seen.nextAt)) continue;
      if (this.bots.some((b) => b.activity.ticketKey === key)) continue;
      if (!free.length) break;
      // Un bot al que le guste ese juego, si lo hay.
      const bot = weighted(this.rng, free.map((b) => [b, (defFor(b.personality).duelGames[t.gameId] ?? 0.4) * (0.5 + defFor(b.personality).duelInterest)] as const));
      free.splice(free.indexOf(bot), 1);
      bot.activity = {
        kind: 'consider_ticket', target: t.playerId, game: t.gameId, mode: t.mode, ticketKey: key, resume: bot.state,
        since: now,
      };
      bot.state = 'LOOKING_FOR_DUEL';
      // No acepta al instante: lo descubre y se lo piensa.
      bot.nextActionAt = now + Math.round(uniform(this.rng, 4, 30) * 1000);
      rt.tickets[key] = { tries: (seen?.tries ?? 0) + 1, nextAt: bot.nextActionAt + Math.round(uniform(this.rng, 6, 20) * 1000) };
      this.touch(bot);
    }
  }

  private async decideTicket(bot: Bot, world: World, now: number) {
    const a = bot.activity;
    const ticket = world.humanTickets.find((t) => t.playerId === a.target && t.playerId + '@' + t.joinedAt === a.ticketKey);
    const back = a.resume && FREE.has(a.resume) ? a.resume : 'IDLE';
    if (!ticket) return this.goTo(bot, back, now);
    const def = defFor(bot.personality);
    const same = world.humanTickets.filter((t) => t.gameId === ticket.gameId && t.mode === ticket.mode).length;
    const free = this.bots.filter((b) => FREE.has(b.state)).length;
    let p = acceptTicketChance(def, world.humansOnline, same, free);
    if (ticket.mode === 'competitive' && def.competitiveShare < 0.3) p *= 0.75;
    if (!def.duelGames[ticket.gameId]) p *= 0.6;
    if (!chance(this.rng, p)) {
      bot.stats.declined++;
      return this.goTo(bot, back, now);
    }
    const matchId = await this.ports.pairWith(bot.id, ticket.playerId, ticket.gameId, ticket.mode);
    if (!matchId) return this.goTo(bot, back, now); // otro (bot o persona) llegó antes
    bot.stats.accepted++;
    this.enterMatch(bot, matchId, ticket.gameId, now);
  }

  // ------------------------------------------------------------------ retos de blackjack

  private routeDuels(world: World, now: number) {
    for (const d of world.openDuels) {
      for (const role of ['challenger', 'opponent'] as const) {
        const id = role === 'challenger' ? d.challengerId : d.opponentId;
        const bot = this.bots.find((b) => b.id === id);
        if (!bot || bot.state === 'OFFLINE' || bot.sessionEndsAt <= now) continue;
        const cards = role === 'challenger' ? d.challengerCards : d.opponentCards;
        const done = role === 'challenger' ? d.challengerDone : d.opponentDone;
        const needsAnswer = role === 'opponent' && d.status === 'pending';
        const needsPlay = !done && cards.length > 0 && (d.status === 'active' || role === 'challenger');
        if (!needsAnswer && !needsPlay) continue;
        // Como a una persona, el aviso de un reto le llega aunque esté en una
        // máquina (entre tirada y tirada). En un 1v1 o en un evento, espera.
        const between = bot.state === 'PLAYING' || bot.state === 'BETTING';
        if (!FREE.has(bot.state) && !between) continue;
        if (bot.activity.kind === 'consider_duel' || bot.activity.kind === 'duel') continue;
        bot.activity = { kind: needsAnswer ? 'consider_duel' : 'duel', duelId: d.id, resume: bot.state, since: now };
        bot.state = 'IN_DUEL';
        bot.nextActionAt = now + Math.round((needsAnswer ? uniform(this.rng, 4, 30) : uniform(this.rng, 2, 8)) * 1000);
        this.touch(bot);
      }
    }
  }

  private async duelStep(bot: Bot, world: World, now: number) {
    const a = bot.activity;
    const back = a.resume && FREE.has(a.resume) ? a.resume : 'IDLE';
    if (!a.duelId) return this.goTo(bot, back, now);
    const def = defFor(bot.personality);
    if (a.kind === 'consider_duel') {
      const d = world.openDuels.find((x) => x.id === a.duelId);
      if (!d || d.status !== 'pending' || d.opponentId !== bot.id) return this.goTo(bot, back, now);
      const fromHuman = !this.bots.some((b) => b.id === d.challengerId);
      if (fromHuman && !this.cfg.allowHuman1v1) {
        await this.ports.respondDuel(bot.id, d.id, false);
        return this.goTo(bot, back, now);
      }
      await this.collectGrants(bot);
      const p = acceptDuelChance(d.stakeCents, this.available(bot, world, d.id), def, fromHuman);
      const accept = chance(this.rng, p);
      const ok = await this.ports.respondDuel(bot.id, d.id, accept);
      if (accept && ok) {
        bot.stats.accepted++;
        bot.stats.duels++;
        bot.activity = { ...a, kind: 'duel' };
        bot.nextActionAt = now + humanDelayMs(this.rng, 3, 0.5, 1.5, 9);
        this.worldAt = 0; // el reto cambió: se vuelve a mirar
        return;
      }
      if (!accept) bot.stats.declined++;
      return this.goTo(bot, back, now);
    }
    // Jugar mi mano, carta a carta.
    const view = await this.ports.duel(bot.id, a.duelId);
    if (!view || view.myDone || !(view.status === 'active' || (view.status === 'pending' && view.role === 'challenger'))) {
      if (view?.outcome === 'win') bot.stats.duelWins++;
      return this.goTo(bot, back, now);
    }
    const action = blackjackHits(view.myCards, def, this.rng) ? 'hit' : 'stand';
    await this.ports.actDuel(bot.id, a.duelId, action);
    this.worldAt = 0;
    bot.nextActionAt = now + humanDelayMs(this.rng, 2.8 * bot.rhythm, 0.5, 1.2, 10);
  }

  private async createDuel(bot: Bot, world: World, now: number): Promise<boolean> {
    const def = defFor(bot.personality);
    let friends = await this.ports.friendsOf(bot.id);
    const onlineBots = this.bots.filter((b) => b.id !== bot.id && b.state !== 'OFFLINE');
    // Hace amigos entre los que ve por ahí (como cualquiera en la clasificación).
    if (friends.filter((f) => onlineBots.some((b) => b.id === f)).length < 2 && onlineBots.length && chance(this.rng, 0.5)) {
      const other = pick(this.rng, onlineBots);
      if (await this.ports.befriend(bot.id, other.id)) friends = [...friends, other.id];
    }
    const botFriends = friends.filter((f) => onlineBots.some((b) => b.id === f && FREE.has(b.state)));
    const humanFriends = this.cfg.allowHuman1v1 ? friends.filter((f) => !this.bots.some((b) => b.id === f)) : [];
    let target = '';
    if (humanFriends.length && chance(this.rng, 0.15)) target = pick(this.rng, humanFriends);
    else if (botFriends.length) target = pick(this.rng, botFriends);
    if (!target) return false;
    await this.collectGrants(bot);
    const stake = chooseBet(this.rng, def, this.available(bot, world), 'blackjack', 50);
    if (!stake) return false;
    const ok = await this.ports.createDuel(bot.id, target, stake);
    if (ok) {
      bot.stats.duels++;
      this.worldAt = 0;
    }
    return ok;
  }

  // ------------------------------------------------------------------ 1 contra 1

  private enterMatch(bot: Bot, matchId: string, gameId: string, now: number) {
    void this.ports.cancelSearch(bot.id).catch(() => undefined);
    bot.state = 'IN_DUEL';
    bot.activity = { kind: 'match', matchId, game: gameId, since: now };
    bot.nextActionAt = now + randInt(this.rng, 700, 2500);
    this.touch(bot);
  }

  private async searchStep(bot: Bot, now: number) {
    const a = bot.activity;
    if (now > (a.until ?? 0)) {
      await this.ports.cancelSearch(bot.id);
      // Puede que justo le hayan emparejado.
      const live = await this.ports.activeMatch(bot.id);
      if (live) return this.enterMatch(bot, live, a.game ?? '', now);
      return this.goTo(bot, chance(this.rng, 0.5) ? 'BROWSING' : 'IDLE', now);
    }
    const r = await this.ports.search(bot.id, a.game ?? 'roulette', a.mode ?? 'casual');
    if (r.kind === 'match') return this.enterMatch(bot, r.matchId, a.game ?? '', now);
    if (r.kind === 'stop') return this.goTo(bot, 'IDLE', now);
    // El ticket caduca a los 12 s sin señales: vuelve antes, cada uno a su ritmo.
    bot.nextActionAt = now + Math.round(uniform(this.rng, 2.2, 5.8) * 1000);
  }

  private async matchStep(bot: Bot, now: number) {
    const a = bot.activity;
    const def = defFor(bot.personality);
    const snap = a.matchId ? await this.ports.readMatch(bot.id, a.matchId, now) : null;
    if (!snap) return this.goTo(bot, 'COOLDOWN', now);
    a.game = snap.def.id;
    if (snap.status === 'done' || snap.state.phase === 'done') {
      const final = snap.settled ? snap : await this.ports.applyMatch(bot.id, snap.matchId, null);
      bot.stats.matches++;
      if ((final ?? snap).outcome === 'win') bot.stats.matchWins++;
      this.worldAt = 0;
      return this.goTo(bot, 'COOLDOWN', now);
    }
    const st = snap.state;
    const move = matchMove(st, snap.side, snap.def, def, this.rng, now);
    const key = st.phase + ':' + st.round;
    if (!move) {
      a.phaseKey = '';
      const wake = Math.max(st.revealUntil, now + 900);
      bot.nextActionAt = Math.min(wake, now + Math.round(uniform(this.rng, 1.4, 3.6) * 1000), st.deadline + 300);
      return;
    }
    if (a.phaseKey !== key || !a.actAt) {
      a.phaseKey = key;
      a.actAt = now + thinkMs(this.rng, move.op, bot.rhythm, now, st.deadline);
      bot.nextActionAt = a.actAt;
      return;
    }
    if (now < a.actAt) {
      bot.nextActionAt = a.actAt;
      return;
    }
    await this.ports.applyMatch(bot.id, snap.matchId, move);
    // Otra jugada en la misma fase (pedir otra carta): se lo vuelve a pensar.
    a.actAt = now + thinkMs(this.rng, move.op, bot.rhythm, now, st.deadline);
    bot.nextActionAt = now + Math.round(uniform(this.rng, 0.9, 2.4) * 1000);
  }

  // ------------------------------------------------------------------ máquinas y eventos

  private playBurst(bot: Bot, def: PersonalityDef, minStake: number, now: number): { played: PlayedRound[]; rounds: RoundIn[]; seconds: number } {
    const a = bot.activity;
    const machine = a.game ?? 'slots';
    const burst = Math.min(a.roundsLeft ?? 1, randInt(this.rng, 1, 4));
    const played: PlayedRound[] = [];
    const rounds: RoundIn[] = [];
    let seconds = 0;
    const world = this.world ?? { humansOnline: 0, humanTickets: [], openDuels: [], liveMatches: [] };
    for (let i = 0; i < burst; i++) {
      // Cambia la apuesta de vez en cuando (nunca diez rondas iguales).
      if (!a.stakeCents || chance(this.rng, 0.3)) a.stakeCents = chooseBet(this.rng, def, this.available(bot, world), machine, minStake) ?? 0;
      const stake = a.stakeCents;
      if (!stake || stake > this.available(bot, world)) break;
      const back = playRound(this.rng, machine, stake, def.risk);
      bot.walletCents = Math.max(0, bot.walletCents - stake + back);
      bot.rounds++;
      bot.stats.roundsPlayed++;
      bot.stats.wageredCents += stake;
      bot.stats.wonCents += back;
      bot.biggestWinCents = Math.max(bot.biggestWinCents, back);
      const secs = roundSeconds(this.rng, machine, bot.rhythm);
      seconds += secs;
      played.push({ machine, stakeCents: stake, returnedCents: back });
      rounds.push({ g: machine, s: stake, r: back, t: 0 });
      // Una buena racha anima a subir; una mala, a bajar (los arriesgados al revés).
      if (back > stake * 5 && chance(this.rng, def.risk)) a.stakeCents = 0;
    }
    // Las rondas "pasan" durante el tiempo que tarda el bot en jugarlas: se fechan hacia atrás.
    let t = now;
    for (let i = rounds.length - 1; i >= 0; i--) {
      rounds[i].t = Math.round(t);
      t -= (seconds / Math.max(1, rounds.length)) * 1000;
    }
    a.roundsLeft = Math.max(0, (a.roundsLeft ?? 0) - played.length);
    const got = recordRounds(bot.progress, played, now);
    this.applyMeta(bot, got);
    return { played, rounds, seconds };
  }

  private async machineStep(bot: Bot, now: number) {
    const def = defFor(bot.personality);
    const { played, seconds } = this.playBurst(bot, def, 0, now);
    if (!played.length || bot.walletCents < LOW_WALLET_CENTS) return this.afterSession(bot, now);
    if ((bot.activity.roundsLeft ?? 0) <= 0) return this.afterSession(bot, now + Math.round(seconds * 1000));
    bot.nextActionAt = now + Math.round(seconds * 1000);
  }

  private async eventStep(bot: Bot, event: Instance | null, now: number) {
    const a = bot.activity;
    const edef = event ? EVENTS.events[event.eventId] : null;
    if (!event || !edef || a.instanceId !== event.id) return this.afterSession(bot, now);
    const def = defFor(bot.personality);
    const minStake = Math.max(EVENTS.limits.minStakeCents, edef.minStakeCents ?? 0);
    const { played, rounds, seconds } = this.playBurst(bot, def, minStake, now);
    if (!played.length) return this.afterSession(bot, now);
    // Fechas dentro del evento y nunca antes de que abriera.
    for (const r of rounds) r.t = Math.max(r.t, event.opensMs + 1000);
    const rep = await this.ports.reportEvent(bot.id, event.id, 'bot-' + randomId(this.rng, 10), rounds);
    if (rep && edef.kind === 'risk' && rep.pot > 0) {
      if (chance(this.rng, 0.15 + 0.45 * def.risk)) await this.ports.eventRisk(bot.id, event.id, 'risk');
      else if (chance(this.rng, 0.35)) await this.ports.eventRisk(bot.id, event.id, 'cash');
    }
    if (rep?.canChest) await this.ports.eventChest(bot.id, event.id);
    if ((a.roundsLeft ?? 0) <= 0 || bot.walletCents < LOW_WALLET_CENTS) {
      // Otra tanda en el evento o cambia de aires.
      if (chance(this.rng, def.eventInterest * 0.8) && bot.walletCents >= minStake) {
        a.roundsLeft = randInt(this.rng, def.roundsPerVisit[0], def.roundsPerVisit[1]);
        a.game = pickMachine(this.rng, def, EVENTS.machines.filter((m) => MACHINES[m]));
        a.stakeCents = 0;
      } else {
        return this.afterSession(bot, now + Math.round(seconds * 1000));
      }
    }
    bot.nextActionAt = now + Math.round(seconds * 1000);
  }

  private afterSession(bot: Bot, at: number) {
    const next = weighted(this.rng, [['BETTING', 2], ['COOLDOWN', 2], ['BROWSING', 2], ['IDLE', 1]] as const);
    this.goTo(bot, next, at);
  }

  // ------------------------------------------------------------------ el paso de un bot

  private goTo(bot: Bot, state: BotState, at: number) {
    const def = defFor(bot.personality);
    bot.state = state;
    bot.activity = {};
    const think = def.thinkSeconds;
    const s = state === 'IDLE' ? think.median * 2
      : state === 'COOLDOWN' ? think.median * 1.3
        : state === 'BROWSING' ? think.median * 0.6
          : think.median * 0.35;
    bot.nextActionAt = at + humanDelayMs(this.rng, s * bot.rhythm, think.sigma, Math.min(2, think.min), think.max * 2);
  }

  private async step(bot: Bot, world: World, event: Instance | null, now: number) {
    const def = defFor(bot.personality);
    rollDay(bot.progress, this.rng, now);

    // Fin de sesión: se va cuando está libre (nunca a mitad de una partida).
    if (FREE.has(bot.state) && now >= bot.sessionEndsAt) return this.logout(bot, now);

    switch (bot.state) {
      case 'PLAYING': return this.machineStep(bot, now);
      case 'EVENT': return this.eventStep(bot, event, now);
      case 'BETTING': return this.startMachine(bot, world, now);
      case 'LOOKING_FOR_DUEL':
        if (bot.activity.kind === 'consider_ticket') return this.decideTicket(bot, world, now);
        if (bot.activity.kind === 'queue') return this.searchStep(bot, now);
        return this.startLooking(bot, world, now);
      case 'IN_DUEL':
        if (bot.activity.kind === 'match') return this.matchStep(bot, now);
        return this.duelStep(bot, world, now);
      default: break;
    }

    // Libre (IDLE, BROWSING, COOLDOWN): ¿y ahora qué?
    if (bot.walletCents < LOW_WALLET_CENTS) {
      const got = merge(spinWheel(bot.progress, this.rng, now), collectGift(bot.progress, now));
      this.applyMeta(bot, got);
      if (bot.walletCents < LOW_WALLET_CENTS) return this.logout(bot, now);
    }
    if (bot.state === 'BROWSING') {
      // Mirando por el casino: a veces se compra el pase o se cambia el título.
      const got: MetaGain = { cents: 0, cosmetics: [], notes: [] };
      const cost = maybeBuyPremium(bot.progress, this.available(bot, world), def, this.rng, got);
      if (cost) {
        bot.walletCents -= cost;
        bot.stats.passesBought++;
      }
      this.applyMeta(bot, got);
      if (chance(this.rng, 0.2)) {
        const look = maybeEquip(bot.progress, this.rng);
        if (look.avatarId !== null) bot.avatarId = look.avatarId;
      }
    }
    if (now - (bot.stats.lastEventClaimAt || 0) > EVENT_CLAIM_EVERY_MS) {
      bot.stats.lastEventClaimAt = now;
      await this.ports.claimEvents(bot.id, now);
    }

    const evDef = event ? EVENTS.events[event.eventId] : null;
    const evMin = evDef ? Math.max(EVENTS.limits.minStakeCents, evDef.minStakeCents ?? 0) : 0;
    const canEvent = !!event && !!evDef && this.available(bot, world) >= evMin * 4;
    const leaveEarly = bot.state === 'COOLDOWN' && chance(this.rng, 0.03);
    if (leaveEarly) return this.logout(bot, now);

    const next = weighted(this.rng, [
      ['IDLE', def.idle * (bot.state === 'IDLE' ? 0.6 : 1)],
      ['BROWSING', bot.state === 'BROWSING' ? def.browse * 0.4 : def.browse],
      ['BETTING', def.play],
      ['EVENT', canEvent ? def.eventInterest * 12 : 0],
      ['LOOKING_FOR_DUEL', this.cfg.allow1v1 ? def.duelInterest * 6 : 0],
    ] as const);

    if (next === 'EVENT' && event && evDef) {
      bot.state = 'EVENT';
      if (bot.activity.instanceId !== event.id) bot.stats.eventsJoined++;
      bot.activity = {
        kind: 'event', instanceId: event.id, since: now, stakeCents: 0,
        game: pickMachine(this.rng, def, EVENTS.machines.filter((m) => MACHINES[m])),
        roundsLeft: randInt(this.rng, def.roundsPerVisit[0], def.roundsPerVisit[1]),
      };
      bot.nextActionAt = now + humanDelayMs(this.rng, 3 * bot.rhythm, 0.5, 1, 15);
      return;
    }
    if (next === 'BETTING') {
      bot.state = 'BETTING';
      bot.activity = {};
      bot.nextActionAt = now + humanDelayMs(this.rng, 2.5 * bot.rhythm, 0.5, 1, 12);
      return;
    }
    if (next === 'LOOKING_FOR_DUEL') {
      bot.state = 'LOOKING_FOR_DUEL';
      bot.activity = {};
      bot.nextActionAt = now + humanDelayMs(this.rng, 2 * bot.rhythm, 0.5, 0.8, 10);
      return;
    }
    this.goTo(bot, next, now);
  }

  private async startMachine(bot: Bot, world: World, now: number) {
    const def = defFor(bot.personality);
    const machine = pickMachine(this.rng, def);
    const stake = chooseBet(this.rng, def, this.available(bot, world), machine);
    if (!stake) return this.goTo(bot, 'IDLE', now);
    bot.state = 'PLAYING';
    bot.activity = {
      kind: 'machine', game: machine, stakeCents: stake, since: now,
      roundsLeft: randInt(this.rng, def.roundsPerVisit[0], def.roundsPerVisit[1]),
    };
    bot.nextActionAt = now + humanDelayMs(this.rng, 3 * bot.rhythm, 0.5, 1, 14);
  }

  private async startLooking(bot: Bot, world: World, now: number) {
    const def = defFor(bot.personality);
    // Antes de nada, ¿ya está en una partida (le emparejó una persona)? Se vuelve a ella.
    const live = await this.ports.activeMatch(bot.id);
    if (live) return this.enterMatch(bot, live, '', now);
    if (chance(this.rng, 0.28) && (await this.createDuel(bot, world, now))) return this.goTo(bot, 'IDLE', now);
    const game = weighted(this.rng, Object.entries(def.duelGames));
    const mode = chance(this.rng, def.competitiveShare) ? 'competitive' : 'casual';
    bot.activity = {
      kind: 'queue', game, mode, since: now,
      // No espera para siempre: cada uno tiene su paciencia.
      until: now + Math.round(uniform(this.rng, 20, 80) * 1000),
    };
    return this.searchStep(bot, now);
  }

  // ------------------------------------------------------------------ latidos

  private async heartbeats(now: number) {
    const due = this.bots.filter((b) => b.state !== 'OFFLINE' && (
      !b.lastHeartbeatAt || now - b.lastHeartbeatAt >= heartbeatEvery(b) || (this.dirty.has(b.id) && now - b.lastHeartbeatAt > 4000)
    ));
    if (!due.length) return;
    for (const b of due) b.lastHeartbeatAt = now;
    await this.ports.publish(due, now);
  }
}

/** Cada bot late a su ritmo (14-30 s): dentro de la ventana de "conectado" de todo el mundo. */
function heartbeatEvery(bot: Bot): number {
  let h = 0;
  for (let i = 0; i < bot.id.length; i++) h = (h * 31 + bot.id.charCodeAt(i)) >>> 0;
  return 14_000 + (h % 16_000);
}

/** La máquina que ve el panel mientras el bot hace lo que hace. */
export function playingOf(bot: Bot): string | null {
  if (bot.state === 'OFFLINE') return null;
  const a = bot.activity;
  if ((bot.state === 'PLAYING' || bot.state === 'EVENT' || bot.state === 'BETTING') && a.game) return a.game;
  if (bot.state === 'IN_DUEL') return a.kind === 'match' ? DUEL_MACHINES[a.game ?? ''] ?? 'sala' : 'blackjack';
  return 'sala';
}

function uuid(rng: Rng): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(rng() * 16)];
  return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-' + h[8 + Math.floor(rng() * 4)] + s.slice(17, 20) + '-' + s.slice(20, 32);
}

export type { HumanTicket, OpenDuel };
