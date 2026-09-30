'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { BASE_ELEMENTS, type BaseElement } from '@/core/elements';
import { CreatureArt, type ArtElement } from '../../creature-art';
import { type ActionState, saveSpeciesFormAction } from './actions';
import { ImageField } from './image-field';

/**
 * THE FOUR FACES of a species with no element of its own.
 *
 * The creature is born white and a stone turns it into one of four — so what
 * the admin authors here is not four species, it is four ANSWERS to the same
 * one. Stats, powers and mana cost stay the species': only the name and the
 * drawing change, and keeping it to those two is what stops "one creature with
 * four faces" from quietly becoming four creatures that share a row.
 *
 * Each face saves on its own. Uploading one image must not make the admin
 * re-pick the other three.
 */

export type FormView = {
  element: BaseElement;
  name: string | null;
  imageUrl: string | null;
};

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

function FaceCard({
  speciesId,
  speciesName,
  face,
}: {
  speciesId: string;
  speciesName: string;
  face: FormView;
}) {
  const [state, save] = useActionState(saveSpeciesFormAction, { ok: false } satisfies ActionState);
  const shown = face.name ?? `${speciesName} ${face.element}`;

  return (
    <form action={save} className="card" style={{ flex: '1 1 240px' }}>
      <input type="hidden" name="speciesId" value={speciesId} />
      <input type="hidden" name="element" value={face.element} />

      <div className="row" style={{ alignItems: 'center', gap: '0.6rem' }}>
        {face.imageUrl ? (
          <img className="thumb" src={face.imageUrl} alt="" />
        ) : (
          <CreatureArt
            element={face.element as ArtElement}
            name={shown}
            className="creature-thumb"
          />
        )}
        <span className={`tag tag-${face.element}`}>{face.element}</span>
      </div>

      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}

      <div className="field">
        <label htmlFor={`face-name-${face.element}`}>Nombre de esta cara</label>
        <input
          id={`face-name-${face.element}`}
          name="name"
          type="text"
          defaultValue={face.name ?? ''}
          placeholder={shown}
        />
      </div>

      <ImageField
        name="formImage"
        label="Dibujo"
        currentUrl={face.imageUrl}
      />

      <Pending label="Guardar cara" />
    </form>
  );
}

export function FormEditor({
  speciesId,
  speciesName,
  forms,
}: {
  speciesId: string;
  speciesName: string;
  forms: FormView[];
}) {
  /** Always four, in a fixed order, even before any of them has a drawing. */
  const byElement = new Map(forms.map((form) => [form.element, form]));

  return (
    <section className="card">
      <h2>Las cuatro caras</h2>
      <p className="small muted">
        Esta especie nace <strong>blanca</strong> y no puede jugar hasta que una piedra le dé un
        elemento. Cuando eso pase toma una de estas cuatro caras. Los stats, el coste de maná y
        los poderes son los de la especie: aquí solo cambia cómo se llama y cómo se ve.
      </p>

      <div className="row" style={{ gap: '0.8rem', alignItems: 'stretch' }}>
        {BASE_ELEMENTS.map((element) => (
          <FaceCard
            key={element}
            speciesId={speciesId}
            speciesName={speciesName}
            face={byElement.get(element) ?? { element, name: null, imageUrl: null }}
          />
        ))}
      </div>
    </section>
  );
}
