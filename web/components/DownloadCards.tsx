import { formatBytes, PUBLIC_CONFIG } from '@/lib/config';
import type { Release } from '@/lib/types';
import { Badge } from '@/components/ui';

/**
 * Las tres formas de conseguir el juego.
 *
 * Android y Windows enlazan al binario; iOS enlaza al App Store y NUNCA a un
 * archivo. Esto no es una decisión de diseño, es lo que exige Apple: fuera de
 * TestFlight y de programas de empresa, un IPA no se instala desde una web, y
 * ofrecer un enlace de descarga directa solo serviría para que la gente se
 * encuentre con un error.
 */
export function DownloadCards({
  android,
  windows,
  iosStoreUrl,
}: {
  android: Release | null;
  windows: Release | null;
  iosStoreUrl: string | null;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <PlatformCard
        name="Android"
        icon={<AndroidIcon />}
        available={Boolean(android?.android_url)}
        version={android?.version}
        size={android?.android_size_bytes}
        extra={android?.android_version_code ? `versionCode ${android.android_version_code}` : undefined}
        action={
          android?.android_url
            ? { label: 'Descargar APK', href: android.android_url, download: true }
            : null
        }
        note="Se instala desde el archivo. La primera vez, Android pedirá permiso para instalar aplicaciones de esta procedencia."
        pending="Todavía no hay ninguna versión de Android publicada."
      />

      <PlatformCard
        name="iPhone y iPad"
        icon={<AppleIcon />}
        available={Boolean(iosStoreUrl)}
        version={undefined}
        size={null}
        action={iosStoreUrl ? { label: 'Ver en App Store', href: iosStoreUrl } : null}
        note="La instalación y las actualizaciones se hacen desde App Store, como marca Apple."
        pending="La versión para iPhone y iPad todavía no está publicada en App Store."
      />

      <PlatformCard
        name="Windows"
        icon={<WindowsIcon />}
        available={Boolean(windows?.windows_url)}
        version={windows?.version}
        size={windows?.windows_size_bytes}
        action={
          windows?.windows_url
            ? { label: 'Descargar para PC', href: windows.windows_url, download: true }
            : null
        }
        note="Archivo comprimido. Descomprímelo donde quieras y abre el ejecutable."
        pending="Todavía no hay ninguna versión para PC publicada."
      />
    </div>
  );
}

function PlatformCard({
  name,
  icon,
  available,
  version,
  size,
  extra,
  action,
  note,
  pending,
}: {
  name: string;
  icon: React.ReactNode;
  available: boolean;
  version?: string;
  size?: number | null;
  extra?: string;
  action: { label: string; href: string; download?: boolean } | null;
  note: string;
  pending: string;
}) {
  return (
    <article
      className={`panel flex flex-col p-7 transition-all duration-300 ${
        available ? 'hover:border-gold-500/35 hover:shadow-glow' : 'opacity-70'
      }`}
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200">
          {icon}
        </div>
        {available ? (
          <Badge tone="green">Disponible</Badge>
        ) : (
          <Badge tone="slate">Próximamente</Badge>
        )}
      </div>

      <h3 className="heading text-xl">{name}</h3>

      {available ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            {version && (
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Versión</dt>
                <dd className="mt-0.5 font-display font-bold text-gold-300">{version}</dd>
              </div>
            )}
            {size !== null && size !== undefined && (
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Tamaño</dt>
                <dd className="mt-0.5 font-display font-bold text-gold-300">{formatBytes(size)}</dd>
              </div>
            )}
          </dl>

          {extra && <p className="mt-2 text-xs text-slate-500">{extra}</p>}

          <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-400">{note}</p>

          {action && (
            <a
              href={action.href}
              {...(action.download ? { download: '' } : { target: '_blank', rel: 'noopener noreferrer' })}
              className="btn-gold mt-6 w-full"
            >
              {action.label}
            </a>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 flex-1 text-sm leading-relaxed text-slate-400">{pending}</p>
          <button type="button" disabled className="btn-ghost mt-6 w-full">
            No disponible
          </button>
        </>
      )}
    </article>
  );
}

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 10-.66-.38l-1.87 3.23a11.4 11.4 0 00-9.82 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52M7 15.25a1 1 0 110-2 1 1 0 010 2m10 0a1 1 0 110-2 1 1 0 010 2" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M17.05 12.54c-.02-2.1 1.72-3.11 1.8-3.16-0.98-1.44-2.5-1.63-3.05-1.65-1.3-.13-2.54.76-3.2.76-.66 0-1.68-.74-2.76-.72-1.42.02-2.73.82-3.46 2.09-1.47 2.56-.38 6.35 1.06 8.43.7 1.02 1.54 2.16 2.63 2.12 1.06-.04 1.46-.68 2.74-.68 1.28 0 1.64.68 2.76.66 1.14-.02 1.86-1.04 2.56-2.06.8-1.18 1.13-2.32 1.15-2.38-.02-.01-2.21-.85-2.23-3.37M14.9 5.36c.58-.71.97-1.7.86-2.68-.83.03-1.85.55-2.45 1.26-.53.62-1 1.62-.88 2.58.93.07 1.88-.47 2.47-1.16" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M3 5.6l7.2-1v6.9H3V5.6m8.3-1.2L21 3v8.5h-9.7V4.4M3 12.5h7.2v6.9L3 18.4v-5.9m8.3 0H21V21l-9.7-1.4v-7.1z" />
    </svg>
  );
}
