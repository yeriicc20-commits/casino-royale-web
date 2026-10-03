-- ============================================================================
--  15. Panel en vivo: en que maquina esta cada jugador e historial de su saldo
-- ============================================================================
--  Ejecutalo en Supabase > SQL Editor. Se puede ejecutar varias veces.

alter table public.online_players add column if not exists playing text;

create table if not exists public.online_activity (
  id            bigserial primary key,
  player_id     text not null references public.online_players (player_id) on delete cascade,
  at            timestamptz not null default now(),
  balance_cents bigint not null,
  delta_cents   bigint not null default 0,
  rounds        integer not null default 0,
  rounds_delta  integer not null default 0,
  game          text,
  flag          text
);

create index if not exists online_activity_player_at on public.online_activity (player_id, at desc);
create index if not exists online_activity_flag on public.online_activity (at desc) where flag is not null;

-- Solo el servidor (clave de servicio) la lee y escribe.
alter table public.online_activity enable row level security;
revoke all on public.online_activity from anon, authenticated;

-- La vista del panel con la maquina en la que esta cada uno.
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
       p.user_id,
       (select count(*) from public.online_friends f
         where f.player_id = p.player_id)                          as friends,
       (select count(*) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_grants,
       (select coalesce(sum(g.amount_cents), 0) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_cents,
       exists (select 1 from public.online_profiles s
                where s.player_id = p.player_id)                   as has_save
from public.online_players p;

revoke all on public.admin_players_overview from anon, authenticated;

-- Limpieza: el historial de mas de 60 dias se borra solo cuando se ejecuta esto.
delete from public.online_activity where at < now() - interval '60 days';
