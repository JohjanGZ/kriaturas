import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { StoredBoard, StoredRival } from '@/core/schemas/battle';
import { timestamps, tstz } from './_shared';
import { creatures } from './creatures';
import { battleStatusEnum } from './enums';
import { games } from './games';
import { players } from './players';

/**
 * A battle in progress. THE SERVER OWNS IT.
 *
 * The board, the rival lineup, BOTH players' health and every mana bar live
 * here, not in the browser. A client that wanted to cheat would have to
 * convince this row, and the only thing it is ever allowed to send is a pair of
 * coordinates.
 *
 * Creatures have no health: damage lands on a PLAYER. Board and rivals are
 * JSONB validated by core/schemas/battle.ts on every write and every read.
 */
export const battles = pgTable(
  'battles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    status: battleStatusEnum('status').notNull().default('active'),

    board: jsonb('board').$type<StoredBoard>().notNull(),
    /** The rival lineup. Creatures have no health — see core/battle. */
    rivals: jsonb('rivals').$type<StoredRival[]>().notNull(),

    /** One life each, the same fixed size, copied from config at the start. */
    playerMaxHp: integer('player_max_hp').notNull(),
    playerHp: integer('player_hp').notNull(),
    opponentMaxHp: integer('opponent_max_hp').notNull(),
    opponentHp: integer('opponent_hp').notNull(),
    shield: integer('shield').notNull().default(0),
    shieldTurns: integer('shield_turns').notNull().default(0),

    turn: integer('turn').notNull().default(0),

    startedAt: tstz('started_at').notNull().defaultNow(),
    endedAt: tstz('ended_at'),
    ...timestamps,
  },
  (t) => [
    index('battles_player_idx').on(t.playerId),
    /**
     * One active battle per player. Without this a client could open several
     * and farm the stamina cost of a single one.
     */
    uniqueIndex('battles_one_active_per_player')
      .on(t.playerId)
      .where(sql`${t.status} = 'active'`),
    check('battles_hp_in_range', sql`${t.playerHp} >= 0 and ${t.playerHp} <= ${t.playerMaxHp}`),
    check(
      'battles_opponent_hp_in_range',
      sql`${t.opponentHp} >= 0 and ${t.opponentHp} <= ${t.opponentMaxHp}`,
    ),
    check('battles_shield_non_negative', sql`${t.shield} >= 0`),
    check('battles_turn_non_negative', sql`${t.turn} >= 0`),
    check(
      'battles_finished_has_ended_at',
      sql`(${t.status} = 'active' and ${t.endedAt} is null) or (${t.status} <> 'active' and ${t.endedAt} is not null)`,
    ),
    check('battles_board_is_object', sql`jsonb_typeof(${t.board}) = 'object'`),
    check('battles_rivals_is_array', sql`jsonb_typeof(${t.rivals}) = 'array'`),
  ],
);

/**
 * The team fighting this battle, one row per creature.
 *
 * A real foreign key rather than an id inside JSON: the mana bar belongs to a
 * creature that must exist, and deleting a creature mid-battle must be refused
 * rather than silently leaving a dangling id.
 */
export const battleCreatures = pgTable(
  'battle_creatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    battleId: uuid('battle_id')
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    creatureId: uuid('creature_id')
      .notNull()
      .references(() => creatures.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    slot: integer('slot').notNull(),
    mana: integer('mana').notNull().default(0),
    /** Copied at battle start, so retuning a species mid-battle changes nothing. */
    manaCost: integer('mana_cost').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('battle_creatures_battle_creature_key').on(t.battleId, t.creatureId),
    uniqueIndex('battle_creatures_battle_slot_key').on(t.battleId, t.slot),
    check('battle_creatures_mana_non_negative', sql`${t.mana} >= 0`),
    check('battle_creatures_mana_cost_positive', sql`${t.manaCost} > 0`),
    check('battle_creatures_slot_non_negative', sql`${t.slot} >= 0`),
  ],
);

export type BattleRow = typeof battles.$inferSelect;
export type NewBattleRow = typeof battles.$inferInsert;
export type BattleCreatureRow = typeof battleCreatures.$inferSelect;
