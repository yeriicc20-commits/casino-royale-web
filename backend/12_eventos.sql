-- ============================================================================
--  12. Eventos: progreso, ranking y recompensas
-- ============================================================================
--
--  Los horarios de los eventos NO viven aquí (ya los tiene el juego y la web:
--  diario 17:00-18:00, sábado 11:00-14:00). Esto guarda lo que pasa DENTRO:
--
--    online_event_progress  un jugador en un evento: puntos, racha, jackpots,
--                           desafíos... (la fila entera la calcula el servidor
--                           con las rondas que manda el juego)
--    online_event_claims    cada recompensa entregada, con una llave única
--                           ("d-2026-10-05:rank", "...:chest", "...:jp:..."),
--                           así no se puede cobrar nada dos veces
--
--  Como el resto del online: RLS activado y sin políticas, solo las rutas del
--  servidor (clave de servicio) leen y escriben.
--
--  Se puede ejecutar más de una vez sin romper nada.

create table if not exists public.online_event_progress (
    player_id     text not null,
    instance_id   text not null,          -- "d-2026-10-05" / "w-2026-10-03"
    event_id      text not null,          -- "racha_mortal", "casino_royale"...

    -- Para pintar el ranking sin cruzar tablas.
    name          text not null default 'Jugador',
    avatar_id     integer not null default 0,
    vip           boolean not null default false,

    score         bigint  not null default 0,   -- ranking mientras dura
    final_score   bigint  not null default 0,   -- ranking al cerrar (Todo o Nada cobra el bote)
    jackpots      integer not null default 0,
    best_jackpot  integer not null default -1,
    streak        integer not null default 0,
    best_streak   integer not null default 0,
    rounds        integer not null default 0,

    state         jsonb   not null default '{}'::jsonb,
    version       integer not null default 0,   -- para no pisar dos escrituras a la vez
    claimed       boolean not null default false,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    primary key (player_id, instance_id)
);

create index if not exists online_event_progress_rank_idx
    on public.online_event_progress (instance_id, score desc);
create index if not exists online_event_progress_final_idx
    on public.online_event_progress (instance_id, final_score desc);
create index if not exists online_event_progress_jackpots_idx
    on public.online_event_progress (instance_id, jackpots desc, best_jackpot desc);
create index if not exists online_event_progress_unclaimed_idx
    on public.online_event_progress (player_id) where claimed = false;

alter table public.online_event_progress enable row level security;
revoke all on public.online_event_progress from anon, authenticated;


create table if not exists public.online_event_claims (
    player_id     text not null,
    claim_id      text not null,
    instance_id   text not null,
    coins_cents   bigint not null default 0,
    cosmetics     jsonb  not null default '[]'::jsonb,
    perk          jsonb  not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),

    primary key (player_id, claim_id)
);

create index if not exists online_event_claims_player_idx
    on public.online_event_claims (player_id, created_at desc);

alter table public.online_event_claims enable row level security;
revoke all on public.online_event_claims from anon, authenticated;
