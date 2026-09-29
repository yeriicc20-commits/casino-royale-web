'use client';

import { useState } from 'react';
import { saveRelease } from '@/app/admin/actions';
import type { Release } from '@/lib/types';

/**
 * Alta y edición de una versión.
 *
 * Las listas de cambios se escriben como texto, un punto por línea, en lugar de
 * con un editor de listas. Es lo que alguien va a pegar desde sus notas, y un
 * campo que acepta exactamente eso se rellena en diez segundos.
 */
export function ReleaseForm({ release, onDone }: { release?: Release; onDone?: () => void }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(release);

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setMessage(null);

        const result = await saveRelease(formData);

        setBusy(false);

        if (result.ok) {
          setMessage({ ok: true, text: editing ? 'Guardado.' : 'Versión creada.' });
          onDone?.();
        } else {
          setMessage({ ok: false, text: result.error });
        }
      }}
      className="space-y-6"
    >
      {release && <input type="hidden" name="id" value={release.id} />}

      {/* ------------------------------------------------------- identidad */}
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor={`v-${release?.id ?? 'new'}`}>Versión</label>
          <input
            id={`v-${release?.id ?? 'new'}`}
            name="version"
            defaultValue={release?.version ?? ''}
            placeholder="1.4.0"
            pattern="\d+\.\d+(\.\d+)?"
            required
            className="field font-mono"
          />
        </div>

        <div>
          <label className="label" htmlFor={`c-${release?.id ?? 'new'}`}>Canal</label>
          <select
            id={`c-${release?.id ?? 'new'}`}
            name="channel"
            defaultValue={release?.channel ?? 'production'}
            className="field"
          >
            <option value="production">production</option>
            <option value="beta">beta</option>
            <option value="development">development</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`s-${release?.id ?? 'new'}`}>Estado</label>
          <select
            id={`s-${release?.id ?? 'new'}`}
            name="status"
            defaultValue={release?.status ?? 'draft'}
            className="field"
          >
            <option value="draft">Borrador (no visible)</option>
            <option value="published">Publicada</option>
            <option value="archived">Archivada</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`t-${release?.id ?? 'new'}`}>Título</label>
        <input
          id={`t-${release?.id ?? 'new'}`}
          name="title"
          defaultValue={release?.title ?? ''}
          placeholder="Gran actualización"
          required
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor={`sum-${release?.id ?? 'new'}`}>Resumen</label>
        <textarea
          id={`sum-${release?.id ?? 'new'}`}
          name="summary"
          rows={2}
          defaultValue={release?.summary ?? ''}
          placeholder="Una o dos frases: lo que verá quien solo lea el titular."
          className="field resize-y"
        />
      </div>

      {/* ---------------------------------------------------------- notas */}
      <div className="grid gap-5 lg:grid-cols-2">
        <NotesField
          id={release?.id}
          name="notes_added"
          label="Novedades"
          hint="Una por línea."
          value={release?.notes_added}
          placeholder={'Nueva máquina de casino.\nNuevas animaciones.\nNuevo sistema de recompensas.'}
        />
        <NotesField
          id={release?.id}
          name="notes_fixed"
          label="Correcciones"
          hint="Una por línea."
          value={release?.notes_fixed}
          placeholder={'Corregido el recorte de las cartas.\nEl volumen de la música ya responde.'}
        />
        <NotesField
          id={release?.id}
          name="notes_changed"
          label="Cambios"
          hint="Una por línea."
          value={release?.notes_changed}
          placeholder={'Las fichas ahora están en euros.'}
        />
        <NotesField
          id={release?.id}
          name="notes_technical"
          label="Cambios técnicos"
          hint="Opcional. Se muestran aparte."
          value={release?.notes_technical}
          placeholder={'Nuevo protocolo online.\nNueva versión de API.'}
        />
      </div>

      {/* ---------------------------------------------------- distribución */}
      <fieldset className="rounded-xl border border-white/10 p-5">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-gold-400">
          Android
        </legend>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">URL del APK</label>
            <input
              name="android_url"
              type="url"
              defaultValue={release?.android_url ?? ''}
              placeholder="https://github.com/usuario/repo/releases/download/v1.4.0/casino.apk"
              className="field"
            />
          </div>
          <div>
            <label className="label">versionCode</label>
            <input
              name="android_version_code"
              type="number"
              min={1}
              defaultValue={release?.android_version_code ?? ''}
              placeholder="140"
              className="field"
            />
          </div>
          <div>
            <label className="label">Tamaño (bytes)</label>
            <input
              name="android_size_bytes"
              type="number"
              min={0}
              defaultValue={release?.android_size_bytes ?? ''}
              placeholder="71303168"
              className="field"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-white/10 p-5">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-gold-400">
          Windows e iOS
        </legend>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">URL del ZIP de Windows</label>
            <input
              name="windows_url"
              type="url"
              defaultValue={release?.windows_url ?? ''}
              className="field"
            />
          </div>
          <div>
            <label className="label">Tamaño (bytes)</label>
            <input
              name="windows_size_bytes"
              type="number"
              min={0}
              defaultValue={release?.windows_size_bytes ?? ''}
              className="field"
            />
          </div>
          <div>
            <label className="label">URL de App Store</label>
            <input
              name="ios_store_url"
              type="url"
              defaultValue={release?.ios_store_url ?? ''}
              className="field"
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label">Fecha de publicación</label>
        <input
          name="released_at"
          type="datetime-local"
          defaultValue={
            release?.released_at
              ? new Date(release.released_at).toISOString().slice(0, 16)
              : new Date().toISOString().slice(0, 16)
          }
          className="field sm:w-64"
        />
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy} className="btn-gold">
          {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear versión'}
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

function NotesField({
  id,
  name,
  label,
  hint,
  value,
  placeholder,
}: {
  id?: string;
  name: string;
  label: string;
  hint: string;
  value?: string[];
  placeholder: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={`${name}-${id ?? 'new'}`}>
        {label} <span className="font-normal normal-case text-slate-500">· {hint}</span>
      </label>
      <textarea
        id={`${name}-${id ?? 'new'}`}
        name={name}
        rows={4}
        defaultValue={(value ?? []).join('\n')}
        placeholder={placeholder}
        className="field resize-y font-mono text-xs"
      />
    </div>
  );
}
