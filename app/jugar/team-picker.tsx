'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CreatureArt, type ArtElement } from '../creature-art';
import type { BattleMode } from '@/core/fields';
import { type BattleActionState, startBattleAction } from './actions';

/**
 * Choosing the team. The stamina shown here is DERIVED on the server for this
 * render; the server derives it again when the battle starts, so a stale page
 * cannot sneak a tired creature into a fight.
 */

export type PickableCreature = {
  id: string;
  name: string;
  /** Null for a WHITE creature: no stone has given it an element yet. */
  element: string | null;
  /** Set once it evolved: what it LOOKS like, not what charges its bar. */
  evolvedElement: string | null;
  attack: number;
  manaCost: number;
  /** What the running season changed, so the number can explain itself. */
  attackDelta: number;
  manaCostDelta: number;
  stamina: number;
  maxStamina: number;
  canPlay: boolean;
  /** The rare mark: in battle it transforms into the SUPERIOR element. */
  isExcellent: boolean;
};

function StartButton({
  disabled,
  label,
  mode,
  primary,
}: {
  disabled: boolean;
  label: string;
  mode: BattleMode;
  primary: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    /**
     * The MODE rides on the button, not on a radio somewhere above it: two
     * buttons say "these are two different games" far better than one button
     * and a setting the player has to have noticed.
     */
    <button
      className={primary ? 'btn-primary' : ''}
      type="submit"
      name="mode"
      value={mode}
      disabled={disabled || pending}
    >
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

  /**
   * Elements already spoken for.
   *
   * A gem charges EVERY creature of its element at once, so a second creature
   * of an element you already picked would fill both bars off the same match —
   * double value per gem, and the decision the turn is built around gone. The
   * server refuses it too; this is so nobody has to find that out by being
   * rejected after choosing.
   */
  const taken = new Set(
    picked
      .map((id) => creatures.find((creature) => creature.id === id)?.element)
      .filter((element): element is string => Boolean(element)),
  );

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
          /**
           * A white creature is not tired, it is UNFINISHED. Saying so where
           * the player would otherwise tap it is the whole tutorial for the
           * mechanic: no gem on the board charges it, so it cannot come.
           */
          const white = creature.element === null;
          /** Its element is already on the team — and it is not the one picked. */
          const repeated =
            creature.element !== null &&
            taken.has(creature.element) &&
            !isPicked;
          const usable = creature.canPlay && !white && !repeated;
          return (
            <button
              type="button"
              key={creature.id}
              className={`card species-card picker${isPicked ? ' picker-on' : ''}`}
              onClick={() => toggle(creature.id)}
              disabled={!usable}
              style={{ textAlign: 'left', cursor: usable ? 'pointer' : 'not-allowed' }}
            >
              <CreatureArt
                element={(creature.evolvedElement ?? creature.element ?? 'none') as ArtElement}
                name={creature.name}
                className="creature-thumb"
              />
              <div>
                <span className={`tag tag-${creature.element ?? 'none'}`}>
                  {creature.element ?? 'sin elemento'}
                </span>{' '}
                {creature.isExcellent ? (
                  <span className="tag tag-excellent" title="Inmune a los nerfeos de temporada">
                    ✦ excelente
                  </span>
                ) : null}
              </div>
              <strong>{creature.name}</strong>
              <span className="small">
                Ataque {creature.attack} · maná {creature.manaCost}
              </span>
              {creature.attackDelta !== 0 || creature.manaCostDelta !== 0 ? (
                <span className="small season-tuned">
                  temporada: {creature.attackDelta > 0 ? '+' : ''}
                  {creature.attackDelta !== 0 ? `${creature.attackDelta} ataque` : ''}
                  {creature.attackDelta !== 0 && creature.manaCostDelta !== 0 ? ' · ' : ''}
                  {creature.manaCostDelta !== 0
                    ? `${creature.manaCostDelta > 0 ? '+' : ''}${creature.manaCostDelta} maná`
                    : ''}
                </span>
              ) : null}
              <span className="small muted">
                {white
                  ? 'Necesita una piedra elemental para poder luchar'
                  : repeated
                    ? `Ya llevas una kriatura de ${creature.element}: una gema cargaría las dos`
                    : `Stamina ${creature.stamina}/${creature.maxStamina}${
                        creature.canPlay ? '' : ' — agotada'
                      }`}
              </span>
            </button>
          );
        })}
      </div>

      {picked.map((id) => (
        <input key={id} type="hidden" name="creatureIds" value={id} />
      ))}

      <div className="row" style={{ gap: '0.6rem', alignItems: 'center' }}>
        <StartButton
          mode="normal"
          primary
          disabled={!ready}
          label={ready ? 'Empezar partida' : `Elige ${teamSize - picked.length} más`}
        />
        <StartButton mode="campos" primary={false} disabled={!ready} label="Jugar en un campo" />
      </div>
      <p className="small muted">
        En <strong>campo</strong> se sortea un terreno con su propia regla — se baraja el tablero
        entre turnos, hay minas con cuenta atrás, no cae drakofruta… Sale al azar y no se puede
        elegir.
      </p>
    </form>
  );
}
