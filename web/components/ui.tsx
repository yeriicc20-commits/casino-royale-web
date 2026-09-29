import Link from 'next/link';
import type { ReactNode } from 'react';

/** Bloque de página con título y espaciado coherentes. */
export function Section({
  title,
  kicker,
  lead,
  children,
  className = '',
}: {
  title?: string;
  kicker?: string;
  lead?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`shell py-16 sm:py-20 ${className}`}>
      {(kicker || title || lead) && (
        <div className="mb-10 max-w-2xl">
          {kicker && (
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">
              {kicker}
            </p>
          )}
          {title && <h2 className="heading text-3xl sm:text-4xl">{title}</h2>}
          {lead && <p className="mt-4 text-base leading-relaxed text-slate-400">{lead}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="panel group p-6 transition-all duration-300 hover:border-gold-500/30 hover:shadow-glow">
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gold-500/25 bg-gold-500/10 text-gold-400">
        {icon}
      </div>
      <h3 className="heading mb-2 text-lg">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{children}</p>
    </div>
  );
}

/** Dato suelto con su etiqueta: versión, tamaño, fecha. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-display text-lg font-bold text-gold-300">{value}</p>
    </div>
  );
}

export function Badge({
  children,
  tone = 'gold',
}: {
  children: ReactNode;
  tone?: 'gold' | 'green' | 'red' | 'slate';
}) {
  const tones = {
    gold: 'border-gold-500/30 bg-gold-500/10 text-gold-300',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    red: 'border-ruby-500/30 bg-ruby-500/10 text-red-300',
    slate: 'border-white/12 bg-white/5 text-slate-300',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Lista de cambios de una versión. Se esconde entera si no tiene nada. */
export function NoteList({
  title,
  items,
  tone = 'gold',
}: {
  title: string;
  items: string[];
  tone?: 'gold' | 'green' | 'red' | 'slate';
}) {
  if (!items || items.length === 0) return null;

  const dot = {
    gold: 'bg-gold-400',
    green: 'bg-emerald-400',
    red: 'bg-red-400',
    slate: 'bg-slate-400',
  }[tone];

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-3 text-sm leading-relaxed text-slate-400">
            <span className={`mt-[0.45rem] h-1.5 w-1.5 flex-none rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mensaje para cuando todavía no hay contenido que enseñar. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel p-10 text-center">
      <p className="heading text-lg text-slate-300">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{children}</p>}
    </div>
  );
}

export function CTA({
  href,
  children,
  variant = 'gold',
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: 'gold' | 'ghost';
  external?: boolean;
}) {
  const className = variant === 'gold' ? 'btn-gold' : 'btn-ghost';

  if (external) {
    return (
      <a href={href} className={className} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
