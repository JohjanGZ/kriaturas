import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, tstz } from './_shared';
import { creatures } from './creatures';
import { objectiveMetricEnum, objectiveScopeEnum } from './enums';
import { players } from './players';

/**
 * OBJECTIVES — admin-defined goals that gate evolution paths.
 *
 * The catalog row says WHAT is measured (metric + params) and HOW MUCH is needed
 * (target_value). Two paths needing different amounts of the same metric are two
 * objective rows, so completion has exactly one definition.
 */
export const objectives = pgTable(
  'objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    metric: objectiveMetricEnum('metric').notNull(),
    scope: objectiveScopeEnum('scope').notNull().default('creature'),
    targetValue: integer('target_value').notNull(),

    /** Metric-specific params, validated by core/schemas/objectives.ts. */
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('objectives_code_key').on(t.code),
    index('objectives_metric_idx').on(t.metric),
    check('objectives_target_positive', sql`${t.targetValue} > 0`),
    check('objectives_params_is_object', sql`jsonb_typeof(${t.params}) = 'object'`),
  ],
);

/**
 * Progress towards an objective. ONLY ever advanced server-side from a resolved
 * match, a completed care day, or another server-computed event. The client
 * never reports progress and no action input carries a progress value.
 *
 * creature_id null  -> player-scoped progress (one row per player + objective)
 * creature_id set   -> creature-scoped progress (one row per creature + objective)
 *
 * `completed_at` is written once, when current_value first reaches the target.
 * It is what evolution checks, so completion cannot be un-done by later edits
 * to the objective's target.
 */
export const objectiveProgress = pgTable(
  'objective_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    creatureId: uuid('creature_id').references(() => creatures.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),

    currentValue: integer('current_value').notNull().default(0),
    completedAt: tstz('completed_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('objective_progress_creature_key')
      .on(t.objectiveId, t.creatureId)
      .where(sql`${t.creatureId} is not null`),
    uniqueIndex('objective_progress_player_key')
      .on(t.objectiveId, t.playerId)
      .where(sql`${t.creatureId} is null`),
    index('objective_progress_player_idx').on(t.playerId),
    check('objective_progress_value_non_negative', sql`${t.currentValue} >= 0`),
  ],
);

export type ObjectiveRow = typeof objectives.$inferSelect;
export type NewObjectiveRow = typeof objectives.$inferInsert;
export type ObjectiveProgressRow = typeof objectiveProgress.$inferSelect;
export type NewObjectiveProgressRow = typeof objectiveProgress.$inferInsert;
