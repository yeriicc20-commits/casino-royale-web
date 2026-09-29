import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="shell flex min-h-[70vh] flex-col items-center justify-center py-20 text-center">
      <p className="font-display text-7xl font-black text-gold-500/25 sm:text-9xl">404</p>

      <h1 className="heading mt-2 text-2xl sm:text-3xl">Esta mesa no existe</h1>

      <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
        La página que buscabas no está aquí. Puede que el enlace sea antiguo o que la
        versión que intentabas ver ya no esté publicada.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/" className="btn-gold">Volver al inicio</Link>
        <Link href="/updates" className="btn-ghost">Ver las novedades</Link>
      </div>
    </div>
  );
}
