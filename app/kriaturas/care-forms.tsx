'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type CareActionState, choosePathAction, evolveAction, feedAction } from './actions';

/** All three forms submit through a real `action` prop, so no transition is needed. */

function Submit({ label, disabled, danger }: { label: string; disabled?: boolean; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={danger ? 'btn-primary' : ''}
      type="submit"
      disabled={disabled === true || pending}
    >
      {pending ? '…' : label}
    </button>
  );
}

function Notice({ state }: { state: CareActionState }) {
  if (!state.message) return null;
  return <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>;
}

export function FeedForm({
  creatureId,
  food,
  isFull,
}: {
  creatureId: string;
  food: number;
  isFull: boolean;
}) {
  const [state, action] = useActionState(feedAction, { ok: false } satisfies CareActionState);

  return (
    <form action={action}>
      <Notice state={state} />
      <input type="hidden" name="creatureId" value={creatureId} />
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 0 120px', marginBottom: 0 }}>
          <label htmlFor={`food-${creatureId}`}>Comida</label>
          <input
            id={`food-${creatureId}`}
            name="foodUnits"
            type="number"
            min={1}
            max={Math.max(1, food)}
            defaultValue={1}
          />
        </div>
        <Submit
          label={isFull ? 'Ya está llena' : 'Alimentar'}
          disabled={food < 1 || isFull}
        />
      </div>
      {food < 1 ? (
        <p className="small muted">
          No te queda comida. Se consigue alineando fichas de comida en una partida.
        </p>
      ) : null}
    </form>
  );
}

export function ChoosePathForm({
  creatureId,
  pathId,
  label,
}: {
  creatureId: string;
  pathId: string;
  label: string;
}) {
  const [state, action] = useActionState(choosePathAction, { ok: false } satisfies CareActionState);

  return (
    <form action={action}>
      <Notice state={state} />
      <input type="hidden" name="creatureId" value={creatureId} />
      <input type="hidden" name="evolutionPathId" value={pathId} />
      <Submit label={label} />
    </form>
  );
}

export function EvolveForm({
  creatureId,
  pathId,
  disabled,
  hint,
}: {
  creatureId: string;
  pathId: string | null;
  disabled: boolean;
  hint: string;
}) {
  const [state, action] = useActionState(evolveAction, { ok: false } satisfies CareActionState);

  return (
    <form action={action}>
      <Notice state={state} />
      <input type="hidden" name="creatureId" value={creatureId} />
      {pathId ? <input type="hidden" name="evolutionPathId" value={pathId} /> : null}
      <Submit label="Evolucionar" disabled={disabled} danger />
      <p className="small muted">{hint}</p>
    </form>
  );
}
