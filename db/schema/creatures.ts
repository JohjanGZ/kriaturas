import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps, tstz } from './_shared';
import { evolutionPaths } from './evolution';
import { players } from './players';
import { species } from './species';

/**
 * A player-owned instance of a species.
 *
 * STAMINA IS NOT STORED. There is no stamina column and there must never be one.
 * `lastFed` is the regeneration anchor and the only stamina state that exists:
 *
 *   stamina(now) = clamp(floor((now - last_fed) / regenSeconds), 0, maxStamina)
 *
 * - Playing spends stamina by pushing last_fed FORWARD (cost * regenSeconds).
 * - Feeding restores stamina by pulling last_fed BACKWARD, clamped so the
 *   derived value can never exceed maxStamina.
 * - Absence only moves `now` forward, so it can only ever raise stamina.
 * - `now` is always the server clock. A client-supplied timestamp is never read.
 *
 * EVOLUTION happens in two steps, both permanent:
 *
 * 1. CHOOSE. The player locks `evolution_path_id` — which of the species' paths
 *    this creature will take (poison or rock, say). Written once, never changed:
 *    the service layer refuses a second write and the admin cannot reassign it.
 * 2. EVOLVE. Once the path's objectives are completed and the drakofruta is
 *    paid, `is_evolved` flips false -> true and `evolved_at` is set, ON THIS
 *    SAME ROW. No new record, never reversible.
 *
 * The check constraint enforces that an evolved creature always has both a path
 * and an instant, while an unevolved one may already have locked its path.
 */
export const creatures = pgTable(
  'creatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /** Species are templates and must not disappear from under an instance. */
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    nickname: text('nickname'),

    /** The locked-in evolution. Set once, before or at evolution time. */
    evolutionPathId: uuid('evolution_path_id').references(() => evolutionPaths.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    evolutionChosenAt: tstz('evolution_chosen_at'),

    isEvolved: boolean('is_evolved').notNull().default(false),
    evolvedAt: tstz('evolved_at'),

    /** Stamina regeneration anchor. See the note above. */
    lastFed: tstz('last_fed').notNull().defaultNow(),

    ...timestamps,
  },
  (t) => [
    index('creatures_player_id_idx').on(t.playerId),
    index('creatures_species_id_idx').on(t.speciesId),
    index('creatures_evolution_path_idx').on(t.evolutionPathId),
    check(
      'creatures_evolved_state_consistent',
      sql`(${t.isEvolved} = false and ${t.evolvedAt} is null)
          or (${t.isEvolved} = true and ${t.evolvedAt} is not null and ${t.evolutionPathId} is not null)`,
    ),
    check(
      'creatures_path_choice_consistent',
      sql`(${t.evolutionPathId} is null) = (${t.evolutionChosenAt} is null)`,
    ),
  ],
);

export type CreatureRow = typeof creatures.$inferSelect;
export type NewCreatureRow = typeof creatures.$inferInsert;
