-- ============================================================================
--  11. Retos de blackjack entre amigos
-- ============================================================================
--
--  Dos amigos apuestan lo mismo y cada uno juega su mano de blackjack contra la
--  del otro (sin crupier). Quien se queda mas cerca de 21 sin pasarse gana lo
--  que apostó el otro. Empate, o los dos pasados: nadie paga.
--
--  El servidor baraja y reparte: el mazo vive aqui y el juego solo pide
--  "carta" o "me planto". Ninguno ve las cartas del otro hasta que los dos han
--  terminado. El dinero se mueve con la cola de ajustes (online_grants), la
--  misma que usa el panel, asi que llega al movil en el siguiente latido.
--
--  Se puede ejecutar mas de una vez sin romper nada.

create table if not exists public.online_duels (
    id                 uuid primary key default gen_random_uuid(),

    challenger_id      text not null references public.online_players (player_id) on delete cascade,
    opponent_id        text not null references public.online_players (player_id) on delete cascade,

    stake_cents        bigint not null,

    -- pending: esperando a que el otro acepte
    -- active:  aceptado, cada uno juega su mano
    -- done:    terminado y pagado
    -- declined / expired / cancelled
    status             text not null default 'pending',

    -- El mazo que queda, como ["As","10d",...]. Solo lo lee el servidor.
    deck               jsonb not null default '[]'::jsonb,

    challenger_cards   jsonb not null default '[]'::jsonb,
    opponent_cards     jsonb not null default '[]'::jsonb,
    challenger_done    boolean not null default false,
    opponent_done      boolean not null default false,

    -- challenger / opponent / push. Vacio mientras se juega.
    result             text not null default '',

    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    settled_at         timestamptz,

    constraint online_duels_stake_positive check (stake_cents > 0),
    constraint online_duels_not_self check (challenger_id <> opponent_id)
);

create index if not exists online_duels_challenger_idx on public.online_duels (challenger_id, created_at desc);
create index if not exists online_duels_opponent_idx   on public.online_duels (opponent_id, created_at desc);

-- Como el resto del online: solo las rutas del servidor (clave de servicio).
alter table public.online_duels enable row level security;
revoke all on public.online_duels from anon, authenticated;
