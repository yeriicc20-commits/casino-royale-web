-- ============================================================================
--  13. Modo competitivo online: rangos, MMR, emparejamiento, partidas, temporadas
-- ============================================================================
--
--  Independiente de los eventos (12) y de los retos entre amigos (11).
--
--    online_ranked         una escalera por jugador, temporada y juego
--                          (game_id = 'global' para el rango general)
--    online_ranked_best    el mejor rango histórico (no se pierde con las temporadas)
--    online_mm_queue       quién está buscando partida ahora mismo
--    online_matches        cada partida, con su id único (MATCH-XXXXXX)
--    online_comp_claims    cada premio entregado, con llave única (no se cobra dos veces)
--    online_comp_bans      abandonos recientes y bloqueos temporales
--
--  Todo lo calcula y escribe el servidor (clave de servicio). RLS activado y sin
--  políticas, como el resto del online. Se puede ejecutar más de una vez.

create table if not exists public.online_ranked (
    player_id      text not null,
    season         integer not null,
    game_id        text not null,
    name           text not null default 'Jugador',
    avatar_id      integer not null default 0,
    points         integer not null default 0,
    mmr            integer not null default 1000,
    games          integer not null default 0,
    wins           integer not null default 0,
    losses         integer not null default 0,
    draws          integer not null default 0,
    streak         integer not null default 0,
    best_streak    integer not null default 0,
    peak_points    integer not null default 0,
    peak_division  integer not null default 0,
    protect_left   integer not null default 0,
    chips_cents    bigint  not null default 0,
    seconds_played integer not null default 0,
    abandons       integer not null default 0,
    last_match_at  timestamptz,
    version        integer not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    primary key (player_id, season, game_id)
);
create index if not exists online_ranked_board_idx on public.online_ranked (season, game_id, points desc);

create table if not exists public.online_ranked_best (
    player_id      text not null,
    game_id        text not null,
    best_division  integer not null default 0,
    best_points    integer not null default 0,
    best_season    integer not null default 0,
    updated_at     timestamptz not null default now(),
    primary key (player_id, game_id)
);

create table if not exists public.online_mm_queue (
    player_id   text primary key,
    game_id     text not null,
    mode        text not null,
    mmr         integer not null default 1000,
    joined_at   timestamptz not null default now(),
    ping_at     timestamptz not null default now(),
    match_id    text
);
create index if not exists online_mm_queue_find_idx on public.online_mm_queue (game_id, mode, mmr) where match_id is null;

create table if not exists public.online_matches (
    id           text primary key,
    game_id      text not null,
    mode         text not null,
    season       integer not null,
    player_a     text not null,
    player_b     text not null,
    name_a       text not null default 'Jugador',
    name_b       text not null default 'Jugador',
    avatar_a     integer not null default 0,
    avatar_b     integer not null default 0,
    mmr_a        integer not null default 1000,
    mmr_b        integer not null default 1000,
    points_a     integer not null default 0,
    points_b     integer not null default 0,
    status       text not null default 'live',     -- live / done
    state        jsonb not null default '{}'::jsonb,
    version      integer not null default 0,
    settled      boolean not null default false,
    result       jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    finished_at  timestamptz
);
create index if not exists online_matches_a_idx on public.online_matches (player_a, status, created_at desc);
create index if not exists online_matches_b_idx on public.online_matches (player_b, status, created_at desc);

create table if not exists public.online_comp_claims (
    player_id    text not null,
    claim_id     text not null,
    coins_cents  bigint not null default 0,
    cosmetics    jsonb  not null default '[]'::jsonb,
    created_at   timestamptz not null default now(),
    primary key (player_id, claim_id)
);
create index if not exists online_comp_claims_recent_idx on public.online_comp_claims (player_id, created_at desc);

create table if not exists public.online_comp_bans (
    player_id     text primary key,
    abandons      jsonb not null default '[]'::jsonb,   -- fechas (ms) de los últimos abandonos
    banned_until  timestamptz,
    updated_at    timestamptz not null default now()
);

alter table public.online_ranked      enable row level security;
alter table public.online_ranked_best enable row level security;
alter table public.online_mm_queue    enable row level security;
alter table public.online_matches     enable row level security;
alter table public.online_comp_claims enable row level security;
alter table public.online_comp_bans   enable row level security;
revoke all on public.online_ranked, public.online_ranked_best, public.online_mm_queue,
              public.online_matches, public.online_comp_claims, public.online_comp_bans
    from anon, authenticated;


-- ----------------------------------------------------------------------------
--  Emparejar: en UNA sentencia bloqueada, para que dos jugadores no se queden
--  con el mismo rival a la vez. Devuelve el rival, o null si no hay.
-- ----------------------------------------------------------------------------
create or replace function public.online_mm_pair(
    p_player text, p_game text, p_mode text, p_mmr integer, p_window integer,
    p_avoid text, p_match text, p_stale_seconds integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_opp text;
begin
    perform 1 from public.online_mm_queue
     where player_id = p_player and match_id is null
     for update;
    if not found then
        return null;
    end if;

    select q.player_id into v_opp
      from public.online_mm_queue q
     where q.player_id <> p_player
       and q.game_id = p_game
       and q.mode = p_mode
       and q.match_id is null
       and q.ping_at > now() - make_interval(secs => p_stale_seconds)
       and abs(q.mmr - p_mmr) <= p_window
       and (p_avoid is null or q.player_id <> p_avoid)
     order by abs(q.mmr - p_mmr), q.joined_at
     limit 1
     for update skip locked;

    if v_opp is null then
        return null;
    end if;

    update public.online_mm_queue set match_id = p_match
     where player_id in (p_player, v_opp);
    return v_opp;
end;
$$;

revoke all on function public.online_mm_pair(text, text, text, integer, integer, text, text, integer)
    from public, anon, authenticated;
