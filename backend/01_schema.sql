-- ============================================================================
--  Casino Royale - esquema de la base de datos (Supabase / PostgreSQL)
-- ============================================================================
--
--  Se ejecuta UNA vez, en el SQL Editor de Supabase, antes que 02_policies.sql.
--  Es idempotente: volver a ejecutarlo no rompe nada.
--
--  Decision de diseno principal: la version se guarda como texto ("1.4.0") para
--  mostrarla, y ADEMAS descompuesta en tres columnas numericas generadas. Asi la
--  comparacion la hace Postgres con numeros y "1.10.0" queda por encima de
--  "1.2.0", que comparados como texto salen al reves.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enumerados

do $$ begin
    create type release_channel as enum ('production', 'beta', 'development');
exception when duplicate_object then null; end $$;

do $$ begin
    create type release_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
    create type user_role as enum ('player', 'admin');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ releases
--
--  Una fila por version y canal. Contiene todo lo que la web muestra y todo lo
--  que el juego necesita para decidir si puede entrar al online.

create table if not exists public.releases (
    id                  uuid primary key default gen_random_uuid(),

    version             text not null,
    channel             release_channel not null default 'production',
    status              release_status  not null default 'draft',

    -- Partes numericas de la version, calculadas por la propia base de datos.
    -- Son STORED para poder indexarlas y ordenar por ellas.
    major               integer generated always as (split_part(version, '.', 1)::integer) stored,
    minor               integer generated always as (coalesce(nullif(split_part(version, '.', 2), ''), '0')::integer) stored,
    patch               integer generated always as (coalesce(nullif(split_part(version, '.', 3), ''), '0')::integer) stored,

    title               text not null default '',
    summary             text not null default '',

    -- Listas de cambios. jsonb y no tablas aparte: siempre se leen enteras y
    -- junto a su version, nunca por separado.
    notes_added         jsonb not null default '[]'::jsonb,
    notes_fixed         jsonb not null default '[]'::jsonb,
    notes_changed       jsonb not null default '[]'::jsonb,
    notes_technical     jsonb not null default '[]'::jsonb,

    -- Distribucion. Solo URLs: los binarios viven en GitHub Releases, que da
    -- 2 GB por archivo y ancho de banda sin tope practico en repos publicos.
    -- El Storage gratuito de Supabase es 1 GB en total, unos trece APK.
    android_url         text,
    android_version_code integer,
    android_size_bytes  bigint,

    ios_store_url       text,

    windows_url         text,
    windows_size_bytes  bigint,

    released_at         timestamptz not null default now(),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    constraint releases_version_format
        check (version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),

    constraint releases_version_per_channel unique (channel, version)
);

create index if not exists releases_order_idx
    on public.releases (channel, major desc, minor desc, patch desc);

create index if not exists releases_published_idx
    on public.releases (channel, status) where status = 'published';

-- -------------------------------------------------------------- app_config
--
--  Una fila por canal. Es el interruptor general: que version es la actual,
--  cual es la minima que el online acepta, y si hay mantenimiento.
--
--  Se guarda aqui y NO se deduce de releases porque "la ultima publicada" y
--  "la que quiero que la gente tenga" no son lo mismo: una version puede estar
--  publicada en la web y todavia no ser obligatoria.

create table if not exists public.app_config (
    channel                 release_channel primary key,

    latest_version          text not null default '1.0.0',
    minimum_online_version  text not null default '1.0.0',

    maintenance_mode        boolean not null default false,
    maintenance_message     text not null default 'El modo online está temporalmente en mantenimiento.',

    -- Se repite aqui ademas de en releases para que el juego pueda abrir la
    -- ficha del App Store aunque la version instalada no exista en la tabla.
    ios_store_url           text,

    updated_at              timestamptz not null default now(),

    constraint app_config_latest_format
        check (latest_version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
    constraint app_config_minimum_format
        check (minimum_online_version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$')
);

-- -------------------------------------------------------------- profiles
--
--  Espejo de auth.users con lo que la aplicacion necesita. Supabase guarda las
--  credenciales en auth.users, que no es accesible desde el cliente; esta tabla
--  es la parte publica y es donde vive el rol.

create table if not exists public.profiles (
    id              uuid primary key references auth.users (id) on delete cascade,
    display_name    text not null default 'Jugador',
    avatar_index    smallint not null default 0,
    role            user_role not null default 'player',
    friend_code     text unique,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------- game_saves
--
--  La partida del jugador, para recuperarla en otro movil.
--
--  Este blob lo escribe el cliente y por tanto NO es de fiar: sirve para que
--  alguien no pierda su progreso al cambiar de telefono, no para decidir quien
--  va ganando. Lo que se muestra en clasificaciones sale de player_stats, que
--  solo se escribe desde el servidor.

create table if not exists public.game_saves (
    user_id         uuid not null references auth.users (id) on delete cascade,
    channel         release_channel not null default 'production',

    data            jsonb not null default '{}'::jsonb,
    schema_version  integer not null default 1,
    game_version    text,

    updated_at      timestamptz not null default now(),

    primary key (user_id, channel)
);

-- ------------------------------------------------------------ player_stats
--
--  Agregados de confianza. Solo los escribe la funcion submit_round(), nunca
--  el cliente directamente, que es lo que impide que alguien se ponga un millon
--  de euros editando el guardado y aparezca primero en el podio.

create table if not exists public.player_stats (
    user_id             uuid primary key references auth.users (id) on delete cascade,

    balance_cents       bigint not null default 100000,
    total_staked_cents  bigint not null default 0,
    total_won_cents     bigint not null default 0,
    rounds_played       integer not null default 0,
    biggest_win_cents   bigint not null default 0,

    last_round_at       timestamptz,
    updated_at          timestamptz not null default now(),

    constraint player_stats_balance_positive check (balance_cents >= 0)
);

create index if not exists player_stats_leaderboard_idx
    on public.player_stats (balance_cents desc);

-- -------------------------------------------------------------- audit_log
--
--  Quien cambio que en el panel. Sin esto, "¿por que el online dejo de dejar
--  entrar a nadie?" no tiene respuesta.

create table if not exists public.audit_log (
    id          bigserial primary key,
    actor       uuid references auth.users (id) on delete set null,
    action      text not null,
    target      text,
    detail      jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists audit_log_recent_idx on public.audit_log (created_at desc);

-- ================================================================= funciones

-- Mantiene updated_at sin que ningun cliente tenga que acordarse.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

do $$ begin
    create trigger releases_touch     before update on public.releases
        for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
    create trigger app_config_touch   before update on public.app_config
        for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
    create trigger profiles_touch     before update on public.profiles
        for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
    create trigger game_saves_touch   before update on public.game_saves
        for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  Comparacion semantica de versiones DENTRO de la base de datos.
--
--  Devuelve -1, 0 o 1. Existe aqui, y no solo en TypeScript y en C#, porque la
--  decision de "esta version puede entrar al online" tiene que poder tomarse en
--  el servidor sin preguntarle nada al cliente.
-- ---------------------------------------------------------------------------
create or replace function public.compare_versions(a text, b text)
returns integer
language plpgsql
immutable
as $$
declare
    pa integer[];
    pb integer[];
    i  integer;
    va integer;
    vb integer;
begin
    if a is null or b is null then return 0; end if;

    pa := string_to_array(regexp_replace(a, '[^0-9.]', '', 'g'), '.')::integer[];
    pb := string_to_array(regexp_replace(b, '[^0-9.]', '', 'g'), '.')::integer[];

    for i in 1..greatest(coalesce(array_length(pa, 1), 0), coalesce(array_length(pb, 1), 0)) loop
        va := coalesce(pa[i], 0);
        vb := coalesce(pb[i], 0);

        if va > vb then return  1; end if;
        if va < vb then return -1; end if;
    end loop;

    return 0;
end;
$$;

-- ---------------------------------------------------------------------------
--  ¿Puede esta version del juego usar el online?
--
--  Es la unica respuesta que cuenta. El dialogo que Unity ensena es cortesia;
--  esta funcion es la puerta.
-- ---------------------------------------------------------------------------
create or replace function public.online_allowed(client_version text, ch release_channel default 'production')
returns boolean
language sql
stable
as $$
    select coalesce(
        (select not c.maintenance_mode
                and public.compare_versions(client_version, c.minimum_online_version) >= 0
         from public.app_config c
         where c.channel = ch),
        false);
$$;

-- ---------------------------------------------------------------------------
--  ¿Es administrador quien esta llamando?
--
--  SECURITY DEFINER para que pueda leer profiles sin quedar atrapada en la
--  propia politica que esta ayudando a evaluar.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

-- ---------------------------------------------------------------------------
--  Crea el perfil en cuanto alguien se registra, venga de Google, de Apple o
--  de un correo. Sin esto habria usuarios sin fila en profiles y cada consulta
--  tendria que contemplar ese hueco.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, friend_code)
    values (
        new.id,
        coalesce(
            new.raw_user_meta_data ->> 'full_name',
            new.raw_user_meta_data ->> 'name',
            split_part(coalesce(new.email, 'jugador'), '@', 1)
        ),
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    )
    on conflict (id) do nothing;

    insert into public.player_stats (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
end;
$$;

do $$ begin
    create trigger on_auth_user_created
        after insert on auth.users
        for each row execute function public.handle_new_user();
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
--  Registrar una ronda jugada.
--
--  Es la UNICA via por la que el saldo de confianza cambia. El cliente dice
--  cuanto apostó y cuanto le devolvieron; el servidor comprueba que la apuesta
--  cabe en el saldo, que el pago no supera un techo por juego y que no llegan
--  rondas a una velocidad imposible.
--
--  Esto no convierte el juego en servidor-autoritativo - para eso la tirada
--  tendria que decidirse aqui - pero si acota lo que un cliente modificado
--  puede reclamar, que es la diferencia entre "gana quien mas juega" y "gana
--  quien sepa editar un fichero".
-- ---------------------------------------------------------------------------
create or replace function public.submit_round(
    stake_cents  bigint,
    return_cents bigint,
    machine      text,
    max_multiple integer default 1000
)
returns public.player_stats
language plpgsql
security definer
set search_path = public
as $$
declare
    me      uuid := auth.uid();
    current public.player_stats;
begin
    if me is null then
        raise exception 'AUTH_REQUIRED' using errcode = '28000';
    end if;

    if stake_cents <= 0 or return_cents < 0 then
        raise exception 'INVALID_ROUND' using errcode = '22023';
    end if;

    select * into current from public.player_stats where user_id = me for update;

    if not found then
        insert into public.player_stats (user_id) values (me) returning * into current;
    end if;

    if stake_cents > current.balance_cents then
        raise exception 'INSUFFICIENT_FUNDS' using errcode = '22023';
    end if;

    -- Un pago mayor que el techo de la maquina solo puede venir de un cliente
    -- manipulado. Se rechaza entera en vez de recortarla, para que quede en el
    -- log como lo que es.
    if return_cents > stake_cents * max_multiple then
        raise exception 'IMPOSSIBLE_PAYOUT' using errcode = '22023';
    end if;

    -- Limite de ritmo: veinte rondas por segundo ya no las hace una persona.
    if current.last_round_at is not null
       and current.last_round_at > now() - interval '50 milliseconds' then
        raise exception 'RATE_LIMITED' using errcode = '53400';
    end if;

    update public.player_stats set
        balance_cents      = balance_cents - stake_cents + return_cents,
        total_staked_cents = total_staked_cents + stake_cents,
        total_won_cents    = total_won_cents + return_cents,
        rounds_played      = rounds_played + 1,
        biggest_win_cents  = greatest(biggest_win_cents, return_cents),
        last_round_at      = now(),
        updated_at         = now()
    where user_id = me
    returning * into current;

    return current;
end;
$$;

-- ---------------------------------------------------------------------------
--  Clasificacion publica. Devuelve nombres y saldos, nunca correos ni ids de
--  autenticacion.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(limit_count integer default 50)
returns table (
    rank          bigint,
    display_name  text,
    avatar_index  smallint,
    balance_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select row_number() over (order by s.balance_cents desc) as rank,
           p.display_name,
           p.avatar_index,
           s.balance_cents
    from public.player_stats s
    join public.profiles p on p.id = s.user_id
    order by s.balance_cents desc
    limit least(greatest(limit_count, 1), 200);
$$;
