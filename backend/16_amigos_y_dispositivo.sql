-- ============================================================================
--  16. Amigos que no se pierden + desde qué dispositivo juega cada uno
-- ============================================================================
--  Ejecútalo en Supabase > SQL Editor. Se puede ejecutar varias veces.
--
--  1. Las amistades dejan de depender de la fila del jugador en el online.
--     Antes, si esa fila desaparecía (se borraba la cuenta, se rehacía el
--     jugador...), la base de datos se llevaba por delante TODAS sus amistades
--     sin avisar. Ahora la amistad se queda guardada y, en cuanto el jugador
--     vuelve a entrar, sus amigos vuelven a salir solos (el id es el de la
--     cuenta, que no cambia).
--  2. Si alguna vez se borra un jugador o una amistad, queda apuntado en el
--     registro (audit_log) quién y cuándo, para saber qué lo ha hecho.
--  3. Nueva columna "platform" (android, ios, windows, web...) para el panel.
-- ============================================================================


-- ----------------------------------------------------------------- 1. amistades

alter table public.online_friends drop constraint if exists online_friends_player_id_fkey;
alter table public.online_friends drop constraint if exists online_friends_friend_id_fkey;

-- Añadir: busca el código en el online y, si no está, en la cuenta de la web.
create or replace function public.online_friend_add(me text, code text)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code   text := upper(replace(btrim(coalesce(code, '')), '-', ''));
    v_target text;
    v_name   text;
begin
    if me is null or btrim(me) = '' or v_code = '' then
        return query select false, 'Faltan datos.'::text;
        return;
    end if;

    select p.player_id, p.name into v_target, v_name
      from public.online_players p
     where p.friend_code = v_code
     limit 1;

    if v_target is null then
        select pr.id::text, pr.display_name into v_target, v_name
          from public.profiles pr
         where upper(pr.friend_code) = v_code
         limit 1;
    end if;

    if v_target is null then
        return query select false, 'Ese código no existe.'::text;
        return;
    end if;

    if v_target = me then
        return query select false, 'Ese es tu propio código.'::text;
        return;
    end if;

    if exists (select 1 from public.online_friends
               where player_id = me and friend_id = v_target) then
        return query select false, (coalesce(v_name, 'Ese jugador') || ' ya está en tu lista.')::text;
        return;
    end if;

    insert into public.online_friends (player_id, friend_id)
    values (me, v_target), (v_target, me)
    on conflict do nothing;

    return query select true, coalesce(v_name, 'Jugador')::text;
end;
$$;

revoke all on function public.online_friend_add(text, text) from public, anon, authenticated;


-- ----------------------------------------------------------- 2. chivato de borrados

create or replace function public.log_online_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_table_name = 'online_friends' then
        insert into public.audit_log (action, target, detail)
        values ('friend.gone', old.player_id,
                jsonb_build_object('friend_id', old.friend_id,
                                   'db_user', current_user,
                                   'app', current_setting('application_name', true)));
    else
        insert into public.audit_log (action, target, detail)
        values ('player.gone', old.player_id,
                jsonb_build_object('name', old.name,
                                   'db_user', current_user,
                                   'app', current_setting('application_name', true)));
    end if;
    return old;
end;
$$;

drop trigger if exists online_friends_log_delete on public.online_friends;
create trigger online_friends_log_delete
    after delete on public.online_friends
    for each row execute function public.log_online_delete();

drop trigger if exists online_players_log_delete on public.online_players;
create trigger online_players_log_delete
    after delete on public.online_players
    for each row execute function public.log_online_delete();


-- ------------------------------------------------------------- 3. dispositivo

alter table public.online_players add column if not exists platform text;

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
                where s.player_id = p.player_id)                   as has_save
from public.online_players p;

revoke all on public.admin_players_overview from anon, authenticated;


-- ------------------------------------------------------------------ comprobación

select 'amistades' as que, count(*) as filas from public.online_friends
union all
select 'jugadores', count(*) from public.online_players;
