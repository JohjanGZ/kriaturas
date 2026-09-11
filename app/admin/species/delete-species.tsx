'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type ActionState, deleteSpeciesAction } from './actions';

function Button({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="btn-danger"
      type="submit"
      disabled={disabled || pending}
      onClick={(event) => {
        if (!confirm('¿Borrar esta especie? No se puede deshacer.')) {
          event.preventDefault();
        }
      }}
    >
      {pending ? 'Borrando…' : 'Borrar especie'}
    </button>
  );
}

export function DeleteSpecies({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, formAction] = useActionState(deleteSpeciesAction, {
    ok: false,
  } satisfies ActionState);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      {state.message && !state.ok ? <p className="error">{state.message}</p> : null}
      <Button disabled={disabled} />
    </form>
  );
}
