'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV_LINKS, PUBLIC_CONFIG } from '@/lib/config';

/**
 * Cabecera del sitio.
 *
 * En móvil colapsa a un menú desplegable. El botón de descarga se queda SIEMPRE
 * visible, también en pantallas estrechas: es lo que viene a hacer casi todo el
 * mundo que llega aquí.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-ink-950/85 backdrop-blur-lg">
      <nav className="shell flex h-16 items-center justify-between gap-4" aria-label="Principal">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          onClick={() => setOpen(false)}
        >
          <ChipMark />
          <span className="heading text-base sm:text-lg">
            <span className="gold-text">{PUBLIC_CONFIG.GAME_NAME}</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  active ? 'text-gold-300' : 'text-slate-300 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/account" className="hidden text-sm text-slate-300 hover:text-gold-300 sm:block">
            Mi cuenta
          </Link>

          <Link href="/download" className="btn-gold px-4 py-2 text-xs sm:px-5 sm:text-sm">
            Descargar
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="menu-movil"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            className="rounded-lg border border-white/12 p-2 text-slate-200 md:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div id="menu-movil" className="border-t border-white/8 bg-ink-900/95 md:hidden">
          <div className="shell flex flex-col py-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-sm text-slate-200 hover:bg-white/5 hover:text-gold-300"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-3 text-sm text-slate-200 hover:bg-white/5 hover:text-gold-300"
            >
              Mi cuenta
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/** Ficha de casino dibujada en SVG: nítida a cualquier tamaño y sin descargar nada. */
function ChipMark() {
  return (
    <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
      <circle cx="20" cy="20" r="18" fill="#0d1024" stroke="#f0b429" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#f0b429" strokeWidth="1.5" opacity="0.6" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect
          key={angle}
          x="18.5"
          y="1.5"
          width="3"
          height="6"
          rx="1"
          fill="#ffd166"
          transform={`rotate(${angle} 20 20)`}
        />
      ))}
      <text
        x="20" y="24.5"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="11"
        fontWeight="bold"
        fill="#ffd166"
      >
        CR
      </text>
    </svg>
  );
}
