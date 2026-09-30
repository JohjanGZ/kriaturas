import { z } from 'zod';

/**
 * Season inputs. Strict, like every other mutation: the admin sends deltas and
 * ids, and the server decides what they mean.
 */

export const createSeasonSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
});

export const activateSeasonSchema = z.strictObject({
  seasonId: z.uuid(),
});

/**
 * A balance change. Deltas are bounded: a season is for TUNING, and a four-digit
 * swing is a typo, not a decision.
 */
export const setAdjustmentSchema = z.strictObject({
  seasonId: z.uuid(),
  speciesId: z.uuid(),
  attackDelta: z.number().int().min(-99).max(99),
  manaCostDelta: z.number().int().min(-99).max(99),
  note: z.string().trim().max(200).nullable(),
});

export type CreateSeasonInput = z.infer<typeof createSeasonSchema>;
export type SetAdjustmentInput = z.infer<typeof setAdjustmentSchema>;
