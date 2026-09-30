import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps, tstz } from './_shared';
import { species } from './species';

/**
 * SEASONAL BALANCE — nerfing and buffing without rewriting the creature.
 *
 * A season owns a list of ADJUSTMENTS, one per species, and they are applied on
 * top of the species row when a battle reads it. The species itself is never
 * touched, which is the whole point:
 *
 *   - ending a season restores every creature to its printed numbers, with no
 *     migration and no "what was this before?" archaeology;
 *   - the history of what was nerfed, when and by how much, stays readable;
 *   - and a player looking at a creature can be shown BOTH numbers — what the
 *     species says and what this season does to it.
 */
export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    startsAt: tstz('starts_at').notNull().defaultNow(),
    endsAt: tstz('ends_at'),
    isActive: boolean('is_active').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    /** One season at a time: the index is what enforces it, not the caller. */
    uniqueIndex('seasons_one_active').on(t.isActive).where(sql`${t.isActive}`),
  ],
);

export const seasonAdjustments = pgTable(
  'season_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /**
     * Deltas, never absolute values. A delta survives a change to the species'
     * printed numbers; an absolute value would silently undo it.
     */
    attackDelta: integer('attack_delta').notNull().default(0),
    manaCostDelta: integer('mana_cost_delta').notNull().default(0),

    /** Why. A balance change nobody can explain later is a bug waiting to happen. */
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('season_adjustments_season_species_key').on(t.seasonId, t.speciesId),
    index('season_adjustments_season_idx').on(t.seasonId),
  ],
);

export type SeasonRow = typeof seasons.$inferSelect;
export type SeasonAdjustmentRow = typeof seasonAdjustments.$inferSelect;
