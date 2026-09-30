import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { StoredBoard, StoredField, StoredRival } from '@/core/schemas/battle';
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
    /**
     * THE FIELD, or null for the ordinary mode.
     *
     * Copied in at the start like the mana costs, so retuning a field cannot
     * move the rules under a fight in progress. It carries its own live state —
     * the mines and their fuses — because a turn spans several requests.
     */
    field: jsonb('field').$type<StoredField>(),

    /** One life each, the same fixed size, copied from config at the start. */
    playerMaxHp: integer('player_max_hp').notNull(),
    playerHp: integer('player_hp').notNull(),
    opponentMaxHp: integer('opponent_max_hp').notNull(),
    opponentHp: integer('opponent_hp').notNull(),
    shield: integer('shield').notNull().default(0),
    shieldTurns: integer('shield_turns').notNull().default(0),
    /**
     * The RIVAL's shield. Without it the bot's `shield` effects did nothing and
     * piercing damage had nothing to pierce in that direction — the machine was
     * quietly playing a different game.
     */
    opponentShield: integer('opponent_shield').notNull().default(0),
    opponentShieldTurns: integer('opponent_shield_turns').notNull().default(0),

    turn: integer('turn').notNull().default(0),
    /**
     * A turn is several moves. These two live here rather than in memory
     * because a turn now spans several requests: the player spends one move,
     * the page reloads, and the server must still know how many are left and
     * whether the bonus move for a big alignment was already handed out.
     */
    /**
     * Drakofruta aligned on the board, one bar per side. Filling it transforms
     * a creature FOR THIS BATTLE — it is not the permanent evolution and it
     * never touches `players.drakofruta`.
     */
    fruits: integer('fruits').notNull().default(0),
    rivalFruits: integer('rival_fruits').notNull().default(0),

    /**
     * POWERS THAT LAST. Poison bleeds a side per move it makes; a move penalty
     * shortens its NEXT turn. Both are per side, and both live here because a
     * turn spans several requests.
     */
    playerPoisonPerMove: integer('player_poison_per_move').notNull().default(0),
    playerPoisonTurns: integer('player_poison_turns').notNull().default(0),
    rivalPoisonPerMove: integer('rival_poison_per_move').notNull().default(0),
    rivalPoisonTurns: integer('rival_poison_turns').notNull().default(0),
    playerMovePenalty: integer('player_move_penalty').notNull().default(0),
    rivalMovePenalty: integer('rival_move_penalty').notNull().default(0),
    /** While this lasts, that side banks no drakofruta: no transformation. */
    playerFruitBlockTurns: integer('player_fruit_block_turns').notNull().default(0),
    rivalFruitBlockTurns: integer('rival_fruit_block_turns').notNull().default(0),

    movesLeft: integer('moves_left').notNull().default(2),
    extraMoveUsed: boolean('extra_move_used').notNull().default(false),

    startedAt: tstz('started_at').notNull().defaultNow(),
    endedAt: tstz('ended_at'),
    /**
     * When the player acknowledged the result.
     *
     * A finished battle is no longer "active", so without this the win screen
     * would be replaced by the team picker the instant the last gem cleared —
     * the player would never see whether they won. The row stays shown until it
     * is dismissed, so closing the browser mid-celebration does not lose it.
     */
    dismissedAt: tstz('dismissed_at'),
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
    check('battles_moves_left_non_negative', sql`${t.movesLeft} >= 0`),
    check('battles_fruits_non_negative', sql`${t.fruits} >= 0 and ${t.rivalFruits} >= 0`),
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
    /**
     * Transformed by the board's fruit, for this battle only. The creature row
     * is untouched: nothing here survives the last move.
     */
    evolvedInBattle: boolean('evolved_in_battle').notNull().default(false),
    /**
     * Statuses a rival power left on this creature. BLOCKED cancels the blow it
     * was about to land; PARALYZED stops its bar filling at all.
     */
    blockedTurns: integer('blocked_turns').notNull().default(0),
    paralyzedTurns: integer('paralyzed_turns').notNull().default(0),
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
