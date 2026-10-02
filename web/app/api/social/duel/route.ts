import {
  body, corsPreflight, currentUser, db, json, needsAccount, text,
} from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { handValue, isBlackjack, shuffledDeck, winnerOf } from '@/lib/duel';

/**
 * POST /api/social/duel   { op, ... }
 *
 * Retos de blackjack entre amigos. Una sola ruta con varias operaciones:
 *
 *   { op: "list" }                                   mis retos (y lo que me deban pagar)
 *   { op: "create", friendId, stakeCents }           retar a un amigo
 *   { op: "respond", duelId, accept }                aceptar o rechazar
 *   { op: "act", duelId, action: "hit" | "stand" }   pedir carta o plantarse
 *
 * El mazo y las cartas del otro nunca salen del servidor hasta que los dos han
 * terminado. Siempre responde 200 (ver lib/online.ts): una negativa razonada
 * viaja en { ok:false, message }.
 */
export const dynamic = 'force-dynamic';

const MIN_STAKE_CENTS = 50;          // 0,50 €, la apuesta minima del casino
const MAX_OPEN_PER_PLAYER = 6;
const EXPIRE_MS = 48 * 3600 * 1000;  // dos dias sin moverse: se cierra solo

interface DuelRow {
  id: string;
  challenger_id: string;
  opponent_id: string;
  stake_cents: number;
  status: string;
  deck: string[];
  challenger_cards: string[];
  opponent_cards: string[];
  challenger_done: boolean;
  opponent_done: boolean;
  result: string;
  created_at: string;
  updated_at: string;
}

type Role = 'challenger' | 'opponent';

function fail(message: string) {
  return json({ ok: false, message, duels: [], grants: [] });
}

function money(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Lo que ve un jugador de un reto: sus cartas siempre; las del otro, al final. */
function view(row: DuelRow, me: string, names: Map<string, string>) {
  const role: Role = row.challenger_id === me ? 'challenger' : 'opponent';
  const mine = role === 'challenger' ? row.challenger_cards : row.opponent_cards;
  const theirs = role === 'challenger' ? row.opponent_cards : row.challenger_cards;
  const myDone = role === 'challenger' ? row.challenger_done : row.opponent_done;
  const theirDone = role === 'challenger' ? row.opponent_done : row.challenger_done;
  const otherId = role === 'challenger' ? row.opponent_id : row.challenger_id;
  const finished = row.status === 'done';

  let outcome = '';
  if (finished) outcome = row.result === 'push' ? 'push' : row.result === role ? 'win' : 'lose';

  return {
    id: row.id,
    role,
    friendId: otherId,
    friendName: names.get(otherId) || 'Jugador',
    stakeCents: Number(row.stake_cents),
    status: row.status,
    myCards: mine,
    myTotal: handValue(mine),
    myDone,
    theirCards: finished ? theirs : [],
    theirCount: theirs.length,
    theirTotal: finished ? handValue(theirs) : 0,
    theirDone,
    outcome,
    // Me toca: aceptar (si me han retado y esta pendiente) o jugar mi mano.
    canRespond: row.status === 'pending' && role === 'opponent',
    canPlay: !myDone && mine.length > 0 && (row.status === 'active' || (row.status === 'pending' && role === 'challenger')),
    createdAt: row.created_at,
  };
}

async function namesFor(ids: string[]) {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data } = await db().from('online_players').select('player_id, name').in('player_id', [...new Set(ids)]);
  for (const r of (data ?? []) as { player_id: string; name: string }[]) names.set(String(r.player_id), r.name || 'Jugador');
  return names;
}

async function balanceOf(playerId: string): Promise<number> {
  const client = db();
  const { data } = await client.from('online_players').select('balance_cents').eq('player_id', playerId).maybeSingle();
  const base = data ? Number((data as { balance_cents: number }).balance_cents || 0) : 0;
  // Lo que ya tiene pendiente de cobrar o pagar cuenta.
  const { data: pending } = await client.from('online_grants').select('amount_cents')
    .eq('player_id', playerId).is('delivered_at', null);
  return base + (pending ?? []).reduce((n, r) => n + Number((r as { amount_cents: number }).amount_cents || 0), 0);
}

async function adjust(playerId: string, cents: number, reason: string) {
  const client = db();
  const { error } = await client.rpc('admin_adjust_player', {
    p_player_id: playerId, p_amount_cents: cents, p_reason: reason, p_actor: null,
  });
  if (!error) return;
  // Sin la funcion del panel: se apunta directamente en la cola.
  await client.from('online_grants').insert({ player_id: playerId, amount_cents: cents, reason });
}

/** Guarda solo si nadie lo ha tocado entre medias (dos toques seguidos, dos moviles). */
async function save(row: DuelRow, changes: Partial<DuelRow>): Promise<DuelRow | null> {
  const next = { ...changes, updated_at: new Date().toISOString() };
  const { data, error } = await db().from('online_duels').update(next)
    .eq('id', row.id).eq('updated_at', row.updated_at).select('*').maybeSingle();
  if (error || !data) return null;
  return data as DuelRow;
}

/** Si los dos han terminado, se decide y se paga. Una sola vez. */
async function settleIfReady(row: DuelRow, names: Map<string, string>): Promise<DuelRow> {
  if (row.status !== 'active' || !row.challenger_done || !row.opponent_done) return row;
  const result = winnerOf(row.challenger_cards, row.opponent_cards);
  const saved = await save(row, { status: 'done', result, settled_at: new Date().toISOString() } as Partial<DuelRow>);
  if (!saved) return row;
  if (result !== 'push') {
    const winner = result === 'challenger' ? row.challenger_id : row.opponent_id;
    const loser = result === 'challenger' ? row.opponent_id : row.challenger_id;
    const stake = Number(row.stake_cents);
    await adjust(loser, -stake, 'Reto de blackjack perdido contra ' + (names.get(winner) || 'tu amigo'));
    await adjust(winner, stake, 'Reto de blackjack ganado a ' + (names.get(loser) || 'tu amigo'));
  }
  return saved;
}

/** Retos que llevan demasiado parados: pendientes caducan, activos se plantan solos. */
async function expireOld(rows: DuelRow[], names: Map<string, string>): Promise<DuelRow[]> {
  const now = Date.now();
  const out: DuelRow[] = [];
  for (let row of rows) {
    const idle = now - new Date(row.updated_at).getTime();
    if (idle > EXPIRE_MS && row.status === 'pending') {
      row = (await save(row, { status: 'expired' })) ?? row;
    } else if (idle > EXPIRE_MS && row.status === 'active') {
      const s = await save(row, { challenger_done: true, opponent_done: true });
      if (s) row = await settleIfReady(s, names);
    }
    out.push(row);
  }
  return out;
}

async function claimGrants(playerId: string) {
  const { data, error } = await db().rpc('online_grant_claim', { p_player_id: playerId });
  if (error || !data) return [];
  return (data as { id: number; amount_cents: number; reason: string }[])
    .map((g) => ({ id: Number(g.id), amountCents: Number(g.amount_cents), reason: g.reason || '' }));
}

async function list(me: string) {
  const client = db();
  const { data, error } = await client.from('online_duels').select('*')
    .or(`challenger_id.eq.${me},opponent_id.eq.${me}`)
    .order('created_at', { ascending: false }).limit(30);
  if (error) {
    // La tabla no existe todavia (falta el SQL 11).
    return fail('Los retos aún no están activados en el servidor.');
  }
  let rows = (data ?? []) as DuelRow[];
  const names = await namesFor(rows.flatMap((r) => [r.challenger_id, r.opponent_id]));
  rows = await expireOld(rows, names);
  // Lo cobrado o pagado en retos llega ya, sin esperar al siguiente latido.
  const grants = await claimGrants(me);
  return json({ ok: true, message: '', duels: rows.map((r) => view(r, me, names)), grants });
}

async function load(id: string): Promise<DuelRow | null> {
  const { data } = await db().from('online_duels').select('*').eq('id', id).maybeSingle();
  return (data as DuelRow) ?? null;
}

export async function POST(request: Request) {
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();
  const me = user.id;

  const input = await body<{ op?: string; friendId?: string; stakeCents?: number; duelId?: string; accept?: boolean; action?: string }>(request);
  const op = text(input.op, 16);
  const client = db();

  if (op === 'list' || !op) return list(me);

  if (op === 'create') {
    const friendId = text(input.friendId, 64);
    const stake = Math.floor(Number(input.stakeCents) || 0);
    if (!friendId || friendId === me) return fail('Elige a un amigo.');
    if (stake < MIN_STAKE_CENTS) return fail('La apuesta mínima es ' + money(MIN_STAKE_CENTS) + '.');

    const { data: link } = await client.from('online_friends').select('friend_id')
      .eq('player_id', me).eq('friend_id', friendId).maybeSingle();
    if (!link) return fail('Solo puedes retar a tus amigos.');

    const { count, error: countError } = await client.from('online_duels').select('id', { count: 'exact', head: true })
      .eq('challenger_id', me).in('status', ['pending', 'active']);
    if (countError) return fail('Los retos aún no están activados en el servidor.');
    if ((count ?? 0) >= MAX_OPEN_PER_PLAYER) return fail('Ya tienes ' + MAX_OPEN_PER_PLAYER + ' retos abiertos. Termina alguno antes.');

    if ((await balanceOf(me)) < stake) return fail('No tienes ' + money(stake) + ' en tu saldo en línea.');
    if ((await balanceOf(friendId)) < stake) return fail('Tu amigo no tiene ' + money(stake) + ' para cubrir la apuesta.');

    const deck = shuffledDeck();
    const mine = [deck.pop()!, deck.pop()!];
    const { error } = await client.from('online_duels').insert({
      challenger_id: me, opponent_id: friendId, stake_cents: stake, status: 'pending',
      deck, challenger_cards: mine, challenger_done: isBlackjack(mine),
    });
    if (error) return fail('No se ha podido crear el reto.');
    return list(me);
  }

  const duelId = text(input.duelId, 64);
  const row = duelId ? await load(duelId) : null;
  if (!row || (row.challenger_id !== me && row.opponent_id !== me)) return fail('Ese reto no existe.');
  const role: Role = row.challenger_id === me ? 'challenger' : 'opponent';
  const names = await namesFor([row.challenger_id, row.opponent_id]);

  if (op === 'respond') {
    if (row.status !== 'pending') return fail('Ese reto ya no está pendiente.');
    if (role === 'challenger') {
      // El que reta puede retirarlo mientras nadie lo ha aceptado.
      if (input.accept === false) await save(row, { status: 'cancelled' });
      return list(me);
    }
    if (input.accept === false) {
      await save(row, { status: 'declined' });
      return list(me);
    }
    const stake = Number(row.stake_cents);
    if ((await balanceOf(me)) < stake) return fail('No tienes ' + money(stake) + ' en tu saldo en línea.');
    if ((await balanceOf(row.challenger_id)) < stake) return fail('Quien te retó ya no tiene ' + money(stake) + '.');
    const deck = [...row.deck];
    const mine = [deck.pop()!, deck.pop()!];
    const saved = await save(row, { status: 'active', deck, opponent_cards: mine, opponent_done: isBlackjack(mine) });
    if (!saved) return fail('Alguien ha tocado el reto a la vez. Inténtalo otra vez.');
    await settleIfReady(saved, names);
    return list(me);
  }

  if (op === 'act') {
    const action = text(input.action, 8);
    const cardsKey = role === 'challenger' ? 'challenger_cards' : 'opponent_cards';
    const doneKey = role === 'challenger' ? 'challenger_done' : 'opponent_done';
    const mine = [...(row[cardsKey] as string[])];
    if (row[doneKey]) return fail('Ya has terminado tu mano.');
    if (!(row.status === 'active' || (row.status === 'pending' && role === 'challenger'))) return fail('Ese reto no se puede jugar ahora.');

    const changes: Partial<DuelRow> = {};
    if (action === 'hit') {
      const deck = [...row.deck];
      const card = deck.pop();
      if (!card) return fail('No quedan cartas.');
      mine.push(card);
      changes.deck = deck;
      (changes as Record<string, unknown>)[cardsKey] = mine;
      if (handValue(mine) >= 21) (changes as Record<string, unknown>)[doneKey] = true;
    } else if (action === 'stand') {
      (changes as Record<string, unknown>)[doneKey] = true;
    } else {
      return fail('Acción desconocida.');
    }
    const saved = await save(row, changes);
    if (!saved) return fail('Alguien ha tocado el reto a la vez. Inténtalo otra vez.');
    await settleIfReady(saved, names);
    return list(me);
  }

  return fail('Operación desconocida.');
}

export async function OPTIONS() {
  return corsPreflight();
}
