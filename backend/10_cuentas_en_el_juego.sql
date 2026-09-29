-- ============================================================================
--  Casino Royale - el online pasa a ir con cuenta
-- ============================================================================
--
--  Se ejecuta DESPUES de 01..09. Es idempotente.
--
--  Que cambia
--  ----------
--  Hasta ahora el juego se identificaba con un codigo que generaba el propio
--  movil la primera vez que arrancaba. Eso tenia dos consecuencias feas:
--
--    - Cambiar de telefono era empezar de cero, y desinstalar y reinstalar
--      tambien. Tu puesto en el podio se iba con el dispositivo.
--    - La cuenta de la web y el jugador del juego eran dos personas distintas,
--      asi que iniciar sesion en la web no te reconocia dentro del juego.
--
--  A partir de aqui el online va con cuenta: la MISMA cuenta de la web. Sin
--  conexion se sigue jugando sin nada, como siempre.
--
--  Lo importante: NADIE PIERDE SU PARTIDA
--  --------------------------------------
--  La primera vez que alguien entra con su cuenta, la fila que tenia su
--  dispositivo se ADOPTA: cambia de nombre al identificador de la cuenta y se
--  lleva consigo el saldo, las amistades, la partida guardada en la nube y los
--  ajustes pendientes del panel. Por eso las claves ajenas de abajo pasan a
--  llevar "on update cascade": sin eso, renombrar la fila reventaria contra sus
--  propias dependencias.
-- ============================================================================


-- ============================================================================
--  1. El enlace con la cuenta
-- ============================================================================

alter table public.online_players
    add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Una cuenta, un jugador. Parcial porque las filas viejas -las que todavia no
-- ha reclamado nadie- tienen user_id nulo y son varias.
create unique index if not exists online_players_user_idx
    on public.online_players (user_id) where user_id is not null;


-- ============================================================================
--  2. Las dependencias tienen que seguir al renombrado
-- ============================================================================

do $$ begin
    alter table public.online_friends drop constraint if exists online_friends_player_id_fkey;
    alter table public.online_friends drop constraint if exists online_friends_friend_id_fkey;

    alter table public.online_friends
        add constraint online_friends_player_id_fkey
        foreign key (player_id) references public.online_players (player_id)
        on update cascade on delete cascade;

    alter table public.online_friends
        add constraint online_friends_friend_id_fkey
        foreign key (friend_id) references public.online_players (player_id)
        on update cascade on delete cascade;
end $$;

do $$ begin
    if to_regclass('public.online_grants') is not null then
        alter table public.online_grants drop constraint if exists online_grants_player_id_fkey;

        alter table public.online_grants
            add constraint online_grants_player_id_fkey
            foreign key (player_id) references public.online_players (player_id)
            on update cascade on delete cascade;
    end if;
end $$;


-- ============================================================================
--  3. Reclamar la identidad
-- ============================================================================
--
--  La llama el servidor en cuanto el juego se presenta con una sesion valida.
--  Devuelve el identificador que ese jugador tiene que usar a partir de ahora,
--  que es siempre el de su cuenta.
--
--  Tres casos, en este orden:
--
--    a) La cuenta ya tiene jugador  -> se devuelve y ya esta.
--    b) La cuenta no lo tiene, pero el dispositivo si -> se adopta esa fila.
--    c) Ni una cosa ni otra         -> se crea una limpia.
--
--  El caso (b) es el que hace que nadie pierda nada al actualizar. Y no se
--  fusionan dos jugadores que ya existan por separado: eso obligaria a decidir
--  que saldo vale y que amistades sobreviven, y cualquier respuesta seria
--  arbitraria. Gana la cuenta, que es la que va a durar.

create or replace function public.online_claim_identity(
    p_user   uuid,
    p_device text default null,
    p_name   text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id     text := p_user::text;
    v_device text := nullif(btrim(coalesce(p_device, '')), '');
    v_name   text;
begin
    if p_user is null then
        raise exception 'AUTH_REQUIRED' using errcode = '28000';
    end if;

    -- (a) la cuenta ya tiene su jugador
    if exists (select 1 from public.online_players where player_id = v_id) then
        update public.online_players set user_id = p_user
         where player_id = v_id and user_id is distinct from p_user;
        return v_id;
    end if;

    -- (b) adoptar lo que tuviera este dispositivo, si no es ya de otra cuenta
    if v_device is not null and v_device <> v_id
       and exists (select 1 from public.online_players
                    where player_id = v_device and user_id is null) then

        -- La partida en la nube no tiene clave ajena -es un sobre suelto- asi
        -- que se mueve a mano, y antes que la fila para no dejarla huerfana.
        delete from public.online_profiles where player_id = v_id;
        update public.online_profiles set player_id = v_id where player_id = v_device;

        -- Renombrar arrastra amistades y ajustes por el "on update cascade".
        update public.online_players
           set player_id = v_id, user_id = p_user
         where player_id = v_device;

        return v_id;
    end if;

    -- (c) jugador nuevo
    select coalesce(nullif(btrim(coalesce(p_name, '')), ''), pr.display_name, 'Jugador')
      into v_name
      from public.profiles pr where pr.id = p_user;

    insert into public.online_players (player_id, user_id, name, friend_code)
    values (v_id, p_user, left(coalesce(v_name, 'Jugador'), 16),
            upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
    on conflict (player_id) do nothing;

    return v_id;
end;
$$;

revoke all on function public.online_claim_identity(uuid, text, text)
    from public, anon, authenticated;


-- ============================================================================
--  4. El panel, con el correo de cada jugador
-- ============================================================================

create or replace view public.admin_players_overview as
select p.player_id,
       p.name,
       p.avatar_id,
       p.friend_code,
       p.balance_cents,
       p.biggest_win_cents,
       p.rounds,
       p.last_seen,
       p.user_id,

       (select u.email from auth.users u where u.id = p.user_id)          as email,

       (select count(*) from public.online_friends f
         where f.player_id = p.player_id)                                 as friends,

       (select count(*) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null)      as pending_grants,

       (select coalesce(sum(g.amount_cents), 0) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null)      as pending_cents,

       exists (select 1 from public.online_profiles s
                where s.player_id = p.player_id)                          as has_save

from public.online_players p;

revoke all on public.admin_players_overview from anon, authenticated;


-- ---------------------------------------------------------------- comprobacion

select count(*) filter (where user_id is not null) as con_cuenta,
       count(*) filter (where user_id is null)     as sin_reclamar,
       count(*)                                    as total
from public.online_players;
