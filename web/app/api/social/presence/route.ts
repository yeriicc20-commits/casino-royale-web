import { body, claimIdentity, corsPreflight, currentUser, db, fail, int, json,
  needsAccount, text } from '@/lib/online';
import { guardOnlineAccess } from '@/lib/versions';
import { impossibleJump } from '@/lib/anticheat';

/**
 * POST /api/social/presence
 *   { playerId, name, avatarId, friendCode, balanceCents, biggestWinCents, rounds }
 *
 * El "estoy aquí" del juego. Hace dos cosas: marca la hora para que los amigos
 * te vean conectado, y publica el saldo con el que se ordena la clasificación.
 *
 * El saldo llega del cliente, así que no es de fiar. Se acepta porque el dinero
 * es ficticio y la clasificación es un adorno; el día que haya algo en juego,
 * el sitio donde validarlo es aquí y no en el móvil.
 *
 * Un código de amigo que ya tenga otro jugador NO se roba: el que llega tarde
 * se queda sin código publicado antes que romperle el suyo a quien lo tenía.
 *
 * La respuesta lleva además los ajustes que el panel haya dejado anotados para
 * este jugador. Van aquí y no en una ruta propia porque el latido ya existe, ya
 * ocurre cada treinta segundos y ya sabe quién llama: una segunda petición solo
 * añadiría latencia y otra cosa que puede fallar por separado.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Versiones demasiado viejas o modo mantenimiento: fuera del online.
  const rejected = await guardOnlineAccess(request);
  if (rejected) return json(rejected.body, rejected.status);

  const user = await currentUser(request);
  if (!user) return needsAccount();

  const input = await body<Record<string, unknown>>(request);

  const client = db();

  // Si la cuenta ya tiene su fila en el online, se usa ESA. Antes, si el id que
  // devolvía claimIdentity no coincidía con el de la fila existente, el upsert
  // chocaba con el índice único de user_id y la presencia fallaba SIEMPRE: el
  // saldo no se publicaba nunca y el ranking enseñaba 1000 € a todo el mundo.
  const { data: mine } = await client
    .from('online_players').select('player_id').eq('user_id', user.id).maybeSingle();
  const playerId = mine
    ? String((mine as { player_id: string }).player_id)
    : await claimIdentity(user.id, text(input.playerId, 64), text(input.name, 16));

  let friendCode: string | null = text(input.friendCode, 16).toUpperCase() || null;

  if (friendCode) {
    const { data: taken } = await client
      .from('online_players')
      .select('player_id')
      .eq('friend_code', friendCode)
      .neq('player_id', playerId)
      .maybeSingle();

    if (taken) friendCode = null;
  }

  const row: Record<string, unknown> = {
    player_id: playerId,
    user_id: user.id,
    name: text(input.name, 16) || 'Jugador',
    avatar_id: int(input.avatarId),
    balance_cents: int(input.balanceCents),
    biggest_win_cents: int(input.biggestWinCents),
    rounds: int(input.rounds),
    last_seen: new Date().toISOString(),
  };

  // Lo que lleva puesto (pase de temporada): título y marco, para el ranking.
  // Solo ids cortos con letras, números y guion bajo.
  const cosmetic = (v: unknown) => {
    const s = text(v, 40);
    return /^[a-z0-9_]*$/.test(s) ? s : '';
  };
  const looks: Record<string, unknown> = { title_id: cosmetic(input.titleId), frame_id: cosmetic(input.frameId) };
  // En que maquina esta (panel en vivo). Va con "looks" para que, si falta la
  // columna (15_panel_vivo.sql sin ejecutar), el reintento de abajo la quite.
  const game = text(input.game, 24).toLowerCase();
  if (/^[a-z0-9_]+$/.test(game)) looks.playing = game;

  // Saldo imposible para el podio (juego modificado): se queda el de antes.
  const { data: before } = await client
    .from('online_players')
    .select('balance_cents, rounds, last_seen')
    .eq('player_id', playerId)
    .maybeSingle();
  let flagged: string | null = null;
  if (before) {
    const why = await impossibleJump(
      { balanceCents: Number(before.balance_cents || 0), rounds: Number(before.rounds || 0), at: Date.parse(String(before.last_seen)) || Date.now() },
      { balanceCents: Number(row.balance_cents || 0), rounds: Number(row.rounds || 0), at: Date.now() },
      [playerId],
    );
    if (why) {
      flagged = why;
      console.warn('[social/presence] saldo ignorado', playerId, why);
      row.balance_cents = Number(before.balance_cents || 0);
      row.rounds = Number(before.rounds || 0);
    }
  }

  // Solo se toca el código cuando hay uno válido que poner. Mandar null en el
  // upsert borraría el que ya tuviera guardado.
  if (friendCode) row.friend_code = friendCode;

  let { error } = await client
    .from('online_players')
    .upsert({ ...row, ...looks }, { onConflict: 'player_id' });

  // Sin las columnas del pase (falta ejecutar 14_pase_temporada.sql): se publica
  // igual, sin título ni marco. El ranking no puede dejar de funcionar por esto.
  if (error && /title_id|frame_id|playing|column/i.test(String(error.message || ''))) {
    ({ error } = await client.from('online_players').upsert(row, { onConflict: 'player_id' }));
  }

  if (error) {
    console.error('[social/presence]', error);
    return fail('No se pudo publicar la presencia: ' + String(error.message || '').slice(0, 160));
  }

  await logActivity(client, playerId, before, row, flagged, game);

  return json({ ok: true, message: '', grants: await claimGrants(client, playerId) });
}

/**
 * Historial para el panel en vivo: cada vez que cambia el saldo (o las rondas)
 * se apunta cuanto, con cuantas rondas y en que maquina. Asi se ve si alguien
 * sube dinero sin jugar o mas rapido de lo posible. Si la tabla no existe
 * (15_panel_vivo.sql sin ejecutar) no pasa nada: la presencia sigue igual.
 */
async function logActivity(
  client: ReturnType<typeof db>,
  playerId: string,
  before: { balance_cents?: unknown; rounds?: unknown } | null,
  row: Record<string, unknown>,
  flagged: string | null,
  game: string,
) {
  try {
    const bal = Number(row.balance_cents || 0);
    const rounds = Number(row.rounds || 0);
    const prevBal = before ? Number(before.balance_cents || 0) : bal;
    const prevRounds = before ? Number(before.rounds || 0) : rounds;
    const delta = bal - prevBal;
    const roundsDelta = Math.max(0, rounds - prevRounds);
    if (before && delta === 0 && roundsDelta === 0 && !flagged) return;
    let note = flagged;
    if (!note && before && delta > 0 && roundsDelta === 0) note = 'Sube sin jugar (¿ajuste del panel o regalo?)';
    const { error } = await client.from('online_activity').insert({
      player_id: playerId,
      balance_cents: bal,
      delta_cents: delta,
      rounds,
      rounds_delta: roundsDelta,
      game: /^[a-z0-9_]+$/.test(game) ? game : null,
      flag: note,
    });
    if (error && !/online_activity/.test(String(error.message || ''))) console.error('[social/presence] actividad', error.message);
  } catch {
    /* el historial nunca tumba la presencia */
  }
}

/** Una fila de la cola de ajustes, ya marcada como entregada. */
interface GrantRow {
  id: number | string;
  amount_cents: number | string;
  reason: string | null;
}

/**
 * Recoge lo que el panel le deba a este jugador.
 *
 * Reclamar y marcar como entregado ocurren dentro de la misma sentencia SQL, así
 * que el móvil y el PC de la misma persona no pueden llevarse el mismo apunte
 * dos veces.
 *
 * Un fallo aquí NO tumba la presencia: el latido sirve sobre todo para que te
 * vean conectado, y perder eso por un ajuste que puede esperar treinta segundos
 * sería un mal cambio. También es lo que hace que la ruta siga funcionando antes
 * de haber ejecutado `09_panel_admin.sql`, cuando la función todavía no existe.
 */
async function claimGrants(client: ReturnType<typeof db>, playerId: string) {
  const { data, error } = await client.rpc('online_grant_claim', { p_player_id: playerId });

  if (error) {
    console.error('[social/presence] grants', error.message);
    return [];
  }

  return ((data ?? []) as GrantRow[]).map((row) => ({
    id: Number(row.id),
    amountCents: Number(row.amount_cents),
    reason: String(row.reason ?? ''),
  }));
}

export async function OPTIONS() {
  return corsPreflight();
}
