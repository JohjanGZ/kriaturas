'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ImageField } from '../species/image-field';
import { type FieldActionState, saveFieldAction } from './actions';

export type FieldView = {
  kind: string;
  name: string;
  rule: string;
  icon: string;
  isEnabled: boolean;
  weight: number;
  imageUrl: string | null;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar campo'}
    </button>
  );
}

/**
 * One field, editable. Each saves on its own: uploading one background must not
 * make the admin re-fill the other nine.
 *
 * The RULE it enforces is not here and cannot be — a whirlwind shuffles the
 * board because the code says so. What this edits is the sentence that EXPLAINS
 * it, which is a different thing and the one that goes stale.
 */
export function FieldForm({ field }: { field: FieldView }) {
  const [state, save] = useActionState(saveFieldAction, { ok: false } satisfies FieldActionState);

  return (
    <form action={save} className="card" style={{ flex: '1 1 320px' }}>
      <input type="hidden" name="kind" value={field.kind} />

      <div className="row" style={{ alignItems: 'center', gap: '0.6rem' }}>
        {field.imageUrl ? (
          <img className="thumb" src={field.imageUrl} alt="" />
        ) : (
          <div className="thumb thumb-empty">sin fondo</div>
        )}
        <div>
          <strong>
            {field.icon} {field.name}
          </strong>
          <div className="small muted">{field.kind}</div>
        </div>
      </div>

      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}

      <div className="row">
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label htmlFor={`name-${field.kind}`}>Nombre</label>
          <input id={`name-${field.kind}`} name="name" type="text" defaultValue={field.name} required />
        </div>
        <div className="field" style={{ flex: '0 0 90px' }}>
          <label htmlFor={`icon-${field.kind}`}>Icono</label>
          <input id={`icon-${field.kind}`} name="icon" type="text" defaultValue={field.icon} required />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`rule-${field.kind}`}>Qué hace (una frase)</label>
        <textarea
          id={`rule-${field.kind}`}
          name="rule"
          defaultValue={field.rule}
          rows={3}
          required
        />
        <p className="small muted">
          Es lo que sale flotando al tocar la (i) durante el combate. Si no cabe en una frase,
          el jugador no lo va a recordar a mitad de partida.
        </p>
      </div>

      <ImageField name="art" label="Fondo del tablero" currentUrl={field.imageUrl} />

      <div className="row" style={{ alignItems: 'center' }}>
        <div className="checkbox">
          <input
            id={`on-${field.kind}`}
            name="isEnabled"
            type="checkbox"
            defaultChecked={field.isEnabled}
            style={{ width: 'auto' }}
          />
          <label htmlFor={`on-${field.kind}`}>Puede salir</label>
        </div>

        <div className="field" style={{ flex: '0 0 120px', marginBottom: 0 }}>
          <label htmlFor={`weight-${field.kind}`}>Frecuencia</label>
          <input
            id={`weight-${field.kind}`}
            name="weight"
            type="number"
            min={1}
            max={100}
            defaultValue={field.weight}
          />
        </div>
      </div>

      <Save />
    </form>
  );
}
