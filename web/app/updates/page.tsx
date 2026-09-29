import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@/lib/config';
import { getPublishedReleases } from '@/lib/queries';
import { Badge, Empty, Section } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Novedades',
  description: 'Historial completo de actualizaciones: qué se añadió, qué se corrigió y cuándo.',
};

export const revalidate = 60;

export default async function UpdatesPage() {
  const releases = await getPublishedReleases();
  const [latest, ...rest] = releases;

  if (!latest) {
    return (
      <Section kicker="Novedades" title="Historial de actualizaciones">
        <Empty title="Todavía no hay versiones publicadas">
          En cuanto se publique la primera, aparecerá aquí con todos sus cambios.
        </Empty>
      </Section>
    );
  }

  return (
    <>
      <Section kicker="Novedades" title="Historial de actualizaciones">
        {/* La última, destacada: es la que busca casi todo el mundo. */}
        <article className="panel-gold p-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="green">Última versión</Badge>
            <span className="font-display text-2xl font-bold text-gold-300">{latest.version}</span>
            <span className="text-sm text-slate-500">{formatDate(latest.released_at)}</span>
          </div>

          <h2 className="heading mt-4 text-2xl sm:text-3xl">{latest.title}</h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-slate-300">{latest.summary}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/updates/${latest.version}`} className="btn-gold">
              Ver los cambios
            </Link>
            <Link href="/download" className="btn-ghost">
              Descargar
            </Link>
          </div>
        </article>

        {rest.length > 0 && (
          <>
            <h2 className="heading mb-4 mt-12 text-xl">Versiones anteriores</h2>
            <ul className="space-y-3">
              {rest.map((release) => (
                <li key={release.id}>
                  <Link
                    href={`/updates/${release.version}`}
                    className="panel flex flex-wrap items-center gap-x-5 gap-y-2 p-5 transition-all
                               duration-200 hover:border-gold-500/30 hover:shadow-glow"
                  >
                    <span className="font-display text-lg font-bold text-gold-300">
                      {release.version}
                    </span>
                    <span className="flex-1 text-sm text-slate-300">{release.title}</span>
                    <span className="text-xs text-slate-500">{formatDate(release.released_at)}</span>
                    <span aria-hidden className="text-gold-500">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}
