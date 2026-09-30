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
import { users } from './users';

/**
 * Admin-created templates. Players own instances of these (see creatures).
 *
 * There is no evolved_element column: a species can offer several evolutions
 * (plant -> poison, plant -> rock), so the evolved form lives in evolution_paths.
 * What stays fixed here is base_element — the board gem that triggers this
 * creature's attack, before and after evolving — and the check constraint below
 * makes sure it is one of the four BASE elements and nothing else.
 */
export const species = pgTable(
  'species',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),

    /**
     * One of: fire, water, plant, psychic — or NULL.
     *
     * Null means the species has NO element of its own: it is born white and a
     * stone decides what it becomes, per creature (`creatures.element`). That is
     * why this is a nullable column rather than a fifth enum value: "no element"
     * is an absence, not a kind, and a placeholder element would make the thing
     * playable and trigger it on the board — exactly what must not happen.
     *
     * Immutable once creatures exist, null or not.
     */
    baseElement: elementEnum('base_element'),

    baseImagePath: text('base_image_path'),

    baseHp: integer('base_hp').notNull(),
    baseAttack: integer('base_attack').notNull(),
    baseDefense: integer('base_defense').notNull(),

    /**
     * Gems of its own element needed to fill the bar and fire the special.
     * A cheap bar fires often with a small effect; an expensive one takes
     * building but lands hard. This is what makes two creatures of the same
     * element feel different.
     */
    manaCost: integer('mana_cost').notNull().default(12),

    description: text('description'),
    isPublished: boolean('is_published').notNull().default(false),

    /** Effect primitives as validated JSON. Resolved server-side only. */
    effects: jsonb('effects').$type<EffectList>().notNull().default(sql`'[]'::jsonb`),

    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('species_slug_key').on(t.slug),
    index('species_base_element_idx').on(t.baseElement),
    index('species_is_published_idx').on(t.isPublished),
    check(
      'species_base_element_is_base',
      sql`${t.baseElement} is null or ${t.baseElement} in ('fire', 'water', 'plant', 'psychic')`,
    ),
    check('species_base_hp_positive', sql`${t.baseHp} > 0`),
    check('species_base_attack_non_negative', sql`${t.baseAttack} >= 0`),
    check('species_base_defense_non_negative', sql`${t.baseDefense} >= 0`),
    check('species_mana_cost_positive', sql`${t.manaCost} > 0`),
    check('species_effects_is_array', sql`jsonb_typeof(${t.effects}) = 'array'`),
  ],
);

/**
 * THE FOUR FACES OF AN ELEMENTLESS SPECIES.
 *
 * A white creature is not four species, it is one with four possible awakenings,
 * so this is a row per (species, element) rather than four species nobody could
 * tell apart in a roster. It holds only what CHANGES when the stone lands: the
 * name it takes and the artwork. Stats, powers and mana cost stay the species'.
 */
export const speciesForms = pgTable(
  'species_forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** The base element this face belongs to. */
    element: elementEnum('element').notNull(),
    name: text('name'),
    imagePath: text('image_path'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('species_forms_species_element_key').on(t.speciesId, t.element),
    check(
      'species_forms_element_is_base',
      sql`${t.element} in ('fire', 'water', 'plant', 'psychic')`,
    ),
  ],
);

export type SpeciesRow = typeof species.$inferSelect;
export type NewSpeciesRow = typeof species.$inferInsert;
export type SpeciesFormRow = typeof speciesForms.$inferSelect;
