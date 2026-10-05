-- ============================================================================
--  17. Jugadores bot
-- ============================================================================
--
--  Se ejecuta DESPUES de 01..16. Es idempotente: se puede ejecutar varias veces.
--
--  Que son
--  -------
--  Jugadores que maneja el servidor (lib/bots) y que juegan con los MISMOS
--  sistemas que una persona: su fila en online_players (presencia, saldo,
--  clasificacion, amigos), la cola de emparejamiento del 1 contra 1, las
--  partidas, los retos de blackjack, los eventos y la cola de ajustes de saldo.
--  No hay un casino aparte para ellos.
--
--  El dinero es ficticio, igual que el de todo el juego.
--
--  Como se distinguen de una persona
--  ---------------------------------
--    online_players.is_bot = true    en la fila publica, para el panel y las
--                                    estadisticas (nunca sale hacia el juego)
--    online_bots                     lo que solo tiene un bot: personalidad,
--                                    estado, su "monedero" (el equivalente a
--                                    la partida guardada del movil), sesion...
--
--  El player_id de un bot es un uuid normal, como el de una cuenta: desde el
--  juego no se distingue, y desde el servidor basta mirar is_bot.
--
--  Nada de esto lo toca el juego. RLS activado y sin politicas, como el resto
--  del online: solo el servidor (clave de servicio).
-- ============================================================================


-- ------------------------------------------------------------ 1. la marca

alter table public.online_players
    add column if not exists is_bot boolean not null default false;

create index if not exists online_players_bots_idx
    on public.online_players (last_seen desc) where is_bot;


-- ------------------------------------------------------------ 2. los bots

create table if not exists public.online_bots (
    player_id          text primary key
                       references public.online_players (player_id)
                       on update cascade on delete cascade,

    username           text not null,
    personality        text not null,

    -- OFFLINE, IDLE, BROWSING, BETTING, PLAYING, EVENT, LOOKING_FOR_DUEL,
    -- IN_DUEL, COOLDOWN
    status             text not null default 'OFFLINE',

    -- El saldo "de verdad" del bot: lo que en una persona vive en el movil.
    -- online_players.balance_cents es la copia publicada, como con todos.
    wallet_cents       bigint  not null default 0,
    rounds             integer not null default 0,
    biggest_win_cents  bigint  not null default 0,

    avatar_id          integer not null default 0,
    friend_code        text    not null default '',
    platform           text    not null default 'android',
    -- Ritmo propio (0,7 = rapido ... 1,5 = pausado): cada bot va a su aire.
    rhythm             real    not null default 1,

    online_since       timestamptz,
    session_ends_at    timestamptz,
    next_online_at     timestamptz not null default now(),
    next_action_at     timestamptz not null default now(),
    last_heartbeat_at  timestamptz,
    last_bonus_at      timestamptz,

    -- Lo que esta haciendo ahora (maquina, apuesta, partida, reto...).
    activity           jsonb not null default '{}'::jsonb,
    stats              jsonb not null default '{}'::jsonb,
    -- Ruleta y regalo diarios, misiones, pase de temporada y cosmeticos: lo que
    -- en una persona va dentro de la partida guardada del movil.
    progress           jsonb not null default '{}'::jsonb,

    -- Control de version: dos escrituras cruzadas no se pisan.
    version            integer not null default 0,

    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint online_bots_wallet_nonnegative check (wallet_cents >= 0)
);

-- Por si la tabla se creo con una version anterior de este fichero.
alter table public.online_bots add column if not exists progress jsonb not null default '{}'::jsonb;

create unique index if not exists online_bots_username_idx
    on public.online_bots (lower(username));

create index if not exists online_bots_status_idx
    on public.online_bots (status, next_action_at);

alter table public.online_bots enable row level security;
revoke all on public.online_bots from anon, authenticated;


-- ------------------------------------------------------------ 3. el turno
--
--  Una sola fila. Quien la tiene "arrendada" es el UNICO proceso que mueve a
--  los bots: aunque haya varias instancias del servidor (Vercel arranca las
--  que quiera) o un worker y el cron a la vez, nunca hay dos moviendolos.
--  El arriendo caduca solo: si el proceso muere, otro lo coge en segundos.

create table if not exists public.online_bot_runtime (
    id            integer primary key default 1,
    lease_owner   text,
    lease_until   timestamptz,
    -- Poblacion objetivo, metricas y desafios humanos ya considerados.
    state         jsonb not null default '{}'::jsonb,
    updated_at    timestamptz not null default now(),
    constraint online_bot_runtime_single check (id = 1)
);

insert into public.online_bot_runtime (id) values (1) on conflict (id) do nothing;

alter table public.online_bot_runtime enable row level security;
revoke all on public.online_bot_runtime from anon, authenticated;

create or replace function public.online_bot_lease(p_owner text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.online_bot_runtime (id) values (1) on conflict (id) do nothing;

    update public.online_bot_runtime
       set lease_owner = p_owner,
           lease_until = now() + make_interval(secs => greatest(1, p_seconds))
     where id = 1
       and (lease_owner is null or lease_owner = p_owner or lease_until is null or lease_until < now());

    return found;
end;
$$;

create or replace function public.online_bot_release(p_owner text)
returns void
language sql
security definer
set search_path = public
as $$
    update public.online_bot_runtime
       set lease_owner = null, lease_until = null
     where id = 1 and lease_owner = p_owner;
$$;

revoke all on function public.online_bot_lease(text, integer)  from public, anon, authenticated;
revoke all on function public.online_bot_release(text)         from public, anon, authenticated;


-- ------------------------------------------------------------ 4. aceptar a alguien que busca rival
--
--  Un bot que "ve" a una persona buscando partida y decide jugar contra ella.
--  Es online_mm_pair con el rival ya elegido, en UNA sentencia bloqueada:
--
--    - si esa persona ya ha encontrado rival (otro bot, otra persona) -> false
--    - si dos bots lo intentan a la vez, solo uno se lo lleva (skip locked)
--    - si el propio bot ya estaba emparejado                          -> false

create or replace function public.online_mm_pair_with(
    p_player text, p_target text, p_game text, p_mode text, p_mmr integer,
    p_match text, p_stale_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_player = p_target then
        return false;
    end if;

    perform 1 from public.online_mm_queue
     where player_id = p_target
       and game_id = p_game
       and mode = p_mode
       and match_id is null
       and ping_at > now() - make_interval(secs => p_stale_seconds)
     for update skip locked;
    if not found then
        return false;
    end if;

    insert into public.online_mm_queue (player_id, game_id, mode, mmr, joined_at, ping_at, match_id)
    values (p_player, p_game, p_mode, p_mmr, now(), now(), p_match)
    on conflict (player_id) do update
       set game_id = excluded.game_id, mode = excluded.mode, mmr = excluded.mmr,
           ping_at = excluded.ping_at, match_id = excluded.match_id
     where public.online_mm_queue.match_id is null;
    if not found then
        return false;
    end if;

    update public.online_mm_queue set match_id = p_match where player_id = p_target;
    return true;
end;
$$;

revoke all on function public.online_mm_pair_with(text, text, text, text, integer, text, integer)
    from public, anon, authenticated;


-- ------------------------------------------------------------ 5. nombres
--
--  Un nombre de bot no lo puede coger luego una persona al registrarse (y al
--  reves: el gestor de bots comprueba profiles antes de inventar uno). Sin
--  esto habria dos "DaniVega" en la clasificacion.

create or replace function public.free_display_name(wanted text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    base      text;
    candidate text;
    n         integer := 1;
begin
    base := btrim(coalesce(wanted, ''));
    base := regexp_replace(base, '[^[:alnum:] _-]', '', 'g');
    base := btrim(base);

    if char_length(base) < 3 then base := 'Jugador'; end if;
    if char_length(base) > 20 then base := substr(base, 1, 20); end if;

    candidate := base;

    while exists (select 1 from public.profiles where lower(btrim(display_name)) = lower(candidate))
       or exists (select 1 from public.online_bots where lower(username) = lower(candidate)) loop
        n := n + 1;
        candidate := base || ' ' || n;
        if n > 999 then
            candidate := base || ' ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
            exit;
        end if;
    end loop;

    return candidate;
end;
$$;

create or replace function public.display_name_available(wanted text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select char_length(btrim(coalesce(wanted, ''))) between 3 and 24
       and not exists (
           select 1 from public.profiles
           where lower(btrim(display_name)) = lower(btrim(wanted))
       )
       and not exists (
           select 1 from public.online_bots
           where lower(username) = lower(btrim(wanted))
       );
$$;

grant execute on function public.display_name_available(text) to anon, authenticated;


-- ------------------------------------------------------------ 6. el panel
--
--  La misma vista de siempre con la marca al final, para separar personas y
--  bots en el panel y en las cuentas.

drop view if exists public.admin_players_overview;
create or replace view public.admin_players_overview as
select p.player_id,
       p.name,
       p.avatar_id,
       p.friend_code,
       p.balance_cents,
       p.biggest_win_cents,
       p.rounds,
       p.last_seen,
       p.playing,
       p.platform,
       p.user_id,
       (select count(*) from public.online_friends f
         where f.player_id = p.player_id)                          as friends,
       (select count(*) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_grants,
       (select coalesce(sum(g.amount_cents), 0) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_cents,
       exists (select 1 from public.online_profiles s
                where s.player_id = p.player_id)                   as has_save,
       p.is_bot
from public.online_players p;

revoke all on public.admin_players_overview from anon, authenticated;


-- ------------------------------------------------------------ comprobacion

select count(*) filter (where is_bot)      as bots,
       count(*) filter (where not is_bot)  as personas
from public.online_players;
