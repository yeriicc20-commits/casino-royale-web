import type { MetadataRoute } from 'next';
import { PUBLIC_CONFIG } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Ni el panel ni las zonas privadas tienen por qué aparecer en Google.
      disallow: ['/admin', '/account', '/api/', '/auth/'],
    },
    sitemap: `${PUBLIC_CONFIG.SITE_URL}/sitemap.xml`,
  };
}
