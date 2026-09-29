-- ============================================================================
--  Casino Royale - borrar TODOS los jugadores del online
-- ============================================================================
--
--  Deja la clasificacion, las amistades y las partidas en la nube vacias, como
--  el primer dia.
--
--  QUE BORRA
--    - Todos los jugadores de la clasificacion
--    - Todas las amistades
--    - Todas las partidas guardadas en el servidor
--
--  QUE NO BORRA
--    - Las cuentas de la web (auth.users y profiles): son otra cosa, y borrarlas
--      dejaria a quien se hubiera registrado sin poder entrar.
--    - Tu partida del movil o del PC: esa vive en el dispositivo. La proxima vez
--      que abras el juego con conexion se volvera a publicar sola, asi que
--      apareceras de nuevo en la clasificacion con tu saldo actual.
--
--  NO SE PUEDE DESHACER.
-- ============================================================================

-- El orden importa: las amistades y los perfiles apuntan a los jugadores.
delete from public.online_friends;
delete from public.online_profiles;
delete from public.online_players;

-- ---------------------------------------------------------------- comprobacion

select 'jugadores' as tabla, count(*) as filas from public.online_players
union all
select 'amistades', count(*) from public.online_friends
union all
select 'partidas',  count(*) from public.online_profiles;
