import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';
import { users } from './users';

/**
 * Game profile for a user: the shared, player-level resource pool.
 *
 * food and coins are separate columns on purpose. There is no rate,
 * no conversion and no shared counter between them — food restores stamina,
 * coins only buy things (eggs). DRAKOFRUTA IS NOT A RESOURCE: it exists only as
 * a board tile, and what it buys — a transformation for one battle — is battle
 * state, never a balance.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    food: integer('food').notNull().default(0),
    coins: integer('coins').notNull().default(0),

    /**
     * El último día en que se revisó el nido. UNA tirada al día: si rodara al
     * cargar la página, bastaría con recargar hasta que saliera huevo.
     */
    lastNestCheck: date('last_nest_check'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('players_user_id_key').on(t.userId),
    check('players_food_non_negative', sql`${t.food} >= 0`),
    check('players_coins_non_negative', sql`${t.coins} >= 0`),
  ],
);

export type PlayerRow = typeof players.$inferSelect;
export type NewPlayerRow = typeof players.$inferInsert;
