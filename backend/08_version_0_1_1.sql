-- ============================================================================
--  Casino Royale - version 0.1.1
-- ============================================================================
--
--  Esto lo hara solo publicar-version.py en cuanto pongas RELEASE_TOKEN en
--  Vercel y en tu entorno de Windows. Mientras tanto, a mano.
-- ============================================================================

insert into public.releases (
    version, channel, status, title, summary,
    notes_added, notes_fixed, notes_changed, notes_technical,
    android_url, android_version_code, android_size_bytes,
    windows_url, windows_size_bytes,
    released_at
)
values (
    '0.1.1', 'production', 'published',
    'Sin recargas en el online',
    'El saldo del modo online ya no se rellena solo: las fichas salen de la ruleta diaria, el regalo o las misiones.',

    '["Icono propio del juego y pantalla de arranque sin el logo de Unity.",
      "Perfil con división de liga, nivel y título."]'::jsonb,

    '["Arreglado el solapamiento de la pantalla de amigos y podio en pantallas que no tienen la proporción de referencia.",
      "El saldo que ven los demás se actualiza al volver de una máquina, no solo cada treinta segundos."]'::jsonb,

    '["Al quedarte sin saldo jugando online ya no hay recarga gratuita. Las fichas se consiguen en la ruleta diaria, el regalo diario o las misiones."]'::jsonb,

    '["Sistema de ligas con temporadas semanales.",
      "Servicio central de recompensas: fichas, experiencia y cosméticos por una sola vía."]'::jsonb,

    'https://github.com/yeriicc20-commits/casino-royale-web/releases/download/v0.1.1/CasinoRoyale-0.1.1.apk',
    2,
    75253455,

    'https://github.com/yeriicc20-commits/casino-royale-web/releases/download/v0.1.1/CasinoRoyale-0.1.1-PC.zip',
    96670927,

    now()
)
on conflict (channel, version) do update set
    status = excluded.status, title = excluded.title, summary = excluded.summary,
    notes_added = excluded.notes_added, notes_fixed = excluded.notes_fixed,
    notes_changed = excluded.notes_changed, notes_technical = excluded.notes_technical,
    android_url = excluded.android_url, android_version_code = excluded.android_version_code,
    android_size_bytes = excluded.android_size_bytes,
    windows_url = excluded.windows_url, windows_size_bytes = excluded.windows_size_bytes,
    released_at = excluded.released_at;

-- La 0.1.1 pasa a ser la actual. La minima del online NO sube: quien tenga la
-- 0.1.0 puede seguir jugando conectado, porque el protocolo no ha cambiado.
update public.app_config
set latest_version = '0.1.1'
where channel = 'production';

select version, status,
       round(android_size_bytes / 1048576.0, 1) as mb_android,
       round(windows_size_bytes / 1048576.0, 1) as mb_pc
from public.releases
where channel = 'production'
order by major desc, minor desc, patch desc;
