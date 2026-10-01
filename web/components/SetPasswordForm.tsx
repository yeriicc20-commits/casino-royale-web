'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Poner (o cambiar) la contraseña de la cuenta.
 *
 * Hace falta para jugar en iPhone y en el navegador: ahí el juego no puede
 * abrir el inicio de sesión de Google, así que se entra con correo y contraseña.
 * Una cuenta creada con Google no tiene contraseña hasta que se pone aquí.
 */
export function SetPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (password.length < 8) return setMessage({ ok: false, text: 'Mínimo 8 caracteres.' });
    if (password !== repeat) return setMessage({ ok: false, text: 'Las dos contraseñas no son iguales.' });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      const reauth = /reauth|recent/i.test(error.message);
      setMessage({
        ok: false,
        text: reauth
          ? 'Por seguridad, cierra sesión, vuelve a entrar y repítelo.'
          : 'No se ha podido guardar: ' + error.message,
      });
      return;
    }
    setPassword('');
    setRepeat('');
    setMessage({ ok: true, text: 'Contraseña guardada. Ya puedes entrar con tu correo y esta contraseña en el juego.' });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="new-password">
          {hasPassword ? 'Nueva contraseña' : 'Contraseña'}
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="field"
          placeholder="Mínimo 8 caracteres"
        />
      </div>
      <div>
        <label className="label" htmlFor="repeat-password">Repítela</label>
        <input
          id="repeat-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          className="field"
        />
      </div>
      <button type="submit" disabled={busy} className="btn-gold w-full sm:w-auto">
        {busy ? 'Guardando…' : hasPassword ? 'Cambiar contraseña' : 'Poner contraseña'}
      </button>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
