'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CreatureArt, type ArtElement } from '../creature-art';
import { type BattleActionState, startBattleAction } from './actions';

/**
 * Choosing the team. The stamina shown here is DERIVED on the server for this
 * render; the server derives it again when the battle starts, so a stale page
 * cannot sneak a tired creature into a fight.
 */

export type PickableCreature = {
  id: string;
  name: string;
  element: string;
  attack: number;
  manaCost: number;
  stamina: number;
  maxStamina: number;
  canPlay: boolean;
  isEvolved: boolean;
};

function StartButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={disabled || pending}>
      {pending ? 'Empezando…' : label}
    </button>
  );
}

export function TeamPicker({
  creatures,
  teamSize,
}: {
  creatures: PickableCreature[];
  teamSize: number;
}) {
  const [state, formAction] = useActionState(startBattleAction, {
    ok: false,
  } satisfies BattleActionState);
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string): void => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= teamSize
          ? current
          : [...current, id],
    );
  };

  const ready = picked.length === teamSize;

  return (
    <form action={formAction}>
      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}

      <p className="small muted">
        Elige {teamSize}. El tablero tiene cuatro elementos, así que los que no cubras no cargarán
        a nadie.
      </p>

      <div className="grid">
        {creatures.map((creature) => {
          const isPicked = picked.includes(creature.id);
          return (
            <button
              type="button"
              key={creature.id}
              className={`card species-card picker${isPicked ? ' picker-on' : ''}`}
              onClick={() => toggle(creature.id)}
              disabled={!creature.canPlay}
              style={{ textAlign: 'left', cursor: creature.canPlay ? 'pointer' : 'not-allowed' }}
            >
              <CreatureArt
                element={creature.element as ArtElement}
                name={creature.name}
                className="creature-thumb"
              />
              <div>
                <span className={`tag tag-${creature.element}`}>{creature.element}</span>{' '}
                {creature.isEvolved ? <span className="tag tag-muted">evolucionada</span> : null}
              </div>
              <strong>{creature.name}</strong>
              <span className="small">
                Ataque {creature.attack} · maná {creature.manaCost}
              </span>
              <span className="small muted">
                Stamina {creature.stamina}/{creature.maxStamina}
                {creature.canPlay ? '' : ' — agotada'}
              </span>
            </button>
          );
        })}
      </div>

      {picked.map((id) => (
        <input key={id} type="hidden" name="creatureIds" value={id} />
      ))}

      <StartButton
        disabled={!ready}
        label={ready ? 'Empezar partida' : `Elige ${teamSize - picked.length} más`}
      />
    </form>
  );
}
