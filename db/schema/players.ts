import { sql } from 'drizzle-orm';
import { check, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';
import { users } from './users';

/**
 * Game profile for a user: the shared, player-level resource pool.
 *
 * food, drakofruta and coins are separate columns on purpose. There is no rate,
 * no conversion and no shared counter between them — food restores stamina,
 * drakofruta is spent only on evolution, coins only buy things (eggs).
 *
 * `evolutionsPerformed` is what makes the evolution threshold rise: the cost is
 * read from the config row and scaled by this counter. It is incremented in the
 * same transaction that spends the fruits, so it can never drift.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    food: integer('food').notNull().default(0),
    drakofruta: integer('drakofruta').notNull().default(0),
    coins: integer('coins').notNull().default(0),
    evolutionsPerformed: integer('evolutions_performed').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('players_user_id_key').on(t.userId),
    check('players_food_non_negative', sql`${t.food} >= 0`),
    check('players_drakofruta_non_negative', sql`${t.drakofruta} >= 0`),
    check('players_coins_non_negative', sql`${t.coins} >= 0`),
    check('players_evolutions_non_negative', sql`${t.evolutionsPerformed} >= 0`),
  ],
);

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
