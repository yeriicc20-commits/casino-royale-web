/**
 * Configuración PÚBLICA del sitio.
 *
 * Todo lo que hay en este fichero acaba dentro del JavaScript que se descarga
 * el navegador, así que aquí no entra ningún secreto. Los secretos viven en
 * variables de entorno del servidor y se leen en `lib/supabase/admin.ts` y en
 * las rutas de API, nunca en un componente de cliente.
 *
 * La separación es literal: PUBLIC_CONFIG aquí, SERVER_SECRETS en `.env.local`
 * y en el panel de Vercel.
 */

export const PUBLIC_CONFIG = {
  /** Nombre comercial del juego. */
  GAME_NAME: 'Casino Royale',

  /** Identificador técnico. Coincide con el applicationId de Android. */
  GAME_ID: 'com.yeri.casinoroyale',

  /** Frase que acompaña al nombre en la portada y en las tarjetas sociales. */
  TAGLINE: 'Doce mesas, cero apuestas reales.',

  DESCRIPTION:
    'Un casino completo en el móvil: tragaperras, ruleta europea, blackjack, ' +
    'vídeo póker y más. Dinero ficticio, sin compras ni ingresos de ningún tipo.',

  /** Dominio público, usado por el sitemap y las etiquetas Open Graph. */
  SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://casinoroyale.example',

  /** Canal que sirve la web. Cambiarlo a 'beta' publica el canal de pruebas. */
  CHANNEL: (process.env.NEXT_PUBLIC_CHANNEL ?? 'production') as
    | 'production'
    | 'beta'
    | 'development',

  /**
   * Ficha del App Store. Se deja vacío hasta que la aplicación esté publicada;
   * mientras tanto la tarjeta de iOS lo dice en lugar de enlazar a ningún sitio.
   */
  IOS_APP_STORE_URL: process.env.NEXT_PUBLIC_IOS_APP_STORE_URL ?? '',

  /** Correo de soporte que aparece en /support y en los textos legales. */
  SUPPORT_EMAIL: 'soporte@casinoroyale.example',

  /** Repositorio de GitHub del que cuelgan las descargas (Releases). */
  GITHUB_REPO: process.env.NEXT_PUBLIC_GITHUB_REPO ?? '',
} as const;

/** Navegación principal, en un solo sitio para que el menú y el pie no discrepen. */
export const NAV_LINKS = [
  { href: '/game', label: 'El juego' },
  { href: '/download', label: 'Descargar' },
  { href: '/updates', label: 'Novedades' },
  { href: '/support', label: 'Ayuda' },
] as const;

export const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacidad' },
  { href: '/terms', label: 'Términos' },
] as const;

/** Formatea un tamaño en bytes para enseñárselo a una persona. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';

  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;

  return `${(megabytes / 1024).toFixed(2)} GB`;
}

/** Fecha en español, sin hora: en una lista de versiones la hora sobra. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';

  return new Date(value).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
