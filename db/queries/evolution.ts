import { and, asc, eq, ne } from 'drizzle-orm';
import type { EvolvedElement } from '@/core/elements';
import type {
  CreateEvolutionPathInput,
  UpdateEvolutionPathInput,
} from '@/core/schemas/evolution';
import { getDb } from '../client';
import { type EvolutionPathRow, creatures, evolutionPaths } from '../schema';

export async function listPaths(speciesId: string): Promise<EvolutionPathRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(evolutionPaths)
    .where(eq(evolutionPaths.speciesId, speciesId))
    .orderBy(asc(evolutionPaths.sortOrder), asc(evolutionPaths.targetElement));
}

export async function createPath(input: CreateEvolutionPathInput): Promise<EvolutionPathRow> {
  const db = await getDb();
  const [row] = await db
    .insert(evolutionPaths)
    .values({
      speciesId: input.speciesId,
      targetElement: input.targetElement satisfies EvolvedElement,
      name: input.name,
      description: input.description,
      imagePath: input.imagePath,
      hpBonus: input.hpBonus,
      attackBonus: input.attackBonus,
      defenseBonus: input.defenseBonus,
      effects: input.effects,
      sortOrder: input.sortOrder,
    })
    .returning();
  if (!row) throw new Error('No se pudo crear la vía de evolución');
  return row;
}

export async function updatePath(input: UpdateEvolutionPathInput): Promise<EvolutionPathRow> {
  const db = await getDb();

  const patch: Partial<typeof evolutionPaths.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.imagePath !== undefined) patch.imagePath = input.imagePath;
  if (input.hpBonus !== undefined) patch.hpBonus = input.hpBonus;
  if (input.attackBonus !== undefined) patch.attackBonus = input.attackBonus;
  if (input.defenseBonus !== undefined) patch.defenseBonus = input.defenseBonus;
  if (input.effects !== undefined) patch.effects = input.effects;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  const [row] = await db
    .update(evolutionPaths)
    .set(patch)
    .where(eq(evolutionPaths.id, input.id))
    .returning();
  if (!row) throw new Error('La vía de evolución ya no existe');
  return row;
}

/**
 * Marks one path as the species default.
 *
 * A partial unique index allows only one default per species, so clearing the
 * others and setting this one MUST happen together — do it in two statements
 * outside a transaction and the index rejects the write halfway through.
 */
export async function setDefaultPath(pathId: string, speciesId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(evolutionPaths)
      .set({ isDefault: false })
      .where(and(eq(evolutionPaths.speciesId, speciesId), ne(evolutionPaths.id, pathId)));
    await tx
      .update(evolutionPaths)
      .set({ isDefault: true })
      .where(eq(evolutionPaths.id, pathId));
  });
}

export async function deletePath(pathId: string): Promise<void> {
  const db = await getDb();
  await db.delete(evolutionPaths).where(eq(evolutionPaths.id, pathId));
}

/** How many creatures already locked this path — deleting it is then refused. */
export async function creaturesOnPath(pathId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ id: creatures.id })
    .from(creatures)
    .where(eq(creatures.evolutionPathId, pathId));
  return rows.length;
}
