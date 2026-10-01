import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  careDateFor,
  evaluateHatch,
  payableDates,
  planPower,
  poweredDays,
  rollSpeciesFromPool,
  shiftCareDate,
} from '@/core/eggs';
import { initialAnchor } from '@/core/stamina';
import { getDb } from '../client';
import {
  corrals,
  creatures,
  eggCareLog,
  eggTypeSpecies,
  eggTypes,
  eggs,
  incubators,
  players,
  species,
} from '../schema';
import { loadGameConfig } from './battle';

/**
 * EGGS — bought, powered, hatched.
 *
 * Three things never come from the client and never happen twice:
 *
 * 1. WHICH SPECIES. Rolled once, server-side, at purchase, and stored
 *    immediately. No query exposes it until the egg has hatched, so there is
 *    nothing to re-roll and nothing to wish for.
 * 2. WHICH DAY. Derived from the server clock. The unique index on
 *    (egg, care_date) is the real guard; a day cannot be paid twice, replayed
 *    or back-filled.
 * 3. WHAT IT COST. Priced from the egg-type row and the config, never from a
 *    number the browser sends. Coins are spent in the same transaction that
 *    writes the rows they bought.
 */

export type EggView = {
  id: string;
  typeName: string;
  typeSlug: string;
  /** Null until it hatches. The whole point of the egg is not knowing. */
  speciesName: string | null;
  status: 'incubating' | 'hatched' | 'spoiled';
  careDaysRequired: number;
  /** Paid days that have already arrived: what the player has actually earned. */
  poweredDays: number;
  /** Paid days still in the future — the battery, as a number of days. */
  chargedAhead: number;
  electricityCost: number;
  readyToHatch: boolean;
  incubator: { id: string; name: string; capacityDays: number } | null;
  /** How many days can be bought right now, and what that would cost. */
  payableDays: number;
  payableCost: number;
};

export type IncubatorView = {
  id: string;
  name: string;
  capacityDays: number;
  eggId: string | null;
};

export type EggShelf = {
  eggs: EggView[];
  incubators: IncubatorView[];
  types: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    priceAmount: number;
    careDaysRequired: number;
    electricityCost: number;
  }[];
  /** Incubators for sale, from config: capacity and price. */
  forSale: { capacityDays: number; priceCoins: number }[];
  coins: number;
  maxActiveEggs: number;
  today: string;
};

/** Everything the incubator screen shows, derived for this render. */
export async function getEggShelf(playerId: string, now: Date): Promise<EggShelf | null> {
  const db = await getDb();
  const config = await loadGameConfig();
  const today = careDateFor(now, config.eggs);

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;

  const mine = await db
    .select({
      id: eggs.id,
      status: eggs.status,
      incubatorId: eggs.incubatorId,
      speciesName: species.name,
      typeName: eggTypes.name,
      typeSlug: eggTypes.slug,
      careDaysRequired: eggTypes.careDaysRequired,
      electricityCost: eggTypes.electricityCost,
    })
    .from(eggs)
    .innerJoin(eggTypes, eq(eggTypes.id, eggs.eggTypeId))
    .innerJoin(species, eq(species.id, eggs.speciesId))
    .where(eq(eggs.playerId, playerId))
    .orderBy(asc(eggs.createdAt));

  const ids = mine.map((egg) => egg.id);
  const paid =
    ids.length === 0
      ? []
      : await db
          .select({ eggId: eggCareLog.eggId, careDate: eggCareLog.careDate })
          .from(eggCareLog)
          .where(inArray(eggCareLog.eggId, ids));

  const owned = await db
    .select()
    .from(incubators)
    .where(eq(incubators.playerId, playerId))
    .orderBy(asc(incubators.capacityDays), asc(incubators.createdAt));

  const catalogue = await db
    .select()
    .from(eggTypes)
    .where(eq(eggTypes.isPublished, true))
    .orderBy(asc(eggTypes.priceAmount));

  const views: EggView[] = mine.map((egg) => {
    const dates = paid.filter((row) => row.eggId === egg.id).map((row) => row.careDate);
    const lived = poweredDays(dates, today);
    const incubator = owned.find((row) => row.id === egg.incubatorId) ?? null;

    /** With no incubator there is nowhere to put the power, so nothing is payable. */
    const payable = incubator
      ? payableDates({
          paidDates: dates,
          today,
          capacityDays: incubator.capacityDays,
          careDaysRequired: egg.careDaysRequired,
        })
      : [];

    return {
      id: egg.id,
      typeName: egg.typeName,
      typeSlug: egg.typeSlug,
      /** Hidden until it hatches: that is the entire drama of an egg. */
      speciesName: egg.status === 'hatched' ? egg.speciesName : null,
      status: egg.status,
      careDaysRequired: egg.careDaysRequired,
      poweredDays: lived,
      chargedAhead: dates.length - lived,
      electricityCost: egg.electricityCost,
      readyToHatch:
        evaluateHatch(
          { status: egg.status, poweredDays: lived },
          { careDaysRequired: egg.careDaysRequired, electricityCost: egg.electricityCost },
        ).ok,
      incubator: incubator
        ? { id: incubator.id, name: incubator.name, capacityDays: incubator.capacityDays }
        : null,
      payableDays: payable.length,
      payableCost: payable.length * egg.electricityCost,
    };
  });

  return {
    eggs: views,
    incubators: owned.map((row) => ({
      id: row.id,
      name: row.name,
      capacityDays: row.capacityDays,
      eggId:
        mine.find((egg) => egg.incubatorId === row.id && egg.status === 'incubating')?.id ?? null,
    })),
    types: catalogue.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      priceAmount: row.priceAmount,
      careDaysRequired: row.careDaysRequired,
      electricityCost: row.electricityCost,
    })),
    forSale: config.eggs.incubatorsForSale.map((entry) => ({
      capacityDays: entry.capacityDays,
      priceCoins: entry.priceCoins,
    })),
    coins: player.coins,
    maxActiveEggs: config.eggs.maxActiveEggsPerPlayer,
    today,
  };
}

export type BuyEggFailure =
  | 'egg_type_not_found'
  | 'not_enough_coins'
  | 'too_many_eggs'
  | 'empty_pool';

/**
 * Buys an egg: spends the coins, ROLLS THE SPECIES, and writes both in one
 * transaction. If the roll happened anywhere else it could be repeated.
 */
export async function buyEgg(
  playerId: string,
  eggTypeId: string,
  now: Date,
): Promise<{ ok: true; eggId: string } | { ok: false; reason: BuyEggFailure }> {
  const db = await getDb();
  const config = await loadGameConfig();

  return db.transaction(async (tx) => {
    const [type] = await tx
      .select()
      .from(eggTypes)
      .where(and(eq(eggTypes.id, eggTypeId), eq(eggTypes.isPublished, true)))
      .limit(1);
    if (!type) return { ok: false as const, reason: 'egg_type_not_found' as const };

    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'egg_type_not_found' as const };
    if (player.coins < type.priceAmount) {
      return { ok: false as const, reason: 'not_enough_coins' as const };
    }

    const active = await tx
      .select({ id: eggs.id })
      .from(eggs)
      .where(and(eq(eggs.playerId, playerId), eq(eggs.status, 'incubating')));
    if (active.length >= config.eggs.maxActiveEggsPerPlayer) {
      return { ok: false as const, reason: 'too_many_eggs' as const };
    }

    const pool = await tx
      .select({ speciesId: eggTypeSpecies.speciesId, weight: eggTypeSpecies.weight })
      .from(eggTypeSpecies)
      .innerJoin(species, eq(species.id, eggTypeSpecies.speciesId))
      .where(and(eq(eggTypeSpecies.eggTypeId, type.id), eq(species.isPublished, true)));
    if (pool.length === 0) return { ok: false as const, reason: 'empty_pool' as const };

    /** The draw, once, here. Nothing downstream can influence or repeat it. */
    const speciesId = rollSpeciesFromPool(pool, Math.random);

    await tx
      .update(players)
      .set({ coins: player.coins - type.priceAmount })
      .where(eq(players.id, playerId));

    /**
     * A new egg goes straight into the BEST idle incubator.
     *
     * Biggest battery first: somebody who bought a seven-day one should not
     * have to move the egg out of the free one by hand to use what they paid
     * for.
     */
    const owned = await tx
      .select()
      .from(incubators)
      .where(eq(incubators.playerId, playerId))
      .orderBy(desc(incubators.capacityDays));
    const busy = new Set(
      active.length === 0
        ? []
        : (
            await tx
              .select({ incubatorId: eggs.incubatorId })
              .from(eggs)
              .where(and(eq(eggs.playerId, playerId), eq(eggs.status, 'incubating')))
          ).map((row) => row.incubatorId),
    );
    const idle = owned.find((row) => !busy.has(row.id)) ?? null;

    const [created] = await tx
      .insert(eggs)
      .values({
        playerId,
        eggTypeId: type.id,
        speciesId,
        paidAmount: type.priceAmount,
        paidResource: type.priceResource,
        incubatorId: idle?.id ?? null,
      })
      .returning();
    if (!created) throw new Error('No se pudo crear el huevo');

    void now;
    return { ok: true as const, eggId: created.id };
  });
}

export type PowerFailure =
  | 'egg_not_found'
  | 'no_incubator'
  | 'already_done'
  | 'battery_full'
  | 'not_enough_coins';

/**
 * PAYS THE ELECTRICITY: spends coins and writes one row per day bought.
 *
 * The days come from `planPower`, which never returns a past day, never goes
 * beyond the incubator's battery and never sells more than the egg still needs.
 * The unique index behind it means a day already paid cannot be bought again
 * even if two requests arrive at once — the second violates it and the whole
 * transaction rolls back, coins included.
 */
export async function powerEgg(
  eggId: string,
  playerId: string,
  wantedDays: number,
  now: Date,
): Promise<{ ok: true; days: number; cost: number } | { ok: false; reason: PowerFailure }> {
  const db = await getDb();
  const config = await loadGameConfig();
  const today = careDateFor(now, config.eggs);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: eggs.id,
        status: eggs.status,
        incubatorId: eggs.incubatorId,
        careDaysRequired: eggTypes.careDaysRequired,
        electricityCost: eggTypes.electricityCost,
      })
      .from(eggs)
      .innerJoin(eggTypes, eq(eggTypes.id, eggs.eggTypeId))
      .where(and(eq(eggs.id, eggId), eq(eggs.playerId, playerId)))
      .limit(1);
    if (!row || row.status !== 'incubating') {
      return { ok: false as const, reason: 'egg_not_found' as const };
    }
    if (!row.incubatorId) return { ok: false as const, reason: 'no_incubator' as const };

    const [incubator] = await tx
      .select()
      .from(incubators)
      .where(eq(incubators.id, row.incubatorId))
      .limit(1);
    if (!incubator) return { ok: false as const, reason: 'no_incubator' as const };

    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'egg_not_found' as const };

    const paidDates = (
      await tx
        .select({ careDate: eggCareLog.careDate })
        .from(eggCareLog)
        .where(eq(eggCareLog.eggId, row.id))
    ).map((entry) => entry.careDate);

    const plan = planPower({
      paidDates,
      today,
      capacityDays: incubator.capacityDays,
      careDaysRequired: row.careDaysRequired,
      wantedDays,
      coins: player.coins,
      costPerDay: row.electricityCost,
    });
    if (!plan.ok) return { ok: false as const, reason: plan.reason };

    await tx
      .update(players)
      .set({ coins: player.coins - plan.cost })
      .where(eq(players.id, playerId));

    await tx
      .insert(eggCareLog)
      .values(plan.dates.map((careDate) => ({ eggId: row.id, careDate, caredAt: now })));

    /** Mirrored onto the egg for the admin to read; the log stays the truth. */
    await tx
      .update(eggs)
      .set({ careDaysCompleted: poweredDays([...paidDates, ...plan.dates], today), lastCaredAt: now })
      .where(eq(eggs.id, row.id));

    return { ok: true as const, days: plan.dates.length, cost: plan.cost };
  });
}

export type HatchFailure = 'egg_not_found' | 'not_ready' | 'already_hatched' | 'no_room';

/**
 * Hatches the egg into a creature. Two tables, so one transaction: an egg that
 * said "hatched" without producing a creature would be a loss the player paid
 * for.
 */
export async function hatchEgg(
  eggId: string,
  playerId: string,
  now: Date,
): Promise<
  { ok: true; creatureId: string; name: string } | { ok: false; reason: HatchFailure }
> {
  const db = await getDb();
  const config = await loadGameConfig();
  const today = careDateFor(now, config.eggs);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: eggs.id,
        status: eggs.status,
        speciesId: eggs.speciesId,
        speciesName: species.name,
        careDaysRequired: eggTypes.careDaysRequired,
        electricityCost: eggTypes.electricityCost,
      })
      .from(eggs)
      .innerJoin(eggTypes, eq(eggTypes.id, eggs.eggTypeId))
      .innerJoin(species, eq(species.id, eggs.speciesId))
      .where(and(eq(eggs.id, eggId), eq(eggs.playerId, playerId)))
      .limit(1);
    if (!row) return { ok: false as const, reason: 'egg_not_found' as const };

    const dates = (
      await tx
        .select({ careDate: eggCareLog.careDate })
        .from(eggCareLog)
        .where(eq(eggCareLog.eggId, row.id))
    ).map((entry) => entry.careDate);

    const verdict = evaluateHatch(
      { status: row.status, poweredDays: poweredDays(dates, today) },
      { careDaysRequired: row.careDaysRequired, electricityCost: row.electricityCost },
    );
    if (!verdict.ok) {
      return {
        ok: false as const,
        reason: verdict.reason === 'already_hatched' ? ('already_hatched' as const) : ('not_ready' as const),
      };
    }

    /**
     * A FULL CORRAL REFUSES THE NEWBORN — it never makes room by itself.
     *
     * The egg stays exactly as it is: powered, paid for and ready, waiting for
     * a place. Nothing is lost and nothing is deleted, which is the whole rule:
     * "one of yours died because you ran out of space" is what makes somebody
     * close a game for good.
     *
     * Queried with `tx` and not through `corralWithRoom`: a helper that opens
     * its own connection INSIDE an open transaction deadlocks PGlite, which is
     * a single process — and even where it does not, the check would be reading
     * outside the transaction it is supposed to guard.
     */
    const pens = await tx
      .select()
      .from(corrals)
      .where(eq(corrals.playerId, playerId))
      .orderBy(asc(corrals.createdAt));
    const living = await tx
      .select({ id: creatures.id, corralId: creatures.corralId })
      .from(creatures)
      .where(eq(creatures.playerId, playerId));

    const home =
      pens.find((pen) => living.filter((one) => one.corralId === pen.id).length < pen.capacity)
        ?.id ?? null;
    if (!home) return { ok: false as const, reason: 'no_room' as const };

    /**
     * Born rested, like the seeded starters: `initialAnchor` rather than the
     * column default, which would hatch it with zero stamina and nothing to do.
     */
    const [creature] = await tx
      .insert(creatures)
      .values({
        playerId,
        speciesId: row.speciesId,
        corralId: home,
        /**
         * NACE BLOQUEADA, y ahí es donde se aprende lo de las piedras.
         *
         * Para cuando llega este momento el jugador YA ha visto transformarse a
         * sus kriaturas de inicio, así que "necesito una piedra" es un antojo y
         * no un muro. Y lleva una piedra gratis esperando: el primer bloqueo
         * trae su propia solución.
         */
        evolutionUnlockedAt: null,
        lastFed: initialAnchor(now, config.stamina),
      })
      .returning();
    if (!creature) throw new Error('No se pudo crear la kriatura');

    await tx
      .update(eggs)
      .set({ status: 'hatched', hatchedAt: now, creatureId: creature.id, incubatorId: null })
      .where(eq(eggs.id, row.id));

    return { ok: true as const, creatureId: creature.id, name: row.speciesName };
  });
}

export type BuyIncubatorFailure = 'not_for_sale' | 'not_enough_coins';

/** Buys a bigger battery. What it sells is autonomy, never forgiveness. */
export async function buyIncubator(
  playerId: string,
  capacityDays: number,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: BuyIncubatorFailure }> {
  const db = await getDb();
  const config = await loadGameConfig();

  const offer = config.eggs.incubatorsForSale.find(
    (entry: { capacityDays: number; priceCoins: number }) => entry.capacityDays === capacityDays,
  );
  if (!offer) return { ok: false, reason: 'not_for_sale' };

  return db.transaction(async (tx) => {
    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'not_for_sale' as const };
    if (player.coins < offer.priceCoins) {
      return { ok: false as const, reason: 'not_enough_coins' as const };
    }

    await tx
      .update(players)
      .set({ coins: player.coins - offer.priceCoins })
      .where(eq(players.id, playerId));

    await tx.insert(incubators).values({
      playerId,
      name: `Incubadora de ${offer.capacityDays} días`,
      capacityDays: offer.capacityDays,
      paidAmount: offer.priceCoins,
    });

    void now;
    return { ok: true as const };
  });
}

/** Moves an egg into a free incubator, or takes it out. */
export async function setEggIncubator(
  eggId: string,
  playerId: string,
  incubatorId: string | null,
): Promise<{ ok: boolean }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [egg] = await tx
      .select({ id: eggs.id })
      .from(eggs)
      .where(and(eq(eggs.id, eggId), eq(eggs.playerId, playerId), eq(eggs.status, 'incubating')))
      .limit(1);
    if (!egg) return { ok: false };

    if (incubatorId) {
      const [target] = await tx
        .select({ id: incubators.id })
        .from(incubators)
        .where(and(eq(incubators.id, incubatorId), eq(incubators.playerId, playerId)))
        .limit(1);
      if (!target) return { ok: false };

      /** One egg per incubator: whoever was in it comes out first. */
      await tx
        .update(eggs)
        .set({ incubatorId: null })
        .where(and(eq(eggs.playerId, playerId), eq(eggs.incubatorId, incubatorId)));
    }

    await tx.update(eggs).set({ incubatorId }).where(eq(eggs.id, eggId));
    return { ok: true };
  });
}

/**
 * The free incubator everybody starts with: one day of battery.
 *
 * A three-day egg in it wants three visits, which is exactly the friction the
 * bigger ones remove. It is given rather than bought, because a player with no
 * incubator could buy an egg and have nowhere to put it.
 */
export async function giveStarterIncubator(playerId: string): Promise<void> {
  const db = await getDb();
  await db
    .insert(incubators)
    .values({ playerId, name: 'Incubadora básica', capacityDays: 1, paidAmount: 0 })
    .onConflictDoNothing();
}

/** The day key the server is on, for a UI that wants to say "hoy". */
export async function serverCareDate(now: Date): Promise<string> {
  const config = await loadGameConfig();
  return careDateFor(now, config.eggs);
}

export { shiftCareDate };
