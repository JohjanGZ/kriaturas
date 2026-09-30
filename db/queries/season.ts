import { and, asc, desc, eq } from 'drizzle-orm';
import { type Adjustment, NO_ADJUSTMENT } from '@/core/balance';
import { getDb } from '../client';
import { type SeasonRow, seasonAdjustments, seasons, species } from '../schema';

/**
 * Seasons and their balance adjustments.
 *
 * The active season is a ROW, not a date comparison: "which season is running"
 * must be a decision someone made, not something that changes at midnight while
 * a battle is resolving.
 */

export type SeasonBalance = {
  season: SeasonRow | null;
  /** Adjustment per species id. A species with no row is simply unadjusted. */
  bySpecies: Map<string, Adjustment>;
};

export async function getActiveSeason(): Promise<SeasonRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  return row ?? null;
}

/** What the running season does to every species. Empty when none is running. */
export async function loadSeasonBalance(): Promise<SeasonBalance> {
  const db = await getDb();
  const season = await getActiveSeason();
  if (!season) return { season: null, bySpecies: new Map() };

  const rows = await db
    .select()
    .from(seasonAdjustments)
    .where(eq(seasonAdjustments.seasonId, season.id));

  return {
    season,
    bySpecies: new Map(
      rows.map((row) => [
        row.speciesId,
        { attackDelta: row.attackDelta, manaCostDelta: row.manaCostDelta } satisfies Adjustment,
      ]),
    ),
  };
}

export const adjustmentFor = (balance: SeasonBalance, speciesId: string): Adjustment =>
  balance.bySpecies.get(speciesId) ?? NO_ADJUSTMENT;

export type SeasonListItem = SeasonRow & { adjustments: number };

export async function listSeasons(): Promise<SeasonListItem[]> {
  const db = await getDb();
  const rows = await db.select().from(seasons).orderBy(desc(seasons.startsAt));
  const counts = await db.select().from(seasonAdjustments);

  return rows.map((row) => ({
    ...row,
    adjustments: counts.filter((entry) => entry.seasonId === row.id).length,
  }));
}

export type SeasonSpeciesRow = {
  speciesId: string;
  name: string;
  /** Null for a species with no element of its own. */
  element: string | null;
  baseAttack: number;
  baseManaCost: number;
  attackDelta: number;
  manaCostDelta: number;
  note: string | null;
};

/** Every species with what THIS season does to it — the admin's editing table. */
export async function getSeasonSheet(seasonId: string): Promise<SeasonSpeciesRow[]> {
  const db = await getDb();
  const rows = await db.select().from(species).orderBy(asc(species.name));
  const adjustments = await db
    .select()
    .from(seasonAdjustments)
    .where(eq(seasonAdjustments.seasonId, seasonId));

  return rows.map((row) => {
    const adjustment = adjustments.find((entry) => entry.speciesId === row.id);
    return {
      speciesId: row.id,
      name: row.name,
      element: row.baseElement,
      baseAttack: row.baseAttack,
      baseManaCost: row.manaCost,
      attackDelta: adjustment?.attackDelta ?? 0,
      manaCostDelta: adjustment?.manaCostDelta ?? 0,
      note: adjustment?.note ?? null,
    };
  });
}

export async function createSeason(name: string, now: Date): Promise<SeasonRow> {
  const db = await getDb();
  const [row] = await db.insert(seasons).values({ name, startsAt: now }).returning();
  if (!row) throw new Error('No se pudo crear la temporada');
  return row;
}

/**
 * Makes one season the running one.
 *
 * Two tables' worth of truth move together — the old season closes and the new
 * one opens — so it is a transaction. The unique index would reject the second
 * write anyway; doing it in order inside one transaction is what keeps that from
 * being a 500 in the admin's face.
 */
export async function activateSeason(seasonId: string, now: Date): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(seasons)
      .set({ isActive: false, endsAt: now })
      .where(eq(seasons.isActive, true));
    await tx
      .update(seasons)
      .set({ isActive: true, endsAt: null })
      .where(eq(seasons.id, seasonId));
  });
}

export async function setAdjustment(input: {
  seasonId: string;
  speciesId: string;
  attackDelta: number;
  manaCostDelta: number;
  note: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(seasonAdjustments)
    .values(input)
    .onConflictDoUpdate({
      target: [seasonAdjustments.seasonId, seasonAdjustments.speciesId],
      set: {
        attackDelta: input.attackDelta,
        manaCostDelta: input.manaCostDelta,
        note: input.note,
      },
    });
}

export async function clearAdjustment(seasonId: string, speciesId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(seasonAdjustments)
    .where(
      and(eq(seasonAdjustments.seasonId, seasonId), eq(seasonAdjustments.speciesId, speciesId)),
    );
}
