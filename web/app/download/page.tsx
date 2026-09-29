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

      <Section kicker="iPhone y iPad" title="Por qué iOS funciona distinto">
        <div className="panel max-w-3xl p-7">
          <p className="text-sm leading-relaxed text-slate-300">
            En iPhone y iPad no se puede instalar una aplicación descargando un archivo
            desde una página web. Apple solo permite instalar desde App Store (o mediante
            TestFlight para pruebas, y programas de empresa para uso interno).
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Por eso la tarjeta de iOS no ofrece ninguna descarga directa: lleva a la ficha
            oficial de App Store, y las actualizaciones llegan por ahí como en cualquier
            otra aplicación. No es una limitación de este juego, es cómo funciona el
            sistema, y intentar rodearlo solo daría errores a quien lo intente.
          </p>

          <Link href="/support" className="btn-ghost mt-6">
            Más preguntas
          </Link>
        </div>
      </Section>
    </>
  );
}
