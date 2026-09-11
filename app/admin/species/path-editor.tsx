'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { EVOLVED_ELEMENTS, type EvolvedElement } from '@/core/elements';
import {
  type ActionState,
  createPathAction,
  deletePathAction,
  setDefaultPathAction,
} from './actions';
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

function PathRow({ path, speciesId }: { path: PathView; speciesId: string }) {
  const [defaultState, makeDefault] = useActionState(setDefaultPathAction, {
    ok: false,
  } satisfies ActionState);
  const [deleteState, remove] = useActionState(deletePathAction, {
    ok: false,
  } satisfies ActionState);

  const locked = path.creatureCount > 0;

  return (
    <tr>
      <td>
        <strong>{path.targetElement}</strong>
        {path.isDefault ? <span className="small muted"> · por defecto</span> : null}
        <div className="small muted">{path.name}</div>
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
  );
}

export function PathEditor({
  speciesId,
  paths,
}: {
  speciesId: string;
  paths: PathView[];
}) {
  const [state, formAction] = useActionState(createPathAction, { ok: false } satisfies ActionState);

  const taken = new Set(paths.map((path) => path.targetElement));
  const available = EVOLVED_ELEMENTS.filter(
    (element: EvolvedElement) => !taken.has(element),
  );

  return (
    <section className="card">
      <h2>Vías de evolución</h2>
      <p className="small muted">
        Una especie puede ofrecer varias. El jugador elige una por kriatura y esa elección
        es permanente, así que una vía que alguien ya eligió no se puede borrar.
      </p>

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

          <Pending label="Añadir vía" />
        </form>
      )}
    </section>
  );
}
