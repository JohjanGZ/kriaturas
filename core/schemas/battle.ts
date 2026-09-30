import { z } from 'zod';
import { baseElementSchema, elementSchema } from '../elements';
import { BATTLE_MODES, FIELD_KINDS } from '../fields';
import { BOARD_TILE_KINDS } from '../match3/tiles';

/**
 * Shapes for the battle state that is PERSISTED.
 *
 * The board and the enemy wave live in the database as JSONB, so they are
 * validated on every write and on every read — a column is only as trustworthy
 * as the last thing that wrote to it.
 *
 * None of these are input schemas. The client never sends a board, a enemy or a
 * mana value; it sends two positions and the server does the rest.
 */

export const boardTileKindSchema = z.enum(BOARD_TILE_KINDS);

export const storedBoardSchema = z
  .strictObject({
    width: z.number().int().min(4).max(12),
    height: z.number().int().min(4).max(12),
    tiles: z.array(boardTileKindSchema).min(16).max(144),
  })
  .refine((board) => board.tiles.length === board.width * board.height, {
    message: 'The tile count must be exactly width x height',
  });

/**
 * THE FIELD this battle is being fought on, copied in when it starts.
 *
 * It is a snapshot for the same reason the mana costs are: retuning a field
 * must never move the rules under a fight already in progress. A battle in the
 * ordinary mode simply has none, and every reader treats null as "the normal
 * rules" rather than as a missing value.
 */
export const battleFieldSchema = z.strictObject({
  kind: z.enum(FIELD_KINDS),
  /** Only the volcano carries one. */
  element: baseElementSchema.nullable().default(null),
  /**
   * Live mines. A mine is a CELL — tiles fall through it — so `at` is a board
   * index and nothing about it travels with gravity.
   */
  bombs: z
    .array(
      z.strictObject({
        at: z.number().int().min(0).max(143),
        fuse: z.number().int().min(0).max(20),
      }),
    )
    .max(6)
    .default([]),
});

export type StoredField = z.infer<typeof battleFieldSchema>;

/**
 * A rival creature. It has NO health: damage goes to the rival player, so a
 * creature is a weapon, never a target. Leaving an `hp` field here would be an
 * open invitation to start writing to it again.
 */
export const storedRivalSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  element: elementSchema,
  attack: z.number().int().min(0).max(100_000),
  /**
   * The rival plays the board too, so it has a bar like yours and hits only
   * when that bar fills. Defaulted, so battles written before the bot existed
   * still parse instead of throwing on read.
   */
  manaCost: z.number().int().min(1).max(100).default(12),
  mana: z.number().int().min(0).max(1000).default(0),
  /** Transformed by the board's fruit, for this battle only. */
  evolvedInBattle: z.boolean().default(false),
  /** Statuses your powers left on it. Defaulted, so older rows still parse. */
  blockedTurns: z.number().int().min(0).max(20).default(0),
  paralyzedTurns: z.number().int().min(0).max(20).default(0),
});

export const storedRivalListSchema = z.array(storedRivalSchema).min(1).max(6);

export type StoredBoard = z.infer<typeof storedBoardSchema>;
export type StoredRival = z.infer<typeof storedRivalSchema>;

export const BATTLE_STATUSES = ['active', 'won', 'lost', 'abandoned'] as const;
export type BattleStatusValue = (typeof BATTLE_STATUSES)[number];
export const battleStatusSchema = z.enum(BATTLE_STATUSES);

/**
 * Player actions. Strict, so a smuggled board, mana value or damage number is a
 * validation error rather than a field that gets quietly ignored.
 */
export const startBattleSchema = z.strictObject({
  creatureIds: z.array(z.uuid()).min(1).max(6),
  /**
   * Which MODE, never which field. Defaulted, so a form written before the
   * mode existed still starts an ordinary battle instead of failing.
   */
  mode: z.enum(BATTLE_MODES).default('normal'),
});

const coordinate = z.number().int().min(0).max(11);

export const playMoveSchema = z.strictObject({
  battleId: z.uuid(),
  fromRow: coordinate,
  fromCol: coordinate,
  toRow: coordinate,
  toCol: coordinate,
});

export const abandonBattleSchema = z.strictObject({
  battleId: z.uuid(),
});

/**
 * Spending the battle's fruit bar. Two ids and nothing else: the threshold and
 * the effect are the server's business.
 */
export const evolveInBattleSchema = z.strictObject({
  battleId: z.uuid(),
  creatureId: z.uuid(),
});

/** Acknowledging the result screen. Carries nothing else: the result is a row. */
export const dismissBattleSchema = z.strictObject({
  battleId: z.uuid(),
});

export type StartBattleInput = z.infer<typeof startBattleSchema>;
export type PlayMoveInput = z.infer<typeof playMoveSchema>;
