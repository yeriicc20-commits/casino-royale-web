-- ============================================================================
--  Casino Royale - nombres de usuario y version 0.1.0
-- ============================================================================
--
--  Se ejecuta DESPUES de 01, 02, 03 y 04. Se puede volver a ejecutar sin riesgo.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  1. La version de verdad es 0.1.0
-- ----------------------------------------------------------------------------
--
--  El juego se compila con bundleVersion 0.1.0, asi que Application.version
--  devuelve "0.1.0". Con 1.0.0 en la base de datos, el juego se comparaba
--  contra una version mas alta que nunca ha existido y se consideraba
--  desactualizado: pedia una actualizacion que no habia manera de instalar.

update public.app_config
set latest_version = '0.1.0',
    minimum_online_version = '0.1.0'
where channel in ('production', 'beta', 'development');

-- La version de ejemplo pasa a ser la real.
update public.releases
set version = '0.1.0',
    title = 'Primera versión',
    summary = 'El casino abre sus puertas: ocho juegos, perfil, amigos y clasificación.'
where version = '1.0.0' and channel = 'production';

-- ----------------------------------------------------------------------------
--  2. Nombres de usuario: minimo tres letras y sin repetir
-- ----------------------------------------------------------------------------
--
--  Antes de poner el indice unico hay que resolver los repetidos que ya
--  existan, porque crear un indice unico sobre datos duplicados falla y deja
--  la migracion a medias.
--
--  A los repetidos se les anade un numero: "Yeri", "Yeri 2", "Yeri 3". Se toca
--  al que llego despues, nunca al primero.

with duplicados as (
    select id,
           display_name,
           row_number() over (
               partition by lower(btrim(display_name))
               order by created_at
           ) as posicion
    from public.profiles
)
update public.profiles p
set display_name = d.display_name || ' ' || d.posicion
from duplicados d
where p.id = d.id and d.posicion > 1;

-- Los demasiado cortos se rellenan antes de exigir el minimo.
update public.profiles
set display_name = display_name || '000'
where length(btrim(display_name)) < 3;

-- Minimo tres caracteres, maximo veinticuatro.
do $$ begin
    alter table public.profiles
        add constraint profiles_name_length
        check (char_length(btrim(display_name)) between 3 and 24);
exception when duplicate_object then null; end $$;

-- Unico SIN distinguir mayusculas: "Yeri" y "YERI" son el mismo nombre para
-- cualquiera que lo lea, y permitir los dos es una invitacion a suplantar.
create unique index if not exists profiles_name_unique
    on public.profiles (lower(btrim(display_name)));

-- ----------------------------------------------------------------------------
--  3. Un nombre libre para cada cuenta nueva
-- ----------------------------------------------------------------------------
--
--  Sin esto, el segundo que se registre con un correo que empiece igual choca
--  contra el indice unico y el alta falla entera, sin poder explicar por que.

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

    -- Solo letras, numeros, espacios y guiones: un nombre con saltos de linea
    -- o caracteres de control rompe cualquier lista donde aparezca.
    base := regexp_replace(base, '[^[:alnum:] _-]', '', 'g');
    base := btrim(base);

    if char_length(base) < 3 then base := 'Jugador'; end if;
    if char_length(base) > 20 then base := substr(base, 1, 20); end if;

    candidate := base;

    while exists (
        select 1 from public.profiles
        where lower(btrim(display_name)) = lower(candidate)
    ) loop
        n := n + 1;
        candidate := base || ' ' || n;

        -- Tope de seguridad: si hay mil "Jugador", se corta en vez de girar
        -- para siempre.
        if n > 999 then
            candidate := base || ' ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
            exit;
        end if;
    end loop;

    return candidate;
end;
$$;

-- El alta de usuario pasa a usarlo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    wanted text;
begin
    wanted := coalesce(
        new.raw_user_meta_data ->> 'display_name',
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        split_part(coalesce(new.email, 'Jugador'), '@', 1)
    );

    insert into public.profiles (id, display_name, friend_code)
    values (
        new.id,
        public.free_display_name(wanted),
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    )
    on conflict (id) do nothing;

    insert into public.player_stats (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
end;
$$;

-- ----------------------------------------------------------------------------
--  4. Comprobar un nombre desde la web, antes de enviar el formulario
-- ----------------------------------------------------------------------------
--
--  Es SECURITY DEFINER y devuelve solo un booleano: cualquiera puede preguntar
--  si un nombre esta libre, pero nadie puede listar quien lo tiene.

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
       );
$$;

grant execute on function public.display_name_available(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
--  5. Comprobacion
-- ----------------------------------------------------------------------------

select 'version' as que, latest_version as valor from public.app_config where channel = 'production'
union all
select 'publicada', version from public.releases where channel = 'production' limit 1;
