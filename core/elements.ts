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
 * The four canonical pairs — now the SUPERIOR element, reachable only by an
 * EXCELLENT creature.
 *
 * An ordinary creature evolves inside its own element (fire stays fire, bigger
 * and harder-hitting). An excellent one crosses over: fire becomes light, plant
 * becomes poison. That is the whole reward of rarity, and it is why the table
 * below stopped being "the default path" and became "the prize".
 */
export const CANONICAL_EVOLUTIONS = {
  fire: 'light',
  water: 'ice',
  plant: 'poison',
  psychic: 'astral',
} as const satisfies Record<BaseElement, EvolvedElement>;

/** The element an EXCELLENT creature of this base element transforms into. */
export function superiorElementFor(base: BaseElement): EvolvedElement {
  return CANONICAL_EVOLUTIONS[base];
}

/**
 * Which grade a path is, derived from where it points — no column needed.
 *
 * A path that targets a BASE element is the ordinary evolution (same element,
 * better stats); one that targets an evolved element is the superior form, and
 * only an excellent creature may take it.
 */
export type PathTier = 'normal' | 'superior';

export function pathTier(target: Element): PathTier {
  return isBaseElement(target) ? 'normal' : 'superior';
}

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

/**
 * THE ELEMENT A CREATURE FIGHTS WITH — the one gem on the board that charges it.
 *
 * Almost always its species'. The exception is the ELEMENTLESS species: it has
 * none of its own, is born white, and a stone writes one onto the creature. So
 * the creature's own element wins when it has one, and the species' answers
 * otherwise.
 *
 * It can return NULL, and that null is the whole mechanic: a creature no gem
 * triggers cannot fight — it would stand there for a whole battle charging
 * nothing — so `startBattle` refuses one rather than letting it be dead weight
 * on the team.
 */
export function resolveElement(
  speciesBaseElement: string | null | undefined,
  creatureElement: string | null | undefined,
): BaseElement | null {
  const wanted = creatureElement ?? speciesBaseElement ?? null;
  return wanted !== null && (BASE_ELEMENTS as readonly string[]).includes(wanted)
    ? (wanted as BaseElement)
    : null;
}

/** Can this creature be taken into a battle at all? */
export function canFight(
  speciesBaseElement: string | null | undefined,
  creatureElement: string | null | undefined,
): boolean {
  return resolveElement(speciesBaseElement, creatureElement) !== null;
}

/**
 * ONE ELEMENT PER TEAM. The first element that appears twice, or null.
 *
 * A gem charges EVERY creature of its element at once, so a pair sharing one
 * element is worth double per gem — and, worse, it deletes the decision the
 * turn is built around. "Which bar do I feed" stops being a question when both
 * bars answer to the same gem, and three quarters of the board stops mattering
 * at all.
 *
 * The terminal simulator has enforced this since it was written; the web battle
 * did not, which is how a team of two Brasillas could charge twice as fast as
 * anybody else's. One function so the picker and the server cannot disagree:
 * the client is what DRAWS the rule, `startBattle` is what enforces it.
 */
export function firstDuplicateElement(
  elements: readonly (string | null | undefined)[],
): string | null {
  const seen = new Set<string>();
  for (const element of elements) {
    if (!element) continue;
    if (seen.has(element)) return element;
    seen.add(element);
  }
  return null;
}

/**
 * Picks up to `count` items, all of DIFFERENT elements, at random.
 *
 * The same rule the player's team obeys, applied where a lineup is BUILT
 * instead of chosen: the rival pair is assembled by the server, so there is no
 * form to grey out — a pair sharing an element would just quietly fire twice as
 * often, which is the rule working against the player rather than for them.
 *
 * At random, and not the first two in the pool, because a fixed pair means every
 * battle is the same battle. Items with no element are skipped: nothing on the
 * board would ever charge them.
 *
 * Returns fewer than `count` when the pool cannot fill it. That is a real state
 * — a catalogue with one element in it — and a lineup of one is better than
 * refusing to start.
 */
export function pickDistinctElements<T>(
  items: readonly T[],
  elementOf: (item: T) => string | null | undefined,
  count: number,
  random: () => number,
): T[] {
  const remaining = [...items];
  const taken = new Set<string>();
  const picked: T[] = [];

  while (picked.length < count && remaining.length > 0) {
    const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
    const [candidate] = remaining.splice(index, 1);
    if (candidate === undefined) break;

    const element = elementOf(candidate);
    if (!element || taken.has(element)) continue;

    taken.add(element);
    picked.push(candidate);
  }

  return picked;
}
export const evolvedElementSchema = z.enum(EVOLVED_ELEMENTS);
export const elementSchema = z.enum(ELEMENTS);
