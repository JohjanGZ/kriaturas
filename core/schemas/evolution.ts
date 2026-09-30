import { z } from 'zod';
import { elementSchema } from '../elements';
import { effectListSchema } from '../effects/schema';

/**
 * EVOLUTION PATHS
 *
 * A species offers one or more paths (plant -> poison, plant -> rock). The
 * player picks ONE for a given creature. The pick is permanent: it is written
 * once and never changed, and evolution itself still happens exactly once, on
 * the same creature row, irreversibly.
 *
 * "Never chosen freely" still holds — the choice is constrained to the paths the
 * admin defined for that species, and the server re-checks that the path really
 * belongs to the creature's species before writing anything.
 *
 * THE TARGET DECIDES THE GRADE, and both grades are legitimate:
 *
 * - pointing at the species' OWN base element is the NORMAL evolution, the one
 *   any creature takes (fire -> fire: same colours, better numbers);
 * - pointing at an EVOLVED element is the SUPERIOR form, which only a creature
 *   carrying the rare mark may take.
 *
 * So a base element is accepted here. It used to be refused, which meant the
 * admin panel could not create a normal path at all — only the seed could, by
 * writing the row directly.
 *
 * None of this touches the attack trigger: a creature always fires on its
 * species' base element, transformed or not.
 */

export const createEvolutionPathSchema = z.strictObject({
  speciesId: z.uuid(),
  targetElement: elementSchema,
  name: z.string().trim().min(2).max(80),
  imagePath: z.string().trim().min(1).max(512).nullable().default(null),
  description: z.string().trim().max(2000).nullable().default(null),

  /** Stat deltas applied on top of the species base stats when evolved. */
  hpBonus: z.number().int().min(0).max(9999).default(0),
  attackBonus: z.number().int().min(0).max(9999).default(0),
  defenseBonus: z.number().int().min(0).max(9999).default(0),

  /** Effects this path unlocks, on top of the species effects. */
  effects: effectListSchema.default([]),

  /** At most one default per species (enforced by a partial unique index). */
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const updateEvolutionPathSchema = createEvolutionPathSchema
  .partial()
  .extend({ id: z.uuid() });

export const evolutionPathIdSchema = z.strictObject({ id: z.uuid() });

/** Which objectives must be completed before this path unlocks. */
export const setEvolutionRequirementsSchema = z.strictObject({
  evolutionPathId: z.uuid(),
  objectiveIds: z.array(z.uuid()).max(10),
});

/**
 * The player locks in which evolution this creature will take. Permanent.
 * Requirements do NOT have to be met yet — locking the choice and performing
 * the evolution are separate steps.
 */
export const chooseEvolutionPathSchema = z.strictObject({
  creatureId: z.uuid(),
  evolutionPathId: z.uuid(),
});

export type CreateEvolutionPathInput = z.infer<typeof createEvolutionPathSchema>;
export type UpdateEvolutionPathInput = z.infer<typeof updateEvolutionPathSchema>;
export type ChooseEvolutionPathInput = z.infer<typeof chooseEvolutionPathSchema>;
export type SetEvolutionRequirementsInput = z.infer<typeof setEvolutionRequirementsSchema>;
