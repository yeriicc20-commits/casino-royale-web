'use client';

import { useState } from 'react';
import { saveConfig } from '@/app/admin/actions';
import type { AppConfig } from '@/lib/types';

export function ConfigForm({ config }: { config: AppConfig }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [maintenance, setMaintenance] = useState(config.maintenance_mode);

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setMessage(null);

        const result = await saveConfig(formData);

        setBusy(false);
        setMessage(
          result.ok
            ? { ok: true, text: 'Guardado.' }
            : { ok: false, text: result.error },
        );
      }}
      className="space-y-5"
    >
      <input type="hidden" name="channel" value={config.channel} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="latest_version">Versión actual</label>
          <input
            id="latest_version"
            name="latest_version"
            defaultValue={config.latest_version}
            pattern="\d+\.\d+(\.\d+)?"
            required
            className="field font-mono"
          />
          <p className="mt-1.5 text-xs text-slate-500">
            La que el juego ofrece descargar cuando hay algo nuevo.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="minimum_online_version">
            Versión mínima para el online
          </label>
          <input
            id="minimum_online_version"
            name="minimum_online_version"
            defaultValue={config.minimum_online_version}
            pattern="\d+\.\d+(\.\d+)?"
            required
            className="field border-gold-500/30 font-mono"
          />
          <p className="mt-1.5 text-xs text-amber-300/70">
            Por debajo de esta versión, el servidor rechaza la conexión.
          </p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="ios_store_url">URL de App Store</label>
        <input
          id="ios_store_url"
          name="ios_store_url"
          type="url"
          defaultValue={config.ios_store_url ?? ''}
          placeholder="https://apps.apple.com/app/id0000000000"
          className="field"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          Déjalo vacío hasta que la aplicación esté publicada: mientras tanto, la web dice
          que no está disponible en lugar de enlazar a una página que no existe.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="maintenance_mode"
            defaultChecked={config.maintenance_mode}
            onChange={(event) => setMaintenance(event.target.checked)}
            className="mt-0.5 h-5 w-5 flex-none rounded border-white/20 bg-ink-900 text-gold-500
                       focus:ring-2 focus:ring-gold-500/40"
          />
          <span>
            <span className="block text-sm font-semibold text-white">Modo mantenimiento</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
              Cierra el modo online para todo el mundo. La web y las descargas siguen
              funcionando, y el juego sin conexión también.
            </span>
          </span>
        </label>

        {maintenance && (
          <div className="mt-4">
            <label className="label" htmlFor="maintenance_message">Mensaje</label>
            <textarea
              id="maintenance_message"
              name="maintenance_message"
              rows={2}
              defaultValue={config.maintenance_message}
              className="field resize-y"
            />
          </div>
        )}

        {!maintenance && (
          <input type="hidden" name="maintenance_message" value={config.maintenance_message} />
        )}
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy} className="btn-gold">
          {busy ? 'Guardando…' : 'Guardar configuración'}
        </button>

        {message && (
          <p className={`text-sm ${message.ok ? 'text-emerald-300' : 'text-red-300'}`} role="status">
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
