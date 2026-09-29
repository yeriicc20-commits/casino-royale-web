import type { MetadataRoute } from 'next';
import { PUBLIC_CONFIG } from '@/lib/config';
import { getPublishedReleases } from '@/lib/queries';

/** Sitemap generado a partir de las versiones reales, no de una lista a mano. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = PUBLIC_CONFIG.SITE_URL;
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/game`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/download`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/updates`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/support`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const releases = await getPublishedReleases();

  return [
    ...fixed,
    ...releases.map((release) => ({
      url: `${base}/updates/${release.version}`,
      lastModified: new Date(release.updated_at),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
  ];
}
