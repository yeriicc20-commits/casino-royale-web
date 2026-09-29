import Link from 'next/link';
import { LEGAL_LINKS, NAV_LINKS, PUBLIC_CONFIG } from '@/lib/config';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-24 border-t border-white/8 bg-ink-900/60">
      <div className="shell py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <p className="heading text-lg">
              <span className="gold-text">{PUBLIC_CONFIG.GAME_NAME}</span>
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
              {PUBLIC_CONFIG.DESCRIPTION}
            </p>

            {/* Este aviso es lo primero que busca cualquiera que dude de qué
                tipo de juego es. No va escondido en los términos. */}
            <p className="mt-5 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs leading-relaxed text-gold-200/80">
              Juego de entretenimiento. El saldo es dinero ficticio y no tiene ningún valor
              real: no hay compras, ni ingresos, ni retiradas de ningún tipo.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Navegación
            </h2>
            <ul className="space-y-2 text-sm">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-slate-400 transition-colors hover:text-gold-300">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Legal
            </h2>
            <ul className="space-y-2 text-sm">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-slate-400 transition-colors hover:text-gold-300">
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={`mailto:${PUBLIC_CONFIG.SUPPORT_EMAIL}`}
                  className="text-slate-400 transition-colors hover:text-gold-300"
                >
                  Contacto
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/8 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {PUBLIC_CONFIG.GAME_NAME}. Todos los derechos reservados.</p>
          <p>Hecho con Unity · +18</p>
        </div>
      </div>
    </footer>
  );
}
