import { z } from 'zod';
import { baseElementSchema } from '../elements';

/**
 * OBJECTIVES — the requirements a creature must meet in matches before an
 * evolution path unlocks.
 *
 * Like effects, objectives are DATA, not code: a small fixed set of metrics,
 * each with validated params, combined by the admin. Progress is only ever
 * advanced server-side from a resolved match result. The client never reports
 * its own progress, and no objective input schema accepts a progress value.
 *
 * An objective is "completed" when its tracked counter reaches targetValue.
 * Different amounts of the same metric are different objective rows, so there
 * is exactly one source of truth for completion.
 */

export const OBJECTIVE_METRICS = [
  'matches_played',
  'matches_won',
  'damage_dealt',
  'enemies_defeated',
  'element_gems_cleared',
  'max_combo',
  'days_cared',
  'times_fed',
  'evolutions_performed',
] as const;
export type ObjectiveMetric = (typeof OBJECTIVE_METRICS)[number];
export const objectiveMetricSchema = z.enum(OBJECTIVE_METRICS);

/**
 * creature: progress is tracked per creature (this monster must earn it).
 * player:   progress is tracked once per player, across every creature.
 */
export const OBJECTIVE_SCOPES = ['creature', 'player'] as const;
export type ObjectiveScope = (typeof OBJECTIVE_SCOPES)[number];
export const objectiveScopeSchema = z.enum(OBJECTIVE_SCOPES);

/** Params are validated per metric. Metrics that take none must be an empty object. */
const noParams = z.strictObject({});

export const objectiveParamsSchema = z.discriminatedUnion('metric', [
  z.strictObject({ metric: z.literal('matches_played'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('matches_won'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('damage_dealt'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('enemies_defeated'), params: noParams.default({}) }),
  z.strictObject({
    metric: z.literal('element_gems_cleared'),
    /** The board only holds base elements, so only a base element is valid here. */
    params: z.strictObject({ element: baseElementSchema }),
  }),
  z.strictObject({ metric: z.literal('max_combo'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('days_cared'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('times_fed'), params: noParams.default({}) }),
  z.strictObject({ metric: z.literal('evolutions_performed'), params: noParams.default({}) }),
]);

export type ObjectiveParams = z.infer<typeof objectiveParamsSchema>;

export const objectiveCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, 'Use lowercase words separated by single underscores');

export const createObjectiveSchema = z.strictObject({
  code: objectiveCodeSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  metric: objectiveMetricSchema,
  scope: objectiveScopeSchema,
  targetValue: z.number().int().min(1).max(1_000_000),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const updateObjectiveSchema = createObjectiveSchema.partial().extend({ id: z.uuid() });

/** Validates that params match the metric. Call before any write. */
export function parseObjectiveParams(metric: ObjectiveMetric, params: unknown): ObjectiveParams {
  return objectiveParamsSchema.parse({ metric, params });
}

export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;
export type UpdateObjectiveInput = z.infer<typeof updateObjectiveSchema>;
