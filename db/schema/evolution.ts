import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EffectList } from '@/core/effects/schema';
import { timestamps } from './_shared';
import { elementEnum } from './enums';
import { objectives } from './objectives';
import { species } from './species';

/**
 * EVOLUTION PATHS — the branching evolutions a species offers.
 *
 * A plant species can offer poison AND rock. The player picks one per creature
 * and that pick is permanent. The choice is never free-form: it is a foreign key
 * into this table, and the server re-checks the path belongs to the creature's
 * species before writing. An unknown element simply has nowhere to be stored.
 *
 * `target_element` must be an EVOLVED element (check constraint). A path can
 * never point back at a base element, because base elements are the board gems.
 */
export const evolutionPaths = pgTable(
  'evolution_paths',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    targetElement: elementEnum('target_element').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    imagePath: text('image_path'),

    /** Applied on top of the species base stats once evolved. */
    hpBonus: integer('hp_bonus').notNull().default(0),
    attackBonus: integer('attack_bonus').notNull().default(0),
    defenseBonus: integer('defense_bonus').notNull().default(0),

    /** Effects this path unlocks, on top of the species effects. */
    effects: jsonb('effects').$type<EffectList>().notNull().default(sql`'[]'::jsonb`),

    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    /** A species cannot offer the same target element twice. */
    uniqueIndex('evolution_paths_species_target_key').on(t.speciesId, t.targetElement),
    index('evolution_paths_species_idx').on(t.speciesId),
    /** At most one default path per species. */
    uniqueIndex('evolution_paths_one_default_per_species')
      .on(t.speciesId)
      .where(sql`${t.isDefault}`),
    check(
      'evolution_paths_target_is_evolved',
      sql`${t.targetElement} in ('light', 'ice', 'poison', 'astral', 'rock')`,
    ),
    check('evolution_paths_hp_bonus_non_negative', sql`${t.hpBonus} >= 0`),
    check('evolution_paths_attack_bonus_non_negative', sql`${t.attackBonus} >= 0`),
    check('evolution_paths_defense_bonus_non_negative', sql`${t.defenseBonus} >= 0`),
    check('evolution_paths_effects_is_array', sql`jsonb_typeof(${t.effects}) = 'array'`),
  ],
);

/**
 * Which objectives must be completed before a path unlocks.
 * No rows for a path means that path has no requirements.
 */
export const evolutionRequirements = pgTable(
  'evolution_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evolutionPathId: uuid('evolution_path_id')
      .notNull()
      .references(() => evolutionPaths.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('evolution_requirements_path_objective_key').on(t.evolutionPathId, t.objectiveId),
    index('evolution_requirements_objective_idx').on(t.objectiveId),
  ],
);

export type EvolutionPathRow = typeof evolutionPaths.$inferSelect;
export type NewEvolutionPathRow = typeof evolutionPaths.$inferInsert;
export type EvolutionRequirementRow = typeof evolutionRequirements.$inferSelect;
export type NewEvolutionRequirementRow = typeof evolutionRequirements.$inferInsert;
