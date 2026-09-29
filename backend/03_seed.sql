-- ============================================================================
--  Casino Royale - datos de ejemplo
-- ============================================================================
--
--  Se ejecuta DESPUES de 01_schema.sql y 02_policies.sql.
--  Deja la web con contenido real que mirar antes de publicar nada.
-- ============================================================================

-- Los tres canales. production es el que usa todo el mundo; beta y development
-- existen desde el principio para no tener que migrar nada cuando hagan falta.
insert into public.app_config (channel, latest_version, minimum_online_version, ios_store_url)
values
    ('production',  '1.0.0', '1.0.0', null),
    ('beta',        '1.0.0', '1.0.0', null),
    ('development', '1.0.0', '1.0.0', null)
on conflict (channel) do nothing;

insert into public.releases (
    version, channel, status, title, summary,
    notes_added, notes_fixed, notes_changed, notes_technical,
    android_url, android_version_code, android_size_bytes,
    windows_url, windows_size_bytes,
    released_at
)
values (
    '1.0.0',
    'production',
    'published',
    'Primera versión',
    'El casino abre sus puertas: ocho juegos, perfil, amigos y clasificación.',
    '["Ocho máquinas jugables: tragaperras, ruleta, blackjack, vídeo póker, crash, minas, plinko y keno.",
      "Perfil con avatar, nombre y código de amigo.",
      "Clasificación y lista de amigos.",
      "Ruleta diaria, regalo diario y misiones."]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '["Guardado local cifrado y migraciones de esquema.",
      "Vibración real en Android al ganar."]'::jsonb,
    null,
    100,
    null,
    null,
    null,
    now()
)
on conflict (channel, version) do nothing;

-- ---------------------------------------------------------------------------
--  Para darte el rol de administrador:
--
--  1. Registrate en la web con tu correo (o con Google).
--  2. Vuelve aqui, pon tu correo abajo y ejecuta SOLO estas dos lineas.
--
--  Se hace a mano a proposito: no existe ninguna via desde la web para que
--  alguien se convierta en administrador, que es justo lo que se quiere.
-- ---------------------------------------------------------------------------

-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'TU-CORREO@ejemplo.com');
