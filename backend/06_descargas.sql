-- ============================================================================
--  Casino Royale - enlaces de descarga de la version 0.1.0
-- ============================================================================
--
--  Se ejecuta DESPUES de 05. Se puede repetir sin riesgo.
--
--  Los binarios NO viven aqui: estan en GitHub Releases, que admite 2 GB por
--  archivo y ancho de banda sin tope practico en repositorios publicos. El
--  Storage gratuito de Supabase es 1 GB en total, unos trece APK, y se acabaria
--  antes de la decima version.
--
--  A partir de la proxima version esto lo hace solo publicar-version.py; este
--  fichero existe porque la 0.1.0 se subio a mano.
-- ============================================================================

insert into public.releases (
    version, channel, status, title, summary,
    notes_added, notes_fixed, notes_changed, notes_technical,
    android_url, android_version_code, android_size_bytes,
    windows_url, windows_size_bytes,
    released_at
)
values (
    '0.1.0',
    'production',
    'published',
    'Primera versión',
    'El casino abre sus puertas: ocho juegos, perfil, amigos y clasificación, con el progreso guardado en la nube.',

    '["Ocho mesas jugables: tragaperras, ruleta europea, blackjack, póker, crash, minas, plinko y keno.",
      "Modo online: tu saldo y tus estadísticas te siguen a otro dispositivo.",
      "Amigos por código y clasificación global.",
      "Perfil con avatar, nombre y código de amigo.",
      "Ruleta diaria, regalo diario y misiones."]'::jsonb,

    '["El volumen de la música ya responde: apuntaba a la pista parada en lugar de a la que sonaba.",
      "Las cartas se recortan bien y la baraja es legible.",
      "El cohete del Crash arranca dentro del gráfico y la línea lo sigue.",
      "La línea que aparecía sobre el logo al arrancar.",
      "El tapete del blackjack ya no tapa la barra de arriba."]'::jsonb,

    '["Las fichas están en euros, sin símbolos de otra moneda.",
      "En el Plinko la bola cae más despacio y se pueden soltar varias a la vez.",
      "El botón de volver al menú es igual en los ocho juegos.",
      "Bacarrá, dados, mayor o menor y rasca y gana quedan ocultos hasta que estén terminados."]'::jsonb,

    '["Guardado con migración de esquema y verificación por checksum.",
      "Vibración real en Android al ganar."]'::jsonb,

    'https://github.com/yeriicc20-commits/casino-royale-web/releases/download/v0.1.0/CasinoRoyale-0.1.0.apk',
    1,
    75191151,

    'https://github.com/yeriicc20-commits/casino-royale-web/releases/download/v0.1.0/CasinoRoyale-0.1.0-PC.zip',
    95087719,

    now()
)
on conflict (channel, version) do update set
    status              = excluded.status,
    title               = excluded.title,
    summary             = excluded.summary,
    notes_added         = excluded.notes_added,
    notes_fixed         = excluded.notes_fixed,
    notes_changed       = excluded.notes_changed,
    notes_technical     = excluded.notes_technical,
    android_url         = excluded.android_url,
    android_version_code= excluded.android_version_code,
    android_size_bytes  = excluded.android_size_bytes,
    windows_url         = excluded.windows_url,
    windows_size_bytes  = excluded.windows_size_bytes;

-- Si quedo alguna 1.0.0 de los datos de ejemplo, fuera: ofrecia una version
-- que no existe y dejaba al juego creyendose desactualizado.
delete from public.releases where version = '1.0.0';

update public.app_config
set latest_version = '0.1.0',
    minimum_online_version = '0.1.0'
where channel = 'production';

-- ---------------------------------------------------------------- comprobacion

select version,
       status,
       case when android_url is not null then 'sí' else 'no' end as android,
       case when windows_url is not null then 'sí' else 'no' end as pc,
       round(android_size_bytes / 1048576.0, 1) as mb_android,
       round(windows_size_bytes / 1048576.0, 1) as mb_pc
from public.releases
where channel = 'production'
order by major desc, minor desc, patch desc;
