'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Effect } from '@/core/effects/schema';
import { BASE_ELEMENTS, CANONICAL_EVOLUTIONS, type BaseElement } from '@/core/elements';
import { CreatureArt, type ArtElement } from '../../creature-art';
import type { ActionState } from './actions';
import { EffectsEditor } from './effects-editor';
import { ImageField } from './image-field';

/**
 * The species form, shared by "new" and "edit".
 *
 * The evolved element shown here is READ-ONLY and derived from the base element
 * — it is never submitted. On save the server derives it again from the base
 * element to create the default evolution path, so nothing the browser sends can
 * influence it.
 */

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  species?: {
    id: string;
    name: string;
    slug: string;
    baseElement: BaseElement | null;
    baseImageUrl: string | null;
    baseHp: number;
    baseAttack: number;
    baseDefense: number;
    manaCost: number;
    description: string | null;
    isPublished: boolean;
    effects: readonly Effect[];
  };
};

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? 'Guardando…' : label}
    </button>
  );
}

export function SpeciesForm({ action, submitLabel, species }: Props) {
  const [state, formAction] = useActionState(action, { ok: false } satisfies ActionState);

  const isEdit = species !== undefined;
  const [name, setName] = useState(species?.name ?? '');
  const [slug, setSlug] = useState(species?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(isEdit);
  /**
   * `null` is a real choice here, not an empty form: a species with no element
   * is born white and a stone decides what each creature becomes.
   */
  const [baseElement, setBaseElement] = useState<BaseElement | null>(
    species ? species.baseElement : 'fire',
  );

  const errorFor = (field: string): string | undefined => state.fieldErrors?.[field]?.[0];

  return (
    <form action={formAction}>
      {species ? <input type="hidden" name="id" value={species.id} /> : null}

      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor="name">Nombre</label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
            {errorFor('name') ? <p className="error">{errorFor('name')}</p> : null}
          </div>

          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor="slug">Slug</label>
            <input
              id="slug"
              name="slug"
              type="text"
              required
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
            />
            {errorFor('slug') ? <p className="error">{errorFor('slug')}</p> : null}
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="baseElement">Elemento base</label>
            {isEdit ? (
              <>
                <div className="readonly">{baseElement ?? 'sin elemento'}</div>
                <p className="small muted">
                  No se puede cambiar: las vías de evolución y el disparo en el tablero
                  dependen de él.
                </p>
              </>
            ) : (
              <select
                id="baseElement"
                name="baseElement"
                value={baseElement ?? 'none'}
                onChange={(event) =>
                  setBaseElement(
                    event.target.value === 'none' ? null : (event.target.value as BaseElement),
                  )
                }
              >
                {BASE_ELEMENTS.map((element) => (
                  <option key={element} value={element}>
                    {element}
                  </option>
                ))}
                <option value="none">sin elemento (nace blanca)</option>
              </select>
            )}
          </div>

          <div className="field" style={{ flex: '1 1 220px' }}>
            <label>Evolución por defecto (derivada)</label>
            <div className="readonly">
              {baseElement ? CANONICAL_EVOLUTIONS[baseElement] : 'una vía por cada elemento'}
            </div>
            <p className="small muted">
              {baseElement
                ? 'Solo lectura. Se crea como vía por defecto y podrás añadir otras ramas.'
                : 'Sin elemento se crean cuatro caras y cuatro vías, una por elemento: la piedra decide cuál toma cada kriatura.'}
            </p>
          </div>
        </div>

        <div className="row">
          {(
            [
              ['baseHp', 'HP base', species?.baseHp ?? 30],
              ['baseAttack', 'Ataque base', species?.baseAttack ?? 10],
              ['baseDefense', 'Defensa base', species?.baseDefense ?? 5],
              ['manaCost', 'Coste de maná', species?.manaCost ?? 12],
            ] as const
          ).map(([field, label, initial]) => (
            <div className="field" key={field} style={{ flex: '1 1 140px' }}>
              <label htmlFor={field}>{label}</label>
              <input
                id={field}
                name={field}
                type="number"
                min={field === 'baseHp' || field === 'manaCost' ? 1 : 0}
                max={field === 'manaCost' ? 100 : 9999}
                defaultValue={initial}
                required
              />
              {errorFor(field) ? <p className="error">{errorFor(field)}</p> : null}
            </div>
          ))}
        </div>

        <div className="field">
          <label htmlFor="description">Descripción</label>
          <textarea id="description" name="description" defaultValue={species?.description ?? ''} />
        </div>

        {/*
         * WHAT YOU ARE MAKING, drawn as you type.
         *
         * The generated art is what a species without a drawing looks like
         * everywhere else in the game, so showing it here is not decoration: it
         * is the only way to tell, before saving, that a white species really
         * comes out white and crownless.
         */}
        <div className="row" style={{ alignItems: 'center', gap: '0.9rem' }}>
          <CreatureArt
            element={(baseElement ?? 'none') as ArtElement}
            name={name || 'kriatura'}
            className="creature-thumb"
          />
          <div className="small muted">
            <strong>{name || 'Sin nombre'}</strong>
            <br />
            {baseElement
              ? `Carga con las gemas de ${baseElement}.`
              : 'Nace blanca. No podrá jugar hasta que una piedra le dé un elemento.'}
          </div>
        </div>

        <ImageField name="baseImage" label="Imagen base" currentUrl={species?.baseImageUrl} />

        <div className="checkbox">
          <input
            id="isPublished"
            name="isPublished"
            type="checkbox"
            defaultChecked={species?.isPublished ?? false}
            style={{ width: 'auto' }}
          />
          <label htmlFor="isPublished">Publicada</label>
        </div>
      </div>

      <EffectsEditor name="effects" initial={species?.effects} />
      {errorFor('effects') ? <p className="error">{errorFor('effects')}</p> : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
