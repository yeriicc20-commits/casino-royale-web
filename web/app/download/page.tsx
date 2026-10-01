import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLIC_CONFIG, formatDate } from '@/lib/config';
import { getAppConfig, getPublishedReleases, latestWith } from '@/lib/queries';
import { DownloadCards } from '@/components/DownloadCards';
import { Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Descargar',
  description: `Descarga ${PUBLIC_CONFIG.GAME_NAME} para Android, iPhone, iPad y Windows.`,
};

export const revalidate = 60;

export default async function DownloadPage() {
  const [releases, config] = await Promise.all([getPublishedReleases(), getAppConfig()]);

  const android = latestWith(releases, 'android');
  const windows = latestWith(releases, 'windows');
  const latest = releases[0] ?? null;

  return (
    <>
      <Section
        kicker="Descargas"
        title="Descargar el juego"
        lead={
          latest
            ? `Versión ${latest.version}, publicada el ${formatDate(latest.released_at)}.`
            : 'Todavía no hay ninguna versión publicada.'
        }
      >
        <DownloadCards
          android={android}
          windows={windows}
          iosStoreUrl={config?.ios_store_url ?? PUBLIC_CONFIG.IOS_APP_STORE_URL ?? null}
        />
      </Section>

      <Section kicker="Instalación" title="Cómo instalarlo en Android">
        <ol className="max-w-3xl space-y-5">
          {[
            ['Descarga el archivo', 'Pulsa «Descargar APK». El navegador puede avisar de que este tipo de archivo puede dañar el dispositivo: es el aviso estándar de Android para cualquier archivo instalable que no venga de Google Play.'],
            ['Ábrelo', 'Abre el archivo desde la notificación de descarga o desde la carpeta «Descargas».'],
            ['Concede el permiso una vez', 'Android pedirá permiso para instalar aplicaciones desde esa aplicación en concreto (normalmente tu navegador o el gestor de archivos). Desde Android 8 el permiso es por aplicación, no global, y solo hay que darlo la primera vez.'],
            ['Instala y juega', 'Pulsa «Instalar» y espera unos segundos. No hace falta cuenta para jugar sin conexión.'],
          ].map(([title, body], index) => (
            <li key={title} className="panel flex gap-5 p-6">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 font-display font-bold text-gold-400">
                {index + 1}
              </span>
              <div>
                <h3 className="heading text-base">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="panel mt-8 max-w-3xl border-amber-500/25 bg-amber-500/5 p-6">
          <h3 className="heading text-base text-amber-200">Si Android no te deja instalar</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            En algunos móviles Play Protect bloquea la instalación de aplicaciones que no
            vienen de Google Play. Si te aparece «Aplicación no segura bloqueada», pulsa
            en <strong>Más detalles</strong> y luego en <strong>Instalar de todos modos</strong>.
            Es el comportamiento normal de Android con cualquier aplicación que aún no
            está publicada en la tienda, no un problema del archivo.
          </p>
        </div>
      </Section>

      <Section kicker="iPhone y iPad" title="Cómo tenerlo en el iPhone (gratis)">
        <ol className="max-w-3xl space-y-5">
          {[
            ['Ábrelo en Safari', 'Pulsa «Jugar en iPhone» desde Safari (tiene que ser Safari, no otro navegador). El juego se carga en unos segundos; la primera vez tarda algo más.'],
            ['Pulsa Compartir', 'Es el botón del cuadrado con la flecha hacia arriba, abajo en el centro (en iPad, arriba a la derecha).'],
            ['Añadir a pantalla de inicio', 'Baja en el menú, toca «Añadir a pantalla de inicio» y luego «Añadir». Aparece el icono del casino junto a tus apps.'],
            ['Juega desde el icono', 'Se abre a pantalla completa, como una app. Tu partida se guarda en el iPhone y, con cuenta, también en el modo online (entra con tu correo y contraseña; si tu cuenta es de Google, ponle contraseña antes en «Mi cuenta» de esta web). Las novedades llegan solas.'],
          ].map(([title, body], index) => (
            <li key={title} className="panel flex gap-5 p-6">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 font-display font-bold text-gold-400">
                {index + 1}
              </span>
              <div>
                <h3 className="heading text-base">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="panel mt-8 max-w-3xl p-6">
          <p className="text-sm leading-relaxed text-slate-400">
            ¿Por qué no está en App Store? Publicar allí cuesta 99 $ al año. La versión web
            es el mismo juego, gratis, y no necesita instalar nada desde fuera de Safari.
          </p>
          <Link href="/support" className="btn-ghost mt-6">
            Más preguntas
          </Link>
        </div>
      </Section>
    </>
  );
}
