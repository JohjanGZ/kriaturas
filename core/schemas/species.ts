import { z } from 'zod';
import { baseElementSchema } from '../elements';
import { effectListSchema } from '../effects/schema';

/**
 * Species are admin-created templates. Players own instances (creatures) of them.
 *
 * A species no longer has a single evolved form: it owns one or more evolution
 * PATHS (see core/schemas/evolution.ts), each with its own target element, image
 * and stat bonuses. So there is no `evolvedElement` and no `evolvedImagePath`
 * here — that data belongs to the path, which is where the admin edits it.
 *
 * `baseElement` stays fixed for the life of the species: it is the board gem
 * that triggers the creature, evolved or not.
 */

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by single hyphens');

const imagePathSchema = z.string().trim().min(1).max(512);

export const speciesStatsSchema = z.strictObject({
  baseHp: z.number().int().min(1).max(9999),
  baseAttack: z.number().int().min(0).max(9999),
  baseDefense: z.number().int().min(0).max(9999),
});

export const createSpeciesSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  baseElement: baseElementSchema,
  baseImagePath: imagePathSchema.nullable().default(null),
  baseHp: z.number().int().min(1).max(9999),
  baseAttack: z.number().int().min(0).max(9999),
  baseDefense: z.number().int().min(0).max(9999),
  manaCost: z.number().int().min(1).max(100).default(12),
  description: z.string().trim().max(2000).nullable().default(null),
  isPublished: z.boolean().default(false),
  effects: effectListSchema.default([]),
});

export const updateSpeciesSchema = createSpeciesSchema.partial().extend({
  id: z.uuid(),
});

export const speciesIdSchema = z.strictObject({ id: z.uuid() });

export const speciesFilterSchema = z.strictObject({
  baseElement: baseElementSchema.optional(),
  isPublished: z.boolean().optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type SpeciesStats = z.infer<typeof speciesStatsSchema>;
export type CreateSpeciesInput = z.infer<typeof createSpeciesSchema>;
export type UpdateSpeciesInput = z.infer<typeof updateSpeciesSchema>;
export type SpeciesFilter = z.infer<typeof speciesFilterSchema>;
