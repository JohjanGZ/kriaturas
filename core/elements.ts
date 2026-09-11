import { z } from 'zod';

/**
 * ELEMENTS
 *
 * Four BASE elements. The match-3 board only ever uses these four — never the
 * evolved ones, no matter how many evolved elements exist.
 *
 * Evolved elements are an OPEN set: a species may offer more than one evolution
 * (plant -> poison OR rock), so the evolved element is no longer a pure function
 * of the base element. What is still forbidden is a FREE choice: a player can
 * only pick from the evolution paths the admin defined for that species
 * (see db/schema/evolution.ts), and the pick is permanent.
 *
 * To add an evolved element: add it here and generate a migration. Nothing else
 * hardcodes the list.
 */

export const BASE_ELEMENTS = ['fire', 'water', 'plant', 'psychic'] as const;
export const EVOLVED_ELEMENTS = ['light', 'ice', 'poison', 'astral', 'rock'] as const;
export const ELEMENTS = [...BASE_ELEMENTS, ...EVOLVED_ELEMENTS] as const;

export type BaseElement = (typeof BASE_ELEMENTS)[number];
export type EvolvedElement = (typeof EVOLVED_ELEMENTS)[number];
export type Element = (typeof ELEMENTS)[number];

/**
 * The four canonical pairs. These are the DEFAULT evolution path created for a
 * new species and the value the admin form prefills — not a hard constraint on
 * what a species may offer.
 */
export const CANONICAL_EVOLUTIONS = {
  fire: 'light',
  water: 'ice',
  plant: 'poison',
  psychic: 'astral',
} as const satisfies Record<BaseElement, EvolvedElement>;

export function isBaseElement(value: Element): value is BaseElement {
  return (BASE_ELEMENTS as readonly string[]).includes(value);
}

export function isEvolvedElement(value: Element): value is EvolvedElement {
  return (EVOLVED_ELEMENTS as readonly string[]).includes(value);
}

/** The evolved element a species gets by default, before the admin adds paths. */
export function defaultEvolvedElementFor(base: BaseElement): EvolvedElement {
  return CANONICAL_EVOLUTIONS[base];
}

/**
 * Which board element makes this creature attack.
 *
 * ALWAYS the species base element, evolved or not. An evolved creature triggers
 * on the same base gem and only deals more damage. Never derive this from the
 * evolved element: a rock creature and a poison creature can both come from
 * plant, so that mapping is not invertible.
 */
export function triggerElementFor(speciesBaseElement: BaseElement): BaseElement {
  return speciesBaseElement;
}

export const baseElementSchema = z.enum(BASE_ELEMENTS);
export const evolvedElementSchema = z.enum(EVOLVED_ELEMENTS);
export const elementSchema = z.enum(ELEMENTS);
