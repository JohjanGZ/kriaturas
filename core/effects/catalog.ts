import { EFFECT_TYPES, type EffectTarget, type EffectType } from './schema';

/**
 * THE SHAPE OF EVERY POWER, in one table.
 *
 * `schema.ts` says what is VALID; this says what an editor has to draw. They
 * are separate on purpose and they live side by side for the same reason: an
 * admin form that guesses which fields an effect uses drifts the day a bound
 * changes, and the drift is silent — the form offers a number the schema will
 * reject, or hides one the resolver needs.
 *
 * No words here. The panel is in Spanish, the game may not always be, and /core
 * is neither: it owns the numbers and which fields exist, and whoever draws it
 * owns the language.
 */

export type EffectNumberField = {
  readonly key: 'value' | 'duration_turns' | 'targets';
  readonly min: number;
  readonly max: number;
  readonly initial: number;
};

export type EffectSpec = {
  readonly type: EffectType;
  /** Where it lands by default. Every effect still accepts either side. */
  readonly defaultTarget: EffectTarget;
  readonly numbers: readonly EffectNumberField[];
  /** Booleans the effect carries, such as `to_self` on a mana drain. */
  readonly flags: readonly (readonly ['to_self', boolean])[];
  /**
   * A condition field this effect CANNOT go without: `damage_by_type` is
   * meaningless without an element to be strong against, and `combo_bonus`
   * without a combo length to pay out on.
   */
  readonly requiredCondition?: 'enemy_element' | 'min_combo';
};

const value = (initial: number, min = 1, max = 9999): EffectNumberField => ({
  key: 'value',
  min,
  max,
  initial,
});
const turns = (initial = 2, max = 10): EffectNumberField => ({
  key: 'duration_turns',
  min: 1,
  max,
  initial,
});
const targets: EffectNumberField = { key: 'targets', min: 1, max: 2, initial: 1 };

export const EFFECT_CATALOG: Record<EffectType, EffectSpec> = {
  damage: { type: 'damage', defaultTarget: 'enemy', numbers: [value(20)], flags: [] },
  damage_by_type: {
    type: 'damage_by_type',
    defaultTarget: 'enemy',
    numbers: [value(30)],
    flags: [],
    requiredCondition: 'enemy_element',
  },
  heal: { type: 'heal', defaultTarget: 'self', numbers: [value(15)], flags: [] },
  shield: {
    type: 'shield',
    defaultTarget: 'self',
    numbers: [value(12), turns(1, 20)],
    flags: [],
  },
  combo_bonus: {
    type: 'combo_bonus',
    defaultTarget: 'enemy',
    numbers: [value(25, 1, 500)],
    flags: [],
    requiredCondition: 'min_combo',
  },
  drain_mana: {
    type: 'drain_mana',
    defaultTarget: 'enemy',
    numbers: [value(4), targets],
    flags: [['to_self', false]],
  },
  mana_boost: {
    type: 'mana_boost',
    defaultTarget: 'self',
    numbers: [value(4), targets],
    flags: [],
  },
  absorb_fruit: { type: 'absorb_fruit', defaultTarget: 'self', numbers: [value(2)], flags: [] },
  extra_move: {
    type: 'extra_move',
    defaultTarget: 'self',
    numbers: [value(1, 1, 3)],
    flags: [],
  },
  steal_move: {
    type: 'steal_move',
    defaultTarget: 'enemy',
    numbers: [value(1, 1, 3)],
    flags: [],
  },
  poison: {
    type: 'poison',
    defaultTarget: 'enemy',
    numbers: [value(3, 1, 99), turns(2)],
    flags: [],
  },
  block_attack: {
    type: 'block_attack',
    defaultTarget: 'enemy',
    numbers: [targets, turns(1)],
    flags: [],
  },
  paralyze: {
    type: 'paralyze',
    defaultTarget: 'enemy',
    numbers: [targets, turns(1)],
    flags: [],
  },
  convert_tiles: {
    type: 'convert_tiles',
    defaultTarget: 'self',
    numbers: [value(4, 1, 12)],
    flags: [],
  },
  shuffle_board: { type: 'shuffle_board', defaultTarget: 'self', numbers: [], flags: [] },
  lifesteal: {
    type: 'lifesteal',
    defaultTarget: 'self',
    numbers: [value(30, 1, 100)],
    flags: [],
  },
  cleanse: { type: 'cleanse', defaultTarget: 'self', numbers: [], flags: [] },
  fruit_block: { type: 'fruit_block', defaultTarget: 'enemy', numbers: [turns(2)], flags: [] },
};

/**
 * The gates, in the order an editor should offer them. Every one is OPTIONAL
 * and every declared one must hold, so adding a second is a narrowing, never a
 * second chance to fire.
 */
export type ConditionFieldSpec =
  | { readonly key: 'enemy_element'; readonly kind: 'element' }
  | { readonly key: 'self_evolved'; readonly kind: 'boolean' }
  | {
      readonly key: 'min_combo' | 'min_gems' | 'self_below_percent' | 'enemy_below_percent' | 'min_fruits' | 'turn_at_least';
      readonly kind: 'number';
      readonly min: number;
      readonly max: number;
      readonly initial: number;
    };

export const CONDITION_FIELDS: readonly ConditionFieldSpec[] = [
  { key: 'enemy_element', kind: 'element' },
  { key: 'min_combo', kind: 'number', min: 2, max: 20, initial: 4 },
  { key: 'min_gems', kind: 'number', min: 1, max: 40, initial: 5 },
  { key: 'self_below_percent', kind: 'number', min: 1, max: 100, initial: 30 },
  { key: 'enemy_below_percent', kind: 'number', min: 1, max: 100, initial: 30 },
  { key: 'min_fruits', kind: 'number', min: 1, max: 60, initial: 3 },
  { key: 'turn_at_least', kind: 'number', min: 1, max: 99, initial: 5 },
  { key: 'self_evolved', kind: 'boolean' },
];

export type ConditionKey = ConditionFieldSpec['key'];

/** Every type, in the catalogue's declared order — the editor's dropdown. */
export const EFFECT_SPECS: readonly EffectSpec[] = EFFECT_TYPES.map(
  (type) => EFFECT_CATALOG[type],
);

/**
 * A new row the schema will accept: the defaults above, plus the condition the
 * type cannot live without. Returned as unknown because it is built from a
 * table, not from the union — the caller parses it like any other input.
 */
export function blankEffect(type: EffectType): Record<string, unknown> {
  const spec = EFFECT_CATALOG[type];
  const draft: Record<string, unknown> = { type, target: spec.defaultTarget };
  for (const number of spec.numbers) draft[number.key] = number.initial;
  for (const [flag, initial] of spec.flags) draft[flag] = initial;
  if (spec.requiredCondition === 'enemy_element') draft.condition = { enemy_element: 'water' };
  if (spec.requiredCondition === 'min_combo') draft.condition = { min_combo: 4 };
  return draft;
}
