import { z } from 'zod';
import { BOARD_TILE_KINDS } from '../match3/tiles';
import { elementSchema } from '../elements';

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
 * A rival creature. It has NO health: damage goes to the rival player, so a
 * creature is a weapon, never a target. Leaving an `hp` field here would be an
 * open invitation to start writing to it again.
 */
export const storedRivalSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  element: elementSchema,
  attack: z.number().int().min(0).max(100_000),
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

export type StartBattleInput = z.infer<typeof startBattleSchema>;
export type PlayMoveInput = z.infer<typeof playMoveSchema>;
