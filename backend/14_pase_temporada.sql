-- =============================================================================
-- 14 · PASE DE TEMPORADA
--
-- El pase en sí se guarda con la partida (nivel, premium y premios cogidos van
-- dentro del guardado del jugador), así que no necesita tablas nuevas.
--
-- Lo único que hace falta en el servidor es que los demás vean lo que llevas
-- puesto: el TÍTULO y el MARCO salen en la clasificación global y la de amigos.
--
-- Se puede ejecutar más de una vez sin problema.
-- Mientras no se ejecute, el juego y el ranking siguen funcionando: solo que
-- sin título ni marco al lado del nombre.
-- =============================================================================

alter table public.online_players
    add column if not exists title_id text not null default '';

alter table public.online_players
    add column if not exists frame_id text not null default '';

-- Solo ids de cosméticos (letras minúsculas, números y guion bajo).
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'online_players_title_id_format') then
        alter table public.online_players
            add constraint online_players_title_id_format check (title_id ~ '^[a-z0-9_]{0,40}$');
    end if;
    if not exists (select 1 from pg_constraint where conname = 'online_players_frame_id_format') then
        alter table public.online_players
            add constraint online_players_frame_id_format check (frame_id ~ '^[a-z0-9_]{0,40}$');
    end if;
end $$;
