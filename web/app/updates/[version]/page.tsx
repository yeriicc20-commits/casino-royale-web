import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatBytes, formatDate, PUBLIC_CONFIG } from '@/lib/config';
import { getPublishedReleases, getRelease } from '@/lib/queries';
import { Badge, NoteList, Section, Stat } from '@/components/ui';

interface Props {
  params: Promise<{ version: string }>;
}

export async function generateStaticParams() {
  const releases = await getPublishedReleases();
  return releases.map((release) => ({ version: release.version }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params;
  const release = await getRelease(version);

  if (!release) return { title: 'Versión no encontrada' };

  return {
    title: `Versión ${release.version}`,
    description: release.summary || `Novedades de la versión ${release.version} de ${PUBLIC_CONFIG.GAME_NAME}.`,
    openGraph: {
      title: `${PUBLIC_CONFIG.GAME_NAME} ${release.version} — ${release.title}`,
      description: release.summary,
    },
  };
}

export const revalidate = 60;

export default async function ReleasePage({ params }: Props) {
  const { version } = await params;
  const release = await getRelease(version);

  if (!release) notFound();

  const hasTechnical = (release.notes_technical ?? []).length > 0;

  return (
    <Section>
      <Link href="/updates" className="btn-quiet mb-6 -ml-2">
        ← Todas las versiones
      </Link>

      <header className="panel-gold p-8">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{release.version}</Badge>
          <span className="text-sm text-slate-500">{formatDate(release.released_at)}</span>
        </div>

        <h1 className="heading mt-4 text-3xl sm:text-4xl">{release.title}</h1>
        {release.summary && (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">{release.summary}</p>
        )}

        <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Versión" value={release.version} />
          {release.android_version_code && (
            <Stat label="versionCode" value={release.android_version_code} />
          )}
          {release.android_size_bytes && (
            <Stat label="Android" value={formatBytes(release.android_size_bytes)} />
          )}
          {release.windows_size_bytes && (
            <Stat label="Windows" value={formatBytes(release.windows_size_bytes)} />
          )}
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          {release.android_url && (
            <a href={release.android_url} download className="btn-gold">
              Descargar APK
            </a>
          )}
          {release.windows_url && (
            <a href={release.windows_url} download className="btn-ghost">
              Descargar para PC
            </a>
          )}
          {release.ios_store_url && (
            <a href={release.ios_store_url} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              Ver en App Store
            </a>
          )}
        </div>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div className="panel space-y-8 p-7">
          <NoteList title="Novedades" items={release.notes_added ?? []} tone="green" />
          <NoteList title="Correcciones" items={release.notes_fixed ?? []} tone="red" />
          <NoteList title="Cambios" items={release.notes_changed ?? []} tone="gold" />
        </div>

        {hasTechnical && (
          <div className="panel p-7">
            <NoteList title="Cambios técnicos" items={release.notes_technical} tone="slate" />
            <p className="mt-6 text-xs leading-relaxed text-slate-500">
              Esta sección es para quien quiera saber qué cambió por debajo. No hace falta
              entenderla para jugar.
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
