import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { BASE_ELEMENTS, CANONICAL_EVOLUTIONS, type BaseElement } from '@/core/elements';
import type { CreateSpeciesInput, SpeciesFilter, UpdateSpeciesInput } from '@/core/schemas/species';
import { getDb } from '../client';
import {
  type EvolutionPathRow,
  type SpeciesFormRow,
  type SpeciesRow,
  creatures,
  evolutionPaths,
  species,
  speciesForms,
} from '../schema';

/**
 * Species reads and writes for the admin panel.
 *
 * Nothing here decides who may call it: authorisation happens in the server
 * action, before any of this runs.
 */

export type SpeciesWithPaths = SpeciesRow & {
  paths: EvolutionPathRow[];
  /** The four awakened faces. Empty for an ordinary species. */
  forms: SpeciesFormRow[];
  creatureCount: number;
};

export async function listSpecies(filter: SpeciesFilter): Promise<SpeciesWithPaths[]> {
  const db = await getDb();

  const conditions = [];
  if (filter.baseElement) conditions.push(eq(species.baseElement, filter.baseElement));
  if (filter.isPublished !== undefined) {
    conditions.push(eq(species.isPublished, filter.isPublished));
  }
  if (filter.search) {
    const pattern = `%${filter.search}%`;
    conditions.push(or(ilike(species.name, pattern), ilike(species.slug, pattern)));
  }

  const rows = await db
    .select()
    .from(species)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(species.baseElement), asc(species.name))
    .limit(filter.limit)
    .offset(filter.offset);

  return attachPaths(rows);
}

export async function getSpecies(id: string): Promise<SpeciesWithPaths | null> {
  const db = await getDb();
  const [row] = await db.select().from(species).where(eq(species.id, id)).limit(1);
  if (!row) return null;
  const [withPaths] = await attachPaths([row]);
  return withPaths ?? null;
}

/** One extra round trip instead of N: the list view would otherwise fan out. */
async function attachPaths(rows: SpeciesRow[]): Promise<SpeciesWithPaths[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const ids = rows.map((row) => row.id);

  const paths = await db
    .select()
    .from(evolutionPaths)
    .where(inArray(evolutionPaths.speciesId, ids))
    .orderBy(asc(evolutionPaths.sortOrder), asc(evolutionPaths.targetElement));

  const forms = await db
    .select()
    .from(speciesForms)
    .where(inArray(speciesForms.speciesId, ids))
    .orderBy(asc(speciesForms.element));

  const counts = await db
    .select({ speciesId: creatures.speciesId, count: sql<number>`count(*)::int` })
    .from(creatures)
    .where(inArray(creatures.speciesId, ids))
    .groupBy(creatures.speciesId);

  const countBySpecies = new Map(counts.map((row) => [row.speciesId, row.count]));

  return rows.map((row) => ({
    ...row,
    paths: paths.filter((path) => path.speciesId === row.id),
    forms: forms.filter((form) => form.speciesId === row.id),
    creatureCount: countBySpecies.get(row.id) ?? 0,
  }));
}

/**
 * Creates a species AND its canonical default evolution path in one transaction.
 *
 * Two tables, so it is atomic by rule — and by necessity: a species with no path
 * could never evolve, and there would be no moment at which that was visible in
 * the panel. The default target element is DERIVED from the base element; the
 * caller cannot supply it.
 */
export async function createSpecies(
  input: CreateSpeciesInput,
  createdBy: string,
): Promise<SpeciesRow> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(species)
      .values({
        name: input.name,
        slug: input.slug,
        baseElement: input.baseElement,
        baseImagePath: input.baseImagePath,
        baseHp: input.baseHp,
        baseAttack: input.baseAttack,
        baseDefense: input.baseDefense,
        manaCost: input.manaCost,
        description: input.description,
        isPublished: input.isPublished,
        effects: input.effects,
        createdBy,
      })
      .returning();
    if (!row) throw new Error('No se pudo crear la especie');

    if (input.baseElement === null) {
      /**
       * A WHITE SPECIES IS BORN WITH FOUR FUTURES, so it gets four of
       * everything: a face per element (the look a stone gives it) and a path
       * per element (what that face later transforms into).
       *
       * Creating them empty rather than on demand is what makes the admin
       * legible: the four slots are visible from the first save, so an artist
       * can see at a glance which ones still have no drawing.
       */
      await tx.insert(speciesForms).values(
        BASE_ELEMENTS.map((element) => ({ speciesId: row.id, element })),
      );
      await tx.insert(evolutionPaths).values(
        BASE_ELEMENTS.map((element, index) => ({
          speciesId: row.id,
          targetElement: element,
          name: `Vía ${element}`,
          isDefault: index === 0,
          sortOrder: index,
        })),
      );
      return row;
    }

    /**
     * BOTH GRADES, like the seed writes them.
     *
     * A species owns two paths and the grade is read from where they point:
     * NORMAL at its own element, SUPERIOR at the canonical pair. This used to
     * create one path aimed at the canonical element and mark it default —
     * which left the species with no ordinary evolution at all and handed the
     * excellent-only form to every creature, the exact opposite of the rule.
     */
    const base = input.baseElement satisfies BaseElement;
    const canonical = CANONICAL_EVOLUTIONS[base];

    await tx.insert(evolutionPaths).values([
      {
        speciesId: row.id,
        targetElement: base,
        name: `${input.name} mayor`,
        hpBonus: 10,
        attackBonus: 5,
        defenseBonus: 3,
        /** What an ORDINARY creature becomes, so it is the default. */
        isDefault: true,
        sortOrder: 0,
      },
      {
        speciesId: row.id,
        targetElement: canonical,
        name: `${input.name} ${canonical}`,
        hpBonus: 13,
        attackBonus: 8,
        defenseBonus: 6,
        isDefault: false,
        sortOrder: 1,
      },
    ]);

    return row;
  });
}

/**
 * Updates only the fields present in the input.
 *
 * `baseElement` is deliberately NOT updatable: existing evolution paths and
 * every creature's attack trigger hang off it, so changing it would silently
 * rewrite the meaning of rows that already exist.
 */
export async function updateSpecies(input: UpdateSpeciesInput): Promise<SpeciesRow> {
  const db = await getDb();

  const patch: Partial<typeof species.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.baseImagePath !== undefined) patch.baseImagePath = input.baseImagePath;
  if (input.baseHp !== undefined) patch.baseHp = input.baseHp;
  if (input.baseAttack !== undefined) patch.baseAttack = input.baseAttack;
  if (input.baseDefense !== undefined) patch.baseDefense = input.baseDefense;
  if (input.manaCost !== undefined) patch.manaCost = input.manaCost;
  if (input.description !== undefined) patch.description = input.description;
  if (input.isPublished !== undefined) patch.isPublished = input.isPublished;
  if (input.effects !== undefined) patch.effects = input.effects;

  const [row] = await db
    .update(species)
    .set(patch)
    .where(eq(species.id, input.id))
    .returning();
  if (!row) throw new Error('La especie ya no existe');
  return row;
}

export async function deleteSpecies(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(species).where(eq(species.id, id));
}

export async function slugExists(slug: string, exceptId?: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: species.id })
    .from(species)
    .where(eq(species.slug, slug))
    .limit(1);
  if (!row) return false;
  return row.id !== exceptId;
}

/**
 * Writes one awakened face — the name and the drawing a stone reveals.
 *
 * An upsert on (species, element) rather than an insert: the four rows are
 * created with the species, so editing a face is always an update of a row that
 * already exists, and the unique index is what guarantees there is exactly one
 * per element instead of a growing pile of drafts.
 */
export async function setSpeciesForm(
  speciesId: string,
  element: BaseElement,
  patch: { name: string | null; imagePath?: string | null },
): Promise<void> {
  const db = await getDb();
  const values = {
    speciesId,
    element,
    name: patch.name,
    ...(patch.imagePath !== undefined ? { imagePath: patch.imagePath } : {}),
  };

  await db
    .insert(speciesForms)
    .values(values)
    .onConflictDoUpdate({
      target: [speciesForms.speciesId, speciesForms.element],
      /** An absent image means "keep the current drawing", not "clear it". */
      set: {
        name: patch.name,
        ...(patch.imagePath !== undefined ? { imagePath: patch.imagePath } : {}),
        updatedAt: new Date(),
      },
    });
}
