'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { Effect } from '@/core/effects/schema';
import {
  EVOLVED_ELEMENTS,
  type Element,
  type EvolvedElement,
  pathTier,
} from '@/core/elements';
import {
  type ActionState,
  createPathAction,
  deletePathAction,
  setDefaultPathAction,
  updatePathAction,
} from './actions';
import { EffectsEditor } from './effects-editor';
import { ImageField } from './image-field';

/**
 * Evolution paths for one species — the branching part.
 *
 * The target element choices are the EVOLVED elements only, minus the ones this
 * species already offers. A base element is not offered here at all, and the
 * database refuses one regardless of what the form sends.
 */

export type PathView = {
  id: string;
  targetElement: string;
  name: string;
  isDefault: boolean;
  hpBonus: number;
  attackBonus: number;
  defenseBonus: number;
  description: string | null;
  sortOrder: number;
  effects: readonly Effect[];
  imageUrl: string | null;
  creatureCount: number;
};

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/**
 * Editing a path IN PLACE, powers included.
 *
 * It has to be editable rather than replaceable: a path a creature already
 * locked in cannot be deleted, so "delete and re-add" is not a way to retune the
 * transformed form. The element it points at stays fixed, like the species' base
 * element, because the grade of the path is DERIVED from that target.
 */
function PathEditForm({ path, speciesId }: { path: PathView; speciesId: string }) {
  const [state, save] = useActionState(updatePathAction, { ok: false } satisfies ActionState);

  return (
    <form action={save}>
      <input type="hidden" name="pathId" value={path.id} />
      <input type="hidden" name="speciesId" value={speciesId} />

      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}

      <div className="row">
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor={`name-${path.id}`}>Nombre de la vía</label>
          <input id={`name-${path.id}`} name="name" type="text" defaultValue={path.name} required />
        </div>
        <div className="field" style={{ flex: '0 0 110px' }}>
          <label htmlFor={`sort-${path.id}`}>Orden</label>
          <input
            id={`sort-${path.id}`}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={path.sortOrder}
          />
        </div>
      </div>

      <div className="row">
        {(
          [
            ['hpBonus', 'Bonus HP', path.hpBonus],
            ['attackBonus', 'Bonus ataque', path.attackBonus],
            ['defenseBonus', 'Bonus defensa', path.defenseBonus],
          ] as const
        ).map(([field, label, current]) => (
          <div className="field" key={field} style={{ flex: '1 1 140px' }}>
            <label htmlFor={`${field}-${path.id}`}>{label}</label>
            <input
              id={`${field}-${path.id}`}
              name={field}
              type="number"
              min={0}
              defaultValue={current}
            />
          </div>
        ))}
      </div>

      <div className="field">
        <label htmlFor={`desc-${path.id}`}>Descripción</label>
        <textarea id={`desc-${path.id}`} name="description" defaultValue={path.description ?? ''} />
      </div>

      <ImageField name="image" label="Imagen de la forma transformada" currentUrl={path.imageUrl} />

      <EffectsEditor
        name="effects"
        initial={path.effects}
        title="Poderes de esta vía"
        hint="Se suman a los de la especie cuando la kriatura se transforma en la partida. Aquí es donde una vía potencia la habilidad en vez de solo subir números."
      />

      <Pending label="Guardar vía" />
    </form>
  );
}

function PathRow({ path, speciesId }: { path: PathView; speciesId: string }) {
  const [defaultState, makeDefault] = useActionState(setDefaultPathAction, {
    ok: false,
  } satisfies ActionState);
  const [deleteState, remove] = useActionState(deletePathAction, {
    ok: false,
  } satisfies ActionState);

  const locked = path.creatureCount > 0;

  return (
    <>
    <tr>
      <td>
        {/*
          * EL GRADO SE DERIVA DEL DESTINO, no de una columna que pudiera
          * contradecirlo: si apunta a un elemento base es la evolución
          * ordinaria, y si apunta a uno evolucionado es la de excelente.
          * Decirlo aquí evita que alguien rellene la de excelente creyendo que
          * la va a ver cualquier kriatura.
          */}
        <span className={`tag ${pathTier(path.targetElement as Element) === 'superior' ? 'tag-excellent' : ''}`}>
          {pathTier(path.targetElement as Element) === 'superior' ? '✦ excelente' : 'normal'}
        </span>{' '}
        <strong>{path.targetElement}</strong>
        {path.isDefault ? <span className="small muted"> · por defecto</span> : null}
        <div className="small muted">{path.name}</div>
        <div className="small muted">
          {pathTier(path.targetElement as Element) === 'superior'
            ? 'Solo la toman las kriaturas con la marca ✦'
            : 'La que toma cualquier kriatura al transformarse'}
        </div>
        {path.imageUrl ? null : (
          <div className="small muted">⚠ sin imagen: se dibujará el arte generado</div>
        )}
        {deleteState.message && !deleteState.ok ? (
          <div className="error">{deleteState.message}</div>
        ) : null}
        {defaultState.message && !defaultState.ok ? (
          <div className="error">{defaultState.message}</div>
        ) : null}
      </td>
      <td className="small">
        +{path.hpBonus} HP · +{path.attackBonus} ATQ · +{path.defenseBonus} DEF
      </td>
      <td className="small">{locked ? `${path.creatureCount} kriatura(s)` : '—'}</td>
      <td style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {path.isDefault ? null : (
          <form action={makeDefault}>
            <input type="hidden" name="pathId" value={path.id} />
            <input type="hidden" name="speciesId" value={speciesId} />
            <Pending label="Hacer por defecto" />
          </form>
        )}
        <form action={remove}>
          <input type="hidden" name="pathId" value={path.id} />
          <input type="hidden" name="speciesId" value={speciesId} />
          <button className="btn-danger" type="submit" disabled={locked}>
            Borrar
          </button>
        </form>
      </td>
    </tr>
    <tr>
      <td colSpan={4}>
        <details>
          <summary className="small">
            Editar «{path.name}» · {path.effects.length} poder(es)
          </summary>
          <PathEditForm path={path} speciesId={speciesId} />
        </details>
      </td>
    </tr>
    </>
  );
}

export function PathEditor({
  speciesId,
  baseElement,
  paths,
}: {
  speciesId: string;
  /** Null for a white species, which has four of each grade instead of one. */
  baseElement: string | null;
  paths: PathView[];
}) {
  const [state, formAction] = useActionState(createPathAction, { ok: false } satisfies ActionState);

  const taken = new Set(paths.map((path) => path.targetElement));

  /**
   * Both grades are offered: the species' OWN element is the normal evolution
   * and the evolved ones are the excellent-only forms. Offering only the second
   * half is what left species created in the panel with no ordinary path at all.
   */
  const available: string[] = [
    ...(baseElement && !taken.has(baseElement) ? [baseElement] : []),
    ...EVOLVED_ELEMENTS.filter((element: EvolvedElement) => !taken.has(element)),
  ];

  /** A species with no ordinary path hands the excellent form to everybody. */
  const missingNormal = baseElement !== null && !taken.has(baseElement);

  return (
    <section className="card">
      <h2>Las dos evoluciones</h2>
      <p className="small muted">
        Cada especie nace con dos, y el <strong>grado se lee del elemento al que apuntan</strong>:
        si es su propio elemento es la <strong>normal</strong>, la que toma cualquier kriatura al
        transformarse en la partida; si es el elemento superior es la de{' '}
        <strong>excelente</strong>, reservada a las que llevan la marca ✦.
      </p>
      <p className="small muted">
        Abre «Editar» en cada una para ponerle su <strong>imagen</strong>, sus bonus y sus
        poderes. Son dos dibujos distintos: una kriatura transformada que se ve igual que antes
        es una transformación que no se nota.
      </p>

      {missingNormal ? (
        <p className="notice notice-error">
          <strong>Falta la evolución normal.</strong> Sin una vía que apunte a{' '}
          <strong>{baseElement}</strong>, cualquier kriatura que se transforme acabará tomando la
          de excelente. Créala abajo eligiendo «{baseElement}» como elemento destino.
        </p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Elemento</th>
            <th>Bonus</th>
            <th>En uso</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {paths.map((path) => (
            <PathRow key={path.id} path={path} speciesId={speciesId} />
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: '1.2rem' }}>Añadir una vía</h3>
      <p className="small muted">
        El elemento destino decide el grado: el propio de la especie es la evolución normal,
        cualquier otro es una forma solo para excelentes.
      </p>

      {available.length === 0 ? (
        <p className="small muted">
          Esta especie ya tiene una vía hacia cada elemento evolucionado disponible.
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="speciesId" value={speciesId} />

          {state.message ? (
            <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>
              {state.message}
            </p>
          ) : null}

          <div className="row">
            <div className="field" style={{ flex: '1 1 180px' }}>
              <label htmlFor="targetElement">Elemento destino</label>
              <select id="targetElement" name="targetElement" required>
                {available.map((element) => (
                  <option key={element} value={element}>
                    {element}
                    {element === baseElement ? ' — la evolución normal' : ' — solo excelentes'}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ flex: '1 1 220px' }}>
              <label htmlFor="pathName">Nombre de la vía</label>
              <input id="pathName" name="name" type="text" required placeholder="Vía roca" />
            </div>

            <div className="field" style={{ flex: '0 0 110px' }}>
              <label htmlFor="sortOrder">Orden</label>
              <input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={paths.length} />
            </div>
          </div>

          <div className="row">
            {(
              [
                ['hpBonus', 'Bonus HP'],
                ['attackBonus', 'Bonus ataque'],
                ['defenseBonus', 'Bonus defensa'],
              ] as const
            ).map(([field, label]) => (
              <div className="field" key={field} style={{ flex: '1 1 140px' }}>
                <label htmlFor={field}>{label}</label>
                <input id={field} name={field} type="number" min={0} defaultValue={0} />
              </div>
            ))}
          </div>

          <div className="field">
            <label htmlFor="pathDescription">Descripción</label>
            <textarea id="pathDescription" name="description" />
          </div>

          <ImageField name="image" label="Imagen de la forma evolucionada" />

          <EffectsEditor
            name="effects"
            initial={[]}
            title="Poderes de la vía"
            hint="Los que se suman al transformarse. Se pueden cambiar después sin borrar la vía."
          />

          <Pending label="Añadir vía" />
        </form>
      )}
    </section>
  );
}
