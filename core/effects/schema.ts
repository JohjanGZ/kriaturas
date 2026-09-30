import { z } from 'zod';
import { elementSchema } from '../elements';

/**
 * Effects are DATA, not code.
 *
 * A small, fixed set of generic primitives is implemented once in the resolver;
 * the admin later combines them into per-species behaviour. Stored as JSONB and
 * validated with these schemas on every write AND on every read (the column is
 * only as trustworthy as the last thing that wrote to it).
 *
 * Resolution is server-side only. The client renders the result, never computes it.
 */

export const EFFECT_TYPES = [
  /** Hurting and healing. */
  'damage',
  'damage_by_type',
  'heal',
  'shield',
  'combo_bonus',
  /** Attacking the rival's ECONOMY instead of its health. */
  'drain_mana',
  'mana_boost',
  'absorb_fruit',
  /** Attacking its TURN. */
  'extra_move',
  'steal_move',
  /** Statuses that last. */
  'poison',
  'block_attack',
  'paralyze',
  /** Reaching into the board itself. */
  'convert_tiles',
  'shuffle_board',
  /** Turning a fight around. */
  'lifesteal',
  'cleanse',
  'fruit_block',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export const EFFECT_TARGETS = ['enemy', 'self'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const effectTargetSchema = z.enum(EFFECT_TARGETS);

/**
 * Optional gate, evaluated server-side against the resolved battle.
 *
 * THE GATES ARE WHERE THE VARIETY COMES FROM. Ten primitives with one trigger
 * each are ten creatures; the same ten behind eight different conditions are a
 * roster. "Heal" is a nurse; "heal when you are under a third of your health" is
 * a creature you build a team around — same primitive, different animal.
 *
 * Every declared field must hold. An absent field is not a constraint.
 */
export const effectConditionSchema = z
  .strictObject({
    /**
     * The rival LINEUP contains this element.
     *
     * A matchup bonus, not an attack on a creature: damage always lands on the
     * rival PLAYER, so "against water" can only mean "against a team that
     * brought water". That is what makes picking your pair against theirs a
     * decision rather than a guess.
     */
    enemy_element: elementSchema.optional(),
    min_combo: z.number().int().min(2).max(20).optional(),
    self_evolved: z.boolean().optional(),
    /** Gems this creature's element cleared in the move that fired it. */
    min_gems: z.number().int().min(1).max(40).optional(),
    /** Your own health, at or below this percentage. A desperation power. */
    self_below_percent: z.number().int().min(1).max(100).optional(),
    /** The rival's health, at or below this percentage. A finisher. */
    enemy_below_percent: z.number().int().min(1).max(100).optional(),
    /** Your drakofruta bar holds at least this much. */
    min_fruits: z.number().int().min(1).max(60).optional(),
    /** Not before this turn: a power that needs the fight to develop. */
    turn_at_least: z.number().int().min(1).max(99).optional(),
  })
  .refine((c) => Object.keys(c).length > 0, {
    message: 'A condition must constrain at least one field',
  });

const effectValue = z.number().int().min(1).max(9999);

/**
 * PIERCING damage: it ignores shields and it lands even when the creature
 * casting it has been blocked.
 *
 * Every attack in this game already goes to the rival PLAYER, so "direct hit"
 * described nothing. This is what makes it a power: it is the answer to a turtle
 * — the shield does not absorb it, and a `block_attack` does not catch it.
 * `damage_by_type` stays blockable and absorbable, which is the trade for its
 * bigger numbers.
 */
export const damageEffectSchema = z.strictObject({
  type: z.literal('damage'),
  target: effectTargetSchema,
  value: effectValue,
  condition: effectConditionSchema.optional(),
});

/**
 * MATCHUP damage: extra hurt when the rival lineup brought a given element.
 *
 * It is not damage to that creature — nothing ever damages a creature — it is
 * the advantage of having picked the right pair against theirs.
 */
export const damageByTypeEffectSchema = z.strictObject({
  type: z.literal('damage_by_type'),
  target: effectTargetSchema,
  value: effectValue,
  condition: effectConditionSchema.and(
    z.object({ enemy_element: elementSchema }),
  ),
});

/** Restores HP. Never stamina — stamina is not an in-battle resource. */
export const healEffectSchema = z.strictObject({
  type: z.literal('heal'),
  target: effectTargetSchema,
  value: effectValue,
  condition: effectConditionSchema.optional(),
});

/** Absorbs incoming damage for a number of turns. */
export const shieldEffectSchema = z.strictObject({
  type: z.literal('shield'),
  target: effectTargetSchema,
  value: effectValue,
  duration_turns: z.number().int().min(1).max(20).default(1),
  condition: effectConditionSchema.optional(),
});

/** Percentage bonus applied to the damage of the triggering match. */
export const comboBonusEffectSchema = z.strictObject({
  type: z.literal('combo_bonus'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(500),
  condition: z.strictObject({
    min_combo: z.number().int().min(2).max(20),
    enemy_element: elementSchema.optional(),
    self_evolved: z.boolean().optional(),
  }),
});

/**
 * How many enemy creatures a power reaches. Two is the whole lineup, so there is
 * no "all": a number the admin can read beats a word whose meaning changes when
 * the team size does.
 */
const targetCount = z.number().int().min(1).max(2).default(1);

/** Turns a status lasts. One means "their next turn only". */
const statusTurns = z.number().int().min(1).max(10).default(1);

/**
 * Takes mana off enemy creatures — and, with `to_self`, moves it to yours.
 *
 * A bar the rival was about to fire is worth more than the same number of hit
 * points, which is why this is a power and not a rounding error: it does not
 * lower what they have, it delays what they were about to do.
 */
export const drainManaEffectSchema = z.strictObject({
  type: z.literal('drain_mana'),
  target: effectTargetSchema,
  value: effectValue,
  targets: targetCount,
  /** Stolen rather than burnt: the same mana lands on your own bars. */
  to_self: z.boolean().default(false),
  condition: effectConditionSchema.optional(),
});

/** Charges YOUR lineup's bars. The partner who never gets matched gets fed. */
export const manaBoostEffectSchema = z.strictObject({
  type: z.literal('mana_boost'),
  target: effectTargetSchema,
  value: effectValue,
  targets: targetCount,
  condition: effectConditionSchema.optional(),
});

/**
 * Takes drakofruta off the rival's shared bar and adds it to yours.
 *
 * The board's fruit is contested, so this is the only power that can reach
 * across and undo the rival's progress towards a transformation.
 */
export const absorbFruitEffectSchema = z.strictObject({
  type: z.literal('absorb_fruit'),
  target: effectTargetSchema,
  value: effectValue,
  condition: effectConditionSchema.optional(),
});

/** One more move THIS turn. Capped by the engine like the alignment bonus is. */
export const extraMoveEffectSchema = z.strictObject({
  type: z.literal('extra_move'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(3).default(1),
  condition: effectConditionSchema.optional(),
});

/** Takes moves off the rival's NEXT turn. It plays shorter, not weaker. */
export const stealMoveEffectSchema = z.strictObject({
  type: z.literal('steal_move'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(3).default(1),
  condition: effectConditionSchema.optional(),
});

/**
 * Damage per MOVE, for a number of turns — the rival bleeds for playing.
 *
 * Per move and not per turn on purpose: it punishes the extra moves a big
 * alignment earns, so the rival's best turns are also its most expensive.
 */
export const poisonEffectSchema = z.strictObject({
  type: z.literal('poison'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(99),
  duration_turns: statusTurns,
  condition: effectConditionSchema.optional(),
});

/** An enemy creature's attack does not land while this lasts. */
export const blockAttackEffectSchema = z.strictObject({
  type: z.literal('block_attack'),
  target: effectTargetSchema,
  targets: targetCount,
  duration_turns: statusTurns,
  condition: effectConditionSchema.optional(),
});

/**
 * An enemy creature stops CHARGING while this lasts.
 *
 * Different from a block on purpose: a block cancels the blow it was about to
 * land, paralysis stops the bar filling at all. Blocking beats a full bar;
 * paralysing beats an empty one.
 */
export const paralyzeEffectSchema = z.strictObject({
  type: z.literal('paralyze'),
  target: effectTargetSchema,
  targets: targetCount,
  duration_turns: statusTurns,
  condition: effectConditionSchema.optional(),
});

/**
 * Turns tiles on the board into the caster's own element.
 *
 * The only power that edits the board, and it is resolved server-side like
 * everything else: the client is told which cells changed, it never picks them.
 */
export const convertTilesEffectSchema = z.strictObject({
  type: z.literal('convert_tiles'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(12),
  condition: effectConditionSchema.optional(),
});

/** Rolls a brand new board. Chaos as a weapon: nobody's plan survives it. */
export const shuffleBoardEffectSchema = z.strictObject({
  type: z.literal('shuffle_board'),
  target: effectTargetSchema,
  condition: effectConditionSchema.optional(),
});

/** Heals a PERCENTAGE of the damage this attack dealt. */
export const lifestealEffectSchema = z.strictObject({
  type: z.literal('lifesteal'),
  target: effectTargetSchema,
  value: z.number().int().min(1).max(100),
  condition: effectConditionSchema.optional(),
});

/** Clears YOUR OWN poison, blocks and paralysis. The answer to a lock. */
export const cleanseEffectSchema = z.strictObject({
  type: z.literal('cleanse'),
  target: effectTargetSchema,
  condition: effectConditionSchema.optional(),
});

/** The rival banks no drakofruta while this lasts: no transformation for them. */
export const fruitBlockEffectSchema = z.strictObject({
  type: z.literal('fruit_block'),
  target: effectTargetSchema,
  duration_turns: statusTurns,
  condition: effectConditionSchema.optional(),
});

export const effectSchema = z.discriminatedUnion('type', [
  damageEffectSchema,
  damageByTypeEffectSchema,
  healEffectSchema,
  shieldEffectSchema,
  comboBonusEffectSchema,
  drainManaEffectSchema,
  manaBoostEffectSchema,
  absorbFruitEffectSchema,
  extraMoveEffectSchema,
  stealMoveEffectSchema,
  poisonEffectSchema,
  blockAttackEffectSchema,
  paralyzeEffectSchema,
  convertTilesEffectSchema,
  shuffleBoardEffectSchema,
  lifestealEffectSchema,
  cleanseEffectSchema,
  fruitBlockEffectSchema,
]);

export const effectListSchema = z.array(effectSchema).max(8);

export type Effect = z.infer<typeof effectSchema>;
export type EffectList = z.infer<typeof effectListSchema>;
export type EffectCondition = z.infer<typeof effectConditionSchema>;

/** Parses untrusted JSON (DB column, admin form) into a typed effect list. */
export function parseEffectList(value: unknown): EffectList {
  return effectListSchema.parse(value);
}
