-- ============================================================================
--  Casino Royale - reglas de seguridad (Row Level Security)
-- ============================================================================
--
--  Se ejecuta DESPUES de 01_schema.sql.
--
--  Row Level Security es la pieza que hace que "no te fies del cliente" sea
--  cierto de verdad: la clave anonima de Supabase es publica y va dentro de la
--  web, asi que cualquiera puede lanzar consultas con ella. Lo que decide que
--  puede leer y escribir no es el codigo de la web, son estas politicas, y se
--  evaluan dentro de Postgres.
--
--  Regla general del proyecto: RLS activado en TODAS las tablas, y ninguna
--  tabla con politica de escritura abierta.
-- ============================================================================

alter table public.releases     enable row level security;
alter table public.app_config   enable row level security;
alter table public.profiles     enable row level security;
alter table public.game_saves   enable row level security;
alter table public.player_stats enable row level security;
alter table public.audit_log    enable row level security;

-- ------------------------------------------------------------------ releases
--
--  Lectura publica, pero SOLO de lo publicado. Un borrador es una version que
--  todavia no existe para nadie, y sin este filtro la proxima actualizacion
--  seria legible por cualquiera desde el momento en que se empieza a escribir.

drop policy if exists releases_read_published on public.releases;
create policy releases_read_published
    on public.releases for select
    using (status = 'published');

drop policy if exists releases_admin_read on public.releases;
create policy releases_admin_read
    on public.releases for select
    using (public.is_admin());

drop policy if exists releases_admin_write on public.releases;
create policy releases_admin_write
    on public.releases for all
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------- app_config
--
--  Lectura publica: la web y el juego necesitan saber cual es la version actual
--  y si hay mantenimiento. Escritura solo del administrador.

drop policy if exists app_config_read on public.app_config;
create policy app_config_read
    on public.app_config for select
    using (true);

drop policy if exists app_config_admin_write on public.app_config;
create policy app_config_admin_write
    on public.app_config for all
    using (public.is_admin())
    with check (public.is_admin());

-- ------------------------------------------------------------------ profiles
--
--  Cada cual ve y edita el suyo. El rol queda fuera del alcance del propio
--  usuario: sin esa comprobacion, cualquiera podria ascenderse a administrador
--  con una sola llamada desde la consola del navegador.

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own
    on public.profiles for select
    using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
    on public.profiles for update
    using (id = auth.uid())
    with check (
        id = auth.uid()
        and role = (select role from public.profiles where id = auth.uid())
    );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write
    on public.profiles for all
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------- game_saves
--
--  Estrictamente privado. Ni siquiera el administrador lo lee desde aqui: la
--  partida de alguien no es informacion de gestion, y no hay ninguna pantalla
--  del panel que la necesite.

drop policy if exists game_saves_own on public.game_saves;
create policy game_saves_own
    on public.game_saves for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- -------------------------------------------------------------- player_stats
--
--  Lectura propia. Escritura NINGUNA: la unica forma de que estos numeros
--  cambien es submit_round(), que es SECURITY DEFINER y por tanto se salta RLS
--  a proposito, despues de haber validado la jugada.
--
--  La clasificacion publica no lee esta tabla directamente: lo hace la funcion
--  leaderboard(), que devuelve nombre y saldo y nada mas.

drop policy if exists player_stats_read_own on public.player_stats;
create policy player_stats_read_own
    on public.player_stats for select
    using (user_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------- audit_log
--
--  Solo el administrador lo lee. Lo escribe el servidor con la clave de
--  servicio, que se salta RLS.

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read
    on public.audit_log for select
    using (public.is_admin());

-- ============================================================================
--  Permisos de ejecucion de las funciones
-- ============================================================================

revoke all on function public.submit_round(bigint, bigint, text, integer) from public;
grant execute on function public.submit_round(bigint, bigint, text, integer) to authenticated;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;

grant execute on function public.compare_versions(text, text) to anon, authenticated;
grant execute on function public.online_allowed(text, release_channel) to anon, authenticated;
