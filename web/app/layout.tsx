import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { PUBLIC_CONFIG } from '@/lib/config';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const { GAME_NAME, TAGLINE, DESCRIPTION, SITE_URL } = PUBLIC_CONFIG;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  title: {
    default: `${GAME_NAME} — ${TAGLINE}`,
    // Cada página pone solo su nombre y esta plantilla le añade el del juego,
    // que es lo que hace que una pestaña suelta siga diciendo de qué web es.
    template: `%s — ${GAME_NAME}`,
  },

  description: DESCRIPTION,
  applicationName: GAME_NAME,

  keywords: [
    'casino', 'tragaperras', 'ruleta', 'blackjack', 'juego android',
    'dinero ficticio', 'sin apuestas reales',
  ],

  openGraph: {
    type: 'website',
    locale: 'es_ES',
    url: SITE_URL,
    siteName: GAME_NAME,
    title: `${GAME_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: GAME_NAME }],
  },

  twitter: {
    card: 'summary_large_image',
    title: `${GAME_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: ['/og.png'],
  },

  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },

  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: '#05060e',
  width: 'device-width',
  initialScale: 1,
  // Sin maximumScale: impedir el zoom deja fuera a quien lo necesita para leer.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="scroll-pt-24">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-ink-950">
        {/* Salto directo al contenido, para navegación con teclado y lectores. */}
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50
                     focus:rounded-lg focus:bg-gold-500 focus:px-4 focus:py-2 focus:text-ink-950"
        >
          Saltar al contenido
        </a>

        <div className="relative flex min-h-screen flex-col">
          {/* Resplandor de fondo. Decorativo y sin capturar clics. */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 bg-felt-radial"
          />

          <SiteHeader />

          <main id="contenido" className="relative flex-1">
            {children}
          </main>

          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
