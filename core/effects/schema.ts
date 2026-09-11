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
  'damage',
  'damage_by_type',
  'heal',
  'shield',
  'combo_bonus',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export const EFFECT_TARGETS = ['enemy', 'self'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const effectTargetSchema = z.enum(EFFECT_TARGETS);

/** Optional gate evaluated server-side against the resolved battle context. */
export const effectConditionSchema = z
  .strictObject({
    enemy_element: elementSchema.optional(),
    min_combo: z.number().int().min(2).max(20).optional(),
    self_evolved: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, {
    message: 'A condition must constrain at least one field',
  });

const effectValue = z.number().int().min(1).max(9999);

/** Flat damage to the target. */
export const damageEffectSchema = z.strictObject({
  type: z.literal('damage'),
  target: effectTargetSchema,
  value: effectValue,
  condition: effectConditionSchema.optional(),
});

/** Damage that only applies against a specific enemy element. */
export const damageByTypeEffectSchema = z.strictObject({
  type: z.literal('damage_by_type'),
  target: effectTargetSchema,
  value: effectValue,
  condition: z.strictObject({
    enemy_element: elementSchema,
    min_combo: z.number().int().min(2).max(20).optional(),
    self_evolved: z.boolean().optional(),
  }),
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

export const effectSchema = z.discriminatedUnion('type', [
  damageEffectSchema,
  damageByTypeEffectSchema,
  healEffectSchema,
  shieldEffectSchema,
  comboBonusEffectSchema,
]);

export const effectListSchema = z.array(effectSchema).max(8);

export type Effect = z.infer<typeof effectSchema>;
export type EffectList = z.infer<typeof effectListSchema>;
export type EffectCondition = z.infer<typeof effectConditionSchema>;

/** Parses untrusted JSON (DB column, admin form) into a typed effect list. */
export function parseEffectList(value: unknown): EffectList {
  return effectListSchema.parse(value);
}
