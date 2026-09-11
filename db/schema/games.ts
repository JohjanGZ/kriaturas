import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ConfigKey, ConfigValue } from '@/core/schemas/config';
import { timestamps } from './_shared';
import { configKeyEnum } from './enums';

/**
 * A game is a playable mode. Kriaturas is the first one; the second game will
 * reuse /core and gets its own row plus its own config rows.
 */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('games_slug_key').on(t.slug)],
);

/**
 * Tuning values live here, NOT in constants: the evolution fruit threshold, the
 * minimum stamina required to play, the regeneration rate, the evolved damage
 * multiplier. `value` is validated with the Zod schema registered for `key`
 * (see core/schemas/config.ts) on every write and on every read.
 */
export const gameConfigs = pgTable(
  'game_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    key: configKeyEnum('key').notNull(),
    value: jsonb('value').$type<ConfigValue<ConfigKey>>().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('game_configs_game_id_key_key').on(t.gameId, t.key)],
);

export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type GameConfigRow = typeof gameConfigs.$inferSelect;
export type NewGameConfigRow = typeof gameConfigs.$inferInsert;
