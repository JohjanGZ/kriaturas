import { z } from 'zod';

/**
 * Mutation inputs for creature-level actions.
 *
 * Every schema here is STRICT on purpose: a client that tries to smuggle a
 * timestamp, a stamina value or an isEvolved flag is rejected rather than
 * silently ignored. The server is the only clock and the only judge.
 */

export const createCreatureSchema = z.strictObject({
  playerId: z.uuid(),
  speciesId: z.uuid(),
  nickname: z.string().trim().min(1).max(40).nullable().default(null),
});

/** Feeding restores stamina by moving the regeneration anchor backwards. */
export const feedCreatureSchema = z.strictObject({
  creatureId: z.uuid(),
  foodUnits: z.number().int().min(1).max(99).default(1),
});

/** Playing consumes stamina by moving the regeneration anchor forwards. */
export const playCreatureSchema = z.strictObject({
  creatureId: z.uuid(),
  gameId: z.uuid(),
});

/**
 * Evolution. In ONE transaction the server: re-checks that the path belongs to
 * this creature's species, that every required objective is completed, that the
 * player holds enough drakofruta, then spends the fruits, increments
 * players.evolutions_performed, and flips is_evolved on this same row.
 *
 * `evolutionPathId` is only accepted when the creature has not locked a path
 * yet. Once locked, the choice is permanent and this field must be omitted --
 * passing a different path is rejected, never silently applied.
 */
export const evolveCreatureSchema = z.strictObject({
  creatureId: z.uuid(),
  evolutionPathId: z.uuid().optional(),
});

export const renameCreatureSchema = z.strictObject({
  creatureId: z.uuid(),
  nickname: z.string().trim().min(1).max(40),
});

export type CreateCreatureInput = z.infer<typeof createCreatureSchema>;
export type FeedCreatureInput = z.infer<typeof feedCreatureSchema>;
export type PlayCreatureInput = z.infer<typeof playCreatureSchema>;
export type EvolveCreatureInput = z.infer<typeof evolveCreatureSchema>;
export type RenameCreatureInput = z.infer<typeof renameCreatureSchema>;
