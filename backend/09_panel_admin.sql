-- ============================================================================
--  Casino Royale - panel de administracion de jugadores
-- ============================================================================
--
--  Se ejecuta DESPUES de 01..08. Es idempotente: volver a ejecutarlo no rompe
--  nada.
--
--  Que anade
--    1. Tu cuenta como administradora.
--    2. Una cola de ajustes de saldo, con su historial.
--    3. Las operaciones del panel: dar dinero, quitarlo y borrar un jugador.
--
--  Por que una COLA y no un UPDATE al saldo
--  ----------------------------------------
--  El saldo que se ve en el podio no es el bueno: es una copia que el juego
--  publica cada treinta segundos desde el movil, y la partida de verdad vive en
--  el dispositivo, dentro de un sobre con su propia suma de comprobacion. Si
--  aqui se cambiara el numero a mano pasarian dos cosas, las dos malas:
--
--    - El proximo latido del juego lo pisaria con la cifra de siempre, asi que
--      el regalo duraria medio minuto.
--    - Reescribir el sobre desde el servidor le rompe la suma de comprobacion,
--      y el juego rechaza el perfil entero. Es decir: borrarle la partida.
--
--  Asi que el panel no cambia el saldo: deja un APUNTE pendiente. El juego lo
--  recoge en el mismo latido que ya hacia, lo aplica en su propio banco y lo
--  guarda. El servidor no toca la partida de nadie en ningun momento.
--
--  Un apunte se entrega una sola vez. Si el juego se cierra justo despues de
--  recogerlo y antes de guardarlo, ese apunte se pierde: el panel lo marca como
--  entregado y siempre se puede volver a mandar. Es el precio de no arriesgarse
--  a pagar dos veces, que en una clasificacion es peor.
-- ============================================================================


-- ============================================================================
--  1. Tu cuenta, administradora
-- ============================================================================
--
--  Cambia el correo de la ultima linea por el tuyo: el de la cuenta con la que
--  entras en la web. Tiene que estar ya registrada; si no lo esta, registrate
--  primero en /login y vuelve a ejecutar solo esa linea.

create or replace function public.admin_bootstrap(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    select id into v_id from auth.users where lower(email) = lower(btrim(p_email));

    if not found then
        return 'No hay ninguna cuenta con el correo ' || p_email ||
               '. Registrate primero en la web y vuelve a ejecutar esta linea.';
    end if;

    -- Por si la cuenta es anterior al trigger que crea los perfiles.
    insert into public.profiles (id, display_name, friend_code)
    values (v_id, split_part(p_email, '@', 1),
            upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
    on conflict (id) do nothing;

    update public.profiles set role = 'admin' where id = v_id;

    return 'Listo: ' || p_email || ' ya es administrador.';
end;
$$;

revoke all on function public.admin_bootstrap(text) from public, anon, authenticated;


-- ============================================================================
--  2. La cola de ajustes
-- ============================================================================

create table if not exists public.online_grants (
    id              bigserial primary key,

    player_id       text not null
                    references public.online_players (player_id) on delete cascade,

    -- Positivo da, negativo quita. Cero no tiene sentido y se rechaza.
    amount_cents    bigint not null,

    reason          text not null default '',

    created_by      uuid references auth.users (id) on delete set null,
    created_at      timestamptz not null default now(),

    -- Cuando el juego se lo llevo. Nulo mientras espera.
    delivered_at    timestamptz,

    constraint online_grants_amount_nonzero check (amount_cents <> 0)
);

-- Indice parcial: la consulta que se hace en cada latido es "que le debo a
-- este", y solo mira los pendientes. Un indice sobre la tabla entera crece con
-- el historial y esta no.
create index if not exists online_grants_pending_idx
    on public.online_grants (player_id) where delivered_at is null;

create index if not exists online_grants_recent_idx
    on public.online_grants (created_at desc);

-- Como el resto de tablas del online: RLS activado y cero politicas. Solo la
-- clave de servicio, que la usan las rutas del servidor, ve esto.
alter table public.online_grants enable row level security;

revoke all on public.online_grants from anon, authenticated;


-- ============================================================================
--  3. Recoger lo pendiente
-- ============================================================================
--
--  La llama la ruta de presencia en cada latido. Marca y devuelve en la MISMA
--  sentencia: dos latidos que se crucen -el movil y el PC de la misma persona-
--  no pueden llevarse el mismo apunte dos veces.
--
--  "skip locked" para que el segundo no se quede esperando al primero: prefiero
--  que se lleve nada y lo recoja treinta segundos despues a que el latido tarde.

create or replace function public.online_grant_claim(p_player_id text)
returns table (id bigint, amount_cents bigint, reason text)
language sql
security definer
set search_path = public
as $$
    with picked as (
        select g.id
        from public.online_grants g
        where g.player_id = p_player_id
          and g.delivered_at is null
        order by g.id
        limit 20
        for update skip locked
    )
    update public.online_grants g
       set delivered_at = now()
      from picked
     where g.id = picked.id
    returning g.id, g.amount_cents, g.reason;
$$;

revoke all on function public.online_grant_claim(text) from public, anon, authenticated;


-- ============================================================================
--  4. Dar o quitar dinero
-- ============================================================================
--
--  Devuelve el saldo que queda anotado en el podio.
--
--  Quitar mas de lo que hay deja el saldo a cero y no en negativo: el banco del
--  juego se niega a quedarse en negativo y rechazaria la operacion entera, asi
--  que recortar aqui es lo que hace que lo de arriba y lo de abajo cuadren.

create or replace function public.admin_adjust_player(
    p_player_id    text,
    p_amount_cents bigint,
    p_reason       text,
    p_actor        uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_before bigint;
    v_after  bigint;
    v_amount bigint := p_amount_cents;
begin
    select balance_cents into v_before
    from public.online_players
    where player_id = p_player_id
    for update;

    if not found then
        raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- Lo que ya esta pendiente cuenta: si no, quitarle 100 dos veces seguidas a
    -- quien tiene 150 dejaria 50 anotados aqui y -50 en su movil.
    v_before := v_before + coalesce((
        select sum(g.amount_cents) from public.online_grants g
        where g.player_id = p_player_id and g.delivered_at is null), 0);

    if v_amount < 0 and -v_amount > v_before then
        v_amount := -v_before;
    end if;

    if v_amount = 0 then
        return v_before;
    end if;

    insert into public.online_grants (player_id, amount_cents, reason, created_by)
    values (p_player_id, v_amount,
            coalesce(nullif(btrim(p_reason), ''), 'Ajuste del panel'),
            p_actor);

    v_after := v_before + v_amount;

    -- El podio se pone al dia ya, sin esperar a que abra el juego. Su proximo
    -- latido lo pisara con la cifra de verdad, que para entonces ya incluira
    -- este ajuste.
    update public.online_players
       set balance_cents = greatest(v_after, 0)
     where player_id = p_player_id;

    insert into public.audit_log (actor, action, target, detail)
    values (p_actor, 'player.adjust', p_player_id,
            jsonb_build_object('amount_cents', v_amount,
                               'reason', p_reason,
                               'balance_before', v_before,
                               'balance_after', v_after));

    return v_after;
end;
$$;

revoke all on function public.admin_adjust_player(text, bigint, text, uuid)
    from public, anon, authenticated;


-- ============================================================================
--  5. Borrar un jugador del online
-- ============================================================================
--
--  Borra su ficha, sus amistades en los dos sentidos, su partida en la nube y
--  sus apuntes pendientes. NO borra la partida de su movil: esa vive alli, y la
--  proxima vez que abra el juego con conexion volvera a publicarse sola. Para
--  que desaparezca de verdad tiene que borrarla el, o no volver a conectarse.

create or replace function public.admin_delete_player(p_player_id text, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
begin
    select name into v_name from public.online_players where player_id = p_player_id;

    if not found then
        raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- Las dos direcciones: la clave ajena solo se lleva por delante las filas en
    -- las que es player_id, y la amistad se guarda dos veces.
    delete from public.online_friends
     where player_id = p_player_id or friend_id = p_player_id;

    delete from public.online_profiles where player_id = p_player_id;
    delete from public.online_grants   where player_id = p_player_id;
    delete from public.online_players  where player_id = p_player_id;

    insert into public.audit_log (actor, action, target, detail)
    values (p_actor, 'player.delete', p_player_id, jsonb_build_object('name', v_name));

    return v_name;
end;
$$;

revoke all on function public.admin_delete_player(text, uuid) from public, anon, authenticated;


-- ============================================================================
--  6. Cambiar el nombre de un jugador
-- ============================================================================
--
--  Para un nombre ofensivo en el podio. El juego lo volvera a publicar con el
--  suyo en el siguiente latido, asi que esto es un parche visible, no un
--  castigo; para eso esta borrarlo.

create or replace function public.admin_rename_player(p_player_id text, p_name text, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := btrim(p_name);
begin
    if length(v_name) < 3 then
        raise exception 'NAME_TOO_SHORT' using errcode = '22023';
    end if;

    update public.online_players set name = left(v_name, 16) where player_id = p_player_id;

    if not found then
        raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002';
    end if;

    insert into public.audit_log (actor, action, target, detail)
    values (p_actor, 'player.rename', p_player_id, jsonb_build_object('name', v_name));

    return left(v_name, 16);
end;
$$;

revoke all on function public.admin_rename_player(text, text, uuid) from public, anon, authenticated;


-- ============================================================================
--  7. La lista que ve el panel
-- ============================================================================

-- Se tira antes de crearla: "create or replace view" solo admite ANADIR
-- columnas al final, nunca meter una en medio, y aqui user_id y email entran
-- antes de friends. Nada depende de esta vista salvo la consulta del panel, asi
-- que tirarla no tiene coste.
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

       (select count(*) from public.online_friends f
         where f.player_id = p.player_id)                          as friends,

       (select count(*) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_grants,

       (select coalesce(sum(g.amount_cents), 0) from public.online_grants g
         where g.player_id = p.player_id and g.delivered_at is null) as pending_cents,

       exists (select 1 from public.online_profiles s
                where s.player_id = p.player_id)                   as has_save

from public.online_players p;

-- Una vista se ejecuta con los permisos de quien la creo, asi que sin esto
-- cualquiera con la clave anonima leeria de un tiron la tabla entera de
-- jugadores, que esta protegida precisamente para que eso no pase.
revoke all on public.admin_players_overview from anon, authenticated;


-- ============================================================================
--  8. Ponte de administrador
-- ============================================================================
--
--  ⬇⬇⬇  CAMBIA EL CORREO POR EL TUYO ANTES DE EJECUTAR  ⬇⬇⬇

select public.admin_bootstrap('cambia-esto@por-tu-correo.com');
