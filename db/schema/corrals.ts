import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';
import { players } from './players';

/**
 * A CORRAL — where the kriaturas live when they are not fighting.
 *
 * Its only real property is `capacity`: how many it can hold. That number is
 * the point of the whole thing, because until now a player could hatch for ever
 * and the roster just grew. A ceiling turns "another creature" into a DECISION —
 * which one do I keep — and gives coins a second thing to buy after the
 * incubator batteries.
 *
 * Same shape as `incubators` on purpose: a free one everybody is given, bigger
 * ones bought from a price list in config. Two systems that behave the same way
 * are one system to learn.
 *
 * **Nothing here ever deletes a creature.** A full corral refuses the egg; it
 * does not make room by itself. "One of yours died because you ran out of
 * space" is the kind of thing that makes somebody close the game for good.
 */
export const corrals = pgTable(
  'corrals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull().default(6),
    /** What it cost, or 0 for the one everybody starts with. */
    paidAmount: integer('paid_amount').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('corrals_player_idx').on(t.playerId),
    check('corrals_capacity_positive', sql`${t.capacity} > 0`),
    check('corrals_paid_non_negative', sql`${t.paidAmount} >= 0`),
  ],
);

export type CorralRow = typeof corrals.$inferSelect;
