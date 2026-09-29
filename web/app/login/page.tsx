import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Entra para guardar tu progreso y recuperarlo en otro dispositivo.',
};

/**
 * El formulario lee la URL con useSearchParams, que obliga a renderizar en el
 * cliente. Envolverlo en Suspense es lo que deja que el resto de la página se
 * siga generando en el servidor en lugar de tirar toda la ruta al cliente.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="shell py-24 text-center text-slate-500">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
