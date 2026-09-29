import Link from 'next/link';
import { PUBLIC_CONFIG, formatDate } from '@/lib/config';
import { getAppConfig, getPublishedReleases, latestWith } from '@/lib/queries';
import { DownloadCards } from '@/components/DownloadCards';
import { Badge, FeatureCard, Section } from '@/components/ui';

export const revalidate = 60;

export default async function HomePage() {
  const [releases, config] = await Promise.all([getPublishedReleases(), getAppConfig()]);

  const latest = releases[0] ?? null;
  const android = latestWith(releases, 'android');
  const windows = latestWith(releases, 'windows');

  return (
    <>
      {/* ------------------------------------------------------------ portada */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2
                     rounded-full bg-gold-500/10 blur-[120px]"
        />

        <div className="shell relative py-20 text-center sm:py-28">
          {config?.maintenance_mode && (
            <div className="mx-auto mb-8 max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              {config.maintenance_message}
            </div>
          )}

          <div className="mb-6 flex justify-center">
            <Badge>Dinero ficticio · Sin compras · Sin apuestas reales</Badge>
          </div>

          <h1 className="heading animate-fade-up text-4xl leading-tight sm:text-6xl lg:text-7xl">
            <span className="gold-text animate-sheen">{PUBLIC_CONFIG.GAME_NAME}</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl animate-fade-up text-lg text-slate-300 sm:text-xl">
            {PUBLIC_CONFIG.TAGLINE}
          </p>

          <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base leading-relaxed text-slate-400">
            {PUBLIC_CONFIG.DESCRIPTION}
          </p>

          <div className="mt-10 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/download" className="btn-gold w-full sm:w-auto">
              Jugar ahora
            </Link>
            <Link href="/game" className="btn-ghost w-full sm:w-auto">
              Ver el juego
            </Link>
            <Link href="/updates" className="btn-quiet w-full sm:w-auto">
              Últimas novedades →
            </Link>
          </div>

          {latest && (
            <p className="mt-8 text-sm text-slate-500">
              Versión actual{' '}
              <Link href={`/updates/${latest.version}`} className="font-semibold text-gold-400 hover:text-gold-300">
                {latest.version}
              </Link>{' '}
              · {formatDate(latest.released_at)}
            </p>
          )}
        </div>

        {/* Marco del juego. Mientras no haya captura real, un marcador que se
            parece a la mesa en lugar de un rectángulo gris. */}
        <div className="shell relative pb-16">
          <div className="panel-gold mx-auto aspect-video max-w-4xl overflow-hidden">
            <div className="relative flex h-full items-center justify-center bg-gradient-to-br from-felt-600 via-ink-800 to-ink-900">
              <div
                aria-hidden
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, transparent, transparent 18px, rgba(255,255,255,0.03) 18px, rgba(255,255,255,0.03) 36px)',
                }}
              />
              <div className="relative text-center">
                <p className="heading text-2xl sm:text-4xl">
                  <span className="gold-text">{PUBLIC_CONFIG.GAME_NAME}</span>
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Sustituye esta caja por <code className="text-gold-400">/public/hero.png</code> o un vídeo
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- qué trae */}
      <Section
        kicker="Qué encontrarás"
        title="Un casino entero, no una máquina suelta"
        lead="Ocho mesas jugables ahora mismo, con sus reglas de verdad y sus pagos calculados, más las que van llegando."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={<span className="text-xl">🎰</span>} title="Tragaperras Royale">
            Cinco carretes, diez líneas, comodines, dispersos y tiradas gratis. RTP 96,3 %.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">🎯</span>} title="Ruleta europea">
            Un solo cero. Pleno, docenas, columnas y suertes sencillas sobre el tapete completo.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">🃏</span>} title="Blackjack">
            Planta, dobla y separa contra el crupier. El blackjack paga 3 a 2.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">🚀</span>} title="Crash">
            El multiplicador sube y tú decides cuándo bajarte. Cada segundo cuenta.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">💎</span>} title="Minas y Plinko">
            Destapa sin tocar una mina, o deja caer la bola por la pirámide.
          </FeatureCard>

          <FeatureCard icon={<span className="text-xl">🏆</span>} title="Perfil y clasificación">
            Tu progreso te sigue a otro móvil, con amigos por código y podio global.
          </FeatureCard>
        </div>
      </Section>

      {/* ------------------------------------------------------- descargas */}
      <Section
        kicker="Descargas"
        title="Consíguelo donde juegues"
        lead="Android e iOS para el bolsillo, Windows para la mesa. Es el mismo juego y la misma cuenta."
      >
        <DownloadCards
          android={android}
          windows={windows}
          iosStoreUrl={config?.ios_store_url ?? PUBLIC_CONFIG.IOS_APP_STORE_URL ?? null}
        />
      </Section>

      {/* ------------------------------------------------------ novedades */}
      {latest && (
        <Section kicker="Lo último" title={`Versión ${latest.version}`}>
          <div className="panel p-8">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>{latest.version}</Badge>
              <span className="text-sm text-slate-500">{formatDate(latest.released_at)}</span>
            </div>

            <h3 className="heading mt-4 text-2xl">{latest.title}</h3>
            <p className="mt-3 max-w-2xl leading-relaxed text-slate-400">{latest.summary}</p>

            <Link href={`/updates/${latest.version}`} className="btn-ghost mt-6">
              Ver todos los cambios
            </Link>
          </div>
        </Section>
      )}
    </>
  );
}
