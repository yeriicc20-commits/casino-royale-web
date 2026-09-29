-- ============================================================================
--  Casino Royale - tablas del modo online del JUEGO
-- ============================================================================
--
--  Se ejecuta DESPUES de 01, 02 y 03.
--
--  Por que estas tablas y no las de la web
--  ---------------------------------------
--  La web identifica a la gente por su cuenta de Supabase (auth.users). El
--  juego todavia no tiene login: se identifica con el playerId que genera en el
--  movil la primera vez que arranca, y ese identificador no existe en auth.
--
--  Mezclar las dos cosas obligaria a inventar un usuario de Supabase por cada
--  instalacion, y a decidir que pasa cuando esa persona SI se registre mas
--  tarde. Separadas, el dia que se anada login basta con enlazar player_id con
--  un user_id y nada de lo de abajo cambia.
--
--  Nadie escribe aqui directamente: solo las rutas del servidor, con la clave
--  de servicio. Por eso RLS queda activado y sin ninguna politica permisiva.
-- ============================================================================

-- ------------------------------------------------------------ online_players
--
--  Quien esta jugando, como se llama y cuanto tiene. Es lo que alimenta la
--  lista de amigos y la clasificacion.

create table if not exists public.online_players (
    player_id           text primary key,

    name                text not null default 'Jugador',
    avatar_id           integer not null default 0,

    -- Unico: es lo que otra persona teclea para anadirte. Dos jugadores con el
    -- mismo codigo harian que anadir a uno anadiera al otro.
    friend_code         text unique,

    balance_cents       bigint not null default 0,
    biggest_win_cents   bigint not null default 0,
    rounds              integer not null default 0,

    last_seen           timestamptz not null default now()
);

create index if not exists online_players_rank_idx
    on public.online_players (balance_cents desc);

create index if not exists online_players_seen_idx
    on public.online_players (last_seen desc);

-- ------------------------------------------------------------ online_friends
--
--  Amistad simetrica guardada en DOS filas, una por sentido.
--
--  Se podria guardar una sola fila ordenada y resolverla con un OR en cada
--  consulta, pero entonces "mis amigos" deja de ser un indice y pasa a ser un
--  recorrido. Dos filas cuestan unos bytes y hacen que la consulta sea directa.

create table if not exists public.online_friends (
    player_id   text not null references public.online_players (player_id) on delete cascade,
    friend_id   text not null references public.online_players (player_id) on delete cascade,
    since       timestamptz not null default now(),

    primary key (player_id, friend_id),

    -- Nadie es amigo de si mismo: sin esto, aparecerias en tu propia lista.
    constraint online_friends_not_self check (player_id <> friend_id)
);

-- ----------------------------------------------------------- online_profiles
--
--  La partida guardada, tal cual la manda el juego.
--
--  El sobre se guarda ENTERO y sin tocar, incluido su checksum: el juego lo
--  verifica al recibirlo y rechaza cualquier perfil que no cuadre. Si el
--  servidor reescribiera el contenido, ese checksum dejaria de coincidir y el
--  jugador perderia su progreso sin que nadie supiera por que.

create table if not exists public.online_profiles (
    player_id   text primary key,

    -- Numero de version del guardado. Solo sube.
    revision    bigint not null default 0,

    envelope    jsonb not null,
    updated_at  timestamptz not null default now()
);

-- ============================================================================
--  Seguridad
-- ============================================================================
--
--  RLS activado y CERO politicas. Con la clave anonima esto es invisible e
--  intocable; solo las rutas del servidor, que usan la clave de servicio, la
--  ven. Es lo correcto: aqui hay partidas de otra gente.

alter table public.online_players  enable row level security;
alter table public.online_friends  enable row level security;
alter table public.online_profiles enable row level security;

-- ============================================================================
--  Anadir a un amigo, en una sola operacion
-- ============================================================================
--
--  Va en la base de datos y no en la ruta porque son cuatro comprobaciones y
--  dos insercciones que tienen que ocurrir juntas. Hecho a base de consultas
--  sueltas desde el servidor, dos moviles pulsando a la vez pueden colarse
--  entre la comprobacion y la insercion.
--
--  Devuelve el mismo par (ok, message) que ya espera el juego.

create or replace function public.online_friend_add(me text, code text)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
    target public.online_players;
begin
    if me is null or btrim(me) = '' or code is null or btrim(code) = '' then
        return query select false, 'Faltan datos.'::text;
        return;
    end if;

    select * into target
    from public.online_players
    where friend_code = upper(btrim(code));

    if not found then
        return query select false, 'Ese código no existe.'::text;
        return;
    end if;

    if target.player_id = me then
        return query select false, 'Ese es tu propio código.'::text;
        return;
    end if;

    if exists (select 1 from public.online_friends
               where player_id = me and friend_id = target.player_id) then
        return query select false, (target.name || ' ya está en tu lista.')::text;
        return;
    end if;

    -- Las dos direcciones a la vez: una amistad de un solo sentido deja a uno
    -- viendo al otro en su lista y al otro sin enterarse.
    insert into public.online_friends (player_id, friend_id)
    values (me, target.player_id), (target.player_id, me)
    on conflict do nothing;

    return query select true, target.name;
end;
$$;

revoke all on function public.online_friend_add(text, text) from public;
