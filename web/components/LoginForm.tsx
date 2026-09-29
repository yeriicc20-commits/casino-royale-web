'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Inicio de sesión.
 *
 * Tres proveedores desde el principio: Google, Apple y correo. Añadir un cuarto
 * es una entrada más en el array `PROVIDERS` y activarlo en el panel de
 * Supabase — no hace falta tocar nada más, que es justo lo que se pedía de la
 * arquitectura.
 *
 * Nota sobre Apple: exige una cuenta de Apple Developer de pago (99 $/año) para
 * emitir las claves. Google y el correo son gratis. Por eso el botón de Apple
 * está preparado pero se puede dejar apagado hasta que tengas esa cuenta.
 */

const PROVIDERS = [
  { id: 'google' as const, label: 'Continuar con Google', icon: <GoogleIcon />, enabled: true },
  { id: 'apple' as const, label: 'Continuar con Apple', icon: <AppleIcon />, enabled: true },
];

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(
    params.get('error') ? { tone: 'error', text: 'No se pudo completar el inicio de sesión.' } : null,
  );

  async function signInWithProvider(provider: 'google' | 'apple') {
    setBusy(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setMessage({ tone: 'error', text: error.message });
      setBusy(false);
    }
    // Si no hay error, el navegador ya está yéndose al proveedor.
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const supabase = createClient();

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });

      setBusy(false);

      setMessage(
        error
          ? { tone: 'error', text: traducir(error.message) }
          : { tone: 'ok', text: 'Te hemos enviado un correo para confirmar la cuenta.' },
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      setMessage({ tone: 'error', text: traducir(error.message) });
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="shell flex min-h-[70vh] items-center justify-center py-16">
      <div className="panel-gold w-full max-w-md p-8">
        <h1 className="heading text-2xl">Iniciar sesión</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Tu saldo y tu progreso te siguen a otro dispositivo. Para jugar sin conexión no
          hace falta cuenta.
        </p>

        <div className="mt-7 space-y-3">
          {PROVIDERS.filter((p) => p.enabled).map((provider) => (
            <button
              key={provider.id}
              type="button"
              disabled={busy}
              onClick={() => signInWithProvider(provider.id)}
              className="btn-ghost w-full"
            >
              {provider.icon}
              {provider.label}
            </button>
          ))}
        </div>

        <div className="my-7 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs uppercase tracking-wider text-slate-500">o con correo</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submitEmail} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="field"
              placeholder="tu@correo.com"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="field"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <button type="submit" disabled={busy} className="btn-gold w-full">
            {busy ? 'Un momento…' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        {message && (
          <p
            role="status"
            className={`mt-4 rounded-xl border p-3 text-sm ${
              message.tone === 'error'
                ? 'border-ruby-500/30 bg-ruby-500/10 text-red-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null); }}
          className="mt-5 w-full text-sm text-slate-400 hover:text-gold-300"
        >
          {mode === 'signin' ? '¿No tienes cuenta? Crear una' : '¿Ya tienes cuenta? Entrar'}
        </button>

        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          Al continuar aceptas los{' '}
          <Link href="/terms" className="text-gold-400 hover:text-gold-300">términos</Link> y la{' '}
          <Link href="/privacy" className="text-gold-400 hover:text-gold-300">política de privacidad</Link>.
        </p>
      </div>
    </div>
  );
}

/** Los mensajes de Supabase llegan en inglés y esta es la pantalla donde más duele. */
function traducir(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'El correo o la contraseña no son correctos.',
    'Email not confirmed': 'Todavía no has confirmado el correo. Revisa tu bandeja de entrada.',
    'User already registered': 'Ya existe una cuenta con ese correo.',
    'Password should be at least 6 characters': 'La contraseña es demasiado corta.',
  };

  return map[message] ?? message;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 010-4.22V7.05H2.18a11 11 0 000 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 002.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17.05 12.54c-.02-2.1 1.72-3.11 1.8-3.16-.98-1.44-2.5-1.63-3.05-1.65-1.3-.13-2.54.76-3.2.76-.66 0-1.68-.74-2.76-.72-1.42.02-2.73.82-3.46 2.09-1.47 2.56-.38 6.35 1.06 8.43.7 1.02 1.54 2.16 2.63 2.12 1.06-.04 1.46-.68 2.74-.68 1.28 0 1.64.68 2.76.66 1.14-.02 1.86-1.04 2.56-2.06.8-1.18 1.13-2.32 1.15-2.38-.02-.01-2.21-.85-2.23-3.37M14.9 5.36c.58-.71.97-1.7.86-2.68-.83.03-1.85.55-2.45 1.26-.53.62-1 1.62-.88 2.58.93.07 1.88-.47 2.47-1.16" />
    </svg>
  );
}
