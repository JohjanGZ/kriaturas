import { z } from 'zod';
import { resourceKindSchema } from './player';

/**
 * EGGS
 *
 * A player buys an egg and gets a RANDOM species from that egg type's pool.
 * The species is rolled SERVER-SIDE at purchase and stored immediately, so the
 * outcome cannot be re-rolled, previewed, or influenced by the client. It is
 * simply not revealed until the egg hatches.
 *
 * The egg must be cared for daily. "Daily" is a server-side UTC calendar day:
 * one row per (egg, care_date) in egg_care_log, unique — so a client cannot
 * spam care, replay a day, or claim a day it missed. Nothing here accepts a
 * date from the client.
 */

export const EGG_STATUSES = ['incubating', 'hatched', 'spoiled'] as const;
export type EggStatus = (typeof EGG_STATUSES)[number];
export const eggStatusSchema = z.enum(EGG_STATUSES);

/** Admin: an egg type is a price plus a weighted pool of species. */
export const createEggTypeSchema = z.strictObject({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by single hyphens'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).nullable().default(null),
  imagePath: z.string().trim().min(1).max(512).nullable().default(null),
  priceAmount: z.number().int().min(1).max(1_000_000),
  priceResource: resourceKindSchema,
  /** Days of successful care required before it can hatch. */
  careDaysRequired: z.number().int().min(1).max(365),
  /** How many missed days the egg tolerates before it spoils. */
  maxMissedDays: z.number().int().min(0).max(365),
  isPublished: z.boolean().default(false),
});

export const updateEggTypeSchema = createEggTypeSchema.partial().extend({ id: z.uuid() });

/** Weighted species pool. Weight is relative; the roll happens server-side. */
export const setEggTypePoolSchema = z.strictObject({
  eggTypeId: z.uuid(),
  entries: z
    .array(
      z.strictObject({
        speciesId: z.uuid(),
        weight: z.number().int().min(1).max(10_000).default(1),
      }),
    )
    .min(1)
    .max(100),
});

/** Player actions. No timestamps, no species, no outcome — the server decides all three. */
export const buyEggSchema = z.strictObject({
  eggTypeId: z.uuid(),
});

export const careForEggSchema = z.strictObject({
  eggId: z.uuid(),
});

export const hatchEggSchema = z.strictObject({
  eggId: z.uuid(),
});

export type CreateEggTypeInput = z.infer<typeof createEggTypeSchema>;
export type UpdateEggTypeInput = z.infer<typeof updateEggTypeSchema>;
export type SetEggTypePoolInput = z.infer<typeof setEggTypePoolSchema>;
export type BuyEggInput = z.infer<typeof buyEggSchema>;
export type CareForEggInput = z.infer<typeof careForEggSchema>;
export type HatchEggInput = z.infer<typeof hatchEggSchema>;
