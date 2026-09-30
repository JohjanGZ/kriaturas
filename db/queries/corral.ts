import { and, asc, eq, isNull } from 'drizzle-orm';
import { resolveElement } from '@/core/elements';
import { deriveStamina } from '@/core/stamina';
import { getDb } from '../client';
import { corrals, creatures, players, species } from '../schema';
import { loadGameConfig } from './battle';

/**
 * THE CORRAL — where the kriaturas live.
 *
 * Its only real property is capacity, and that number is the ceiling the egg
 * loop never had: until now a player could hatch for ever and the roster just
 * grew. A limit turns "one more creature" into a decision.
 *
 * Nothing here ever deletes a kriatura. A full corral refuses the newcomer; it
 * never makes room by itself.
 */

export type PennedCreature = {
  id: string;
  name: string;
  speciesName: string;
  /** Null for a white creature: no stone has given it an element yet. */
  element: string | null;
  isExcellent: boolean;
  stamina: number;
  maxStamina: number;
  /** True when it has enough stamina to be taken into a battle. */
  rested: boolean;
  imageUrl: string | null;
};

export type CorralView = {
  id: string;
  name: string;
  capacity: number;
  creatures: PennedCreature[];
};

export type CorralShelf = {
  corrals: CorralView[];
  /** Creatures with no corral — born before there were any. */
  loose: PennedCreature[];
  forSale: { capacity: number; priceCoins: number }[];
  coins: number;
  food: number;
  /** Plazas totales y ocupadas, para decirlo de un vistazo. */
  used: number;
  total: number;
};

export async function getCorralShelf(playerId: string, now: Date): Promise<CorralShelf | null> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;

  const pens = await db
    .select()
    .from(corrals)
    .where(eq(corrals.playerId, playerId))
    .orderBy(asc(corrals.createdAt));

  const rows = await db
    .select({
      id: creatures.id,
      nickname: creatures.nickname,
      lastFed: creatures.lastFed,
      isExcellent: creatures.isExcellent,
      corralId: creatures.corralId,
      awakenedElement: creatures.element,
      speciesName: species.name,
      speciesElement: species.baseElement,
      imagePath: species.baseImagePath,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(creatures.playerId, playerId))
    .orderBy(asc(creatures.createdAt));

  /** Stamina is DERIVED for this render, never read from a column. */
  const toView = (row: (typeof rows)[number]): PennedCreature => {
    const stamina = deriveStamina(row.lastFed, now, config.stamina);
    return {
      id: row.id,
      name: row.nickname ?? row.speciesName,
      speciesName: row.speciesName,
      element: resolveElement(row.speciesElement, row.awakenedElement),
      isExcellent: row.isExcellent,
      stamina: stamina.current,
      maxStamina: config.stamina.maxStamina,
      rested: stamina.current >= config.play.minStaminaToPlay,
      imageUrl: null,
    };
  };

  return {
    corrals: pens.map((pen) => ({
      id: pen.id,
      name: pen.name,
      capacity: pen.capacity,
      creatures: rows.filter((row) => row.corralId === pen.id).map(toView),
    })),
    loose: rows.filter((row) => row.corralId === null).map(toView),
    forSale: config.corrals.corralsForSale.map((offer: { capacity: number; priceCoins: number }) => ({
      capacity: offer.capacity,
      priceCoins: offer.priceCoins,
    })),
    coins: player.coins,
    food: player.food,
    used: rows.length,
    total: pens.reduce((sum, pen) => sum + pen.capacity, 0),
  };
}

/** Free places across every corral a player owns. Zero means no room for an egg. */
export async function freePlaces(playerId: string): Promise<number> {
  const db = await getDb();

  const pens = await db
    .select({ capacity: corrals.capacity })
    .from(corrals)
    .where(eq(corrals.playerId, playerId));
  const living = await db
    .select({ id: creatures.id })
    .from(creatures)
    .where(eq(creatures.playerId, playerId));

  const total = pens.reduce((sum, pen) => sum + pen.capacity, 0);
  return Math.max(0, total - living.length);
}

/**
 * The corral with room to spare, for a newborn to land in. Null when every one
 * is full — which is what refuses a hatch rather than making room.
 */
export async function corralWithRoom(playerId: string): Promise<string | null> {
  const db = await getDb();

  const pens = await db
    .select()
    .from(corrals)
    .where(eq(corrals.playerId, playerId))
    .orderBy(asc(corrals.createdAt));
  const living = await db
    .select({ id: creatures.id, corralId: creatures.corralId })
    .from(creatures)
    .where(eq(creatures.playerId, playerId));

  for (const pen of pens) {
    const inside = living.filter((row) => row.corralId === pen.id).length;
    if (inside < pen.capacity) return pen.id;
  }
  return null;
}

export type BuyCorralFailure = 'not_for_sale' | 'not_enough_coins';

export async function buyCorral(
  playerId: string,
  capacity: number,
): Promise<{ ok: true } | { ok: false; reason: BuyCorralFailure }> {
  const db = await getDb();
  const config = await loadGameConfig();

  const offer = config.corrals.corralsForSale.find(
    (entry: { capacity: number; priceCoins: number }) => entry.capacity === capacity,
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

    await tx.insert(corrals).values({
      playerId,
      name: `Corral de ${offer.capacity} plazas`,
      capacity: offer.capacity,
      paidAmount: offer.priceCoins,
    });

    return { ok: true as const };
  });
}

/** Moves a creature to another corral, refusing one that is already full. */
export async function moveCreature(
  creatureId: string,
  playerId: string,
  corralId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_yours' | 'full' }> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [mine] = await tx
      .select({ id: creatures.id })
      .from(creatures)
      .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
      .limit(1);
    if (!mine) return { ok: false as const, reason: 'not_yours' as const };

    const [pen] = await tx
      .select()
      .from(corrals)
      .where(and(eq(corrals.id, corralId), eq(corrals.playerId, playerId)))
      .limit(1);
    if (!pen) return { ok: false as const, reason: 'not_yours' as const };

    const inside = await tx
      .select({ id: creatures.id })
      .from(creatures)
      .where(eq(creatures.corralId, corralId));
    if (inside.length >= pen.capacity) return { ok: false as const, reason: 'full' as const };

    await tx.update(creatures).set({ corralId }).where(eq(creatures.id, creatureId));
    return { ok: true as const };
  });
}

/**
 * The corral everybody starts with, and a home for the loose ones.
 *
 * Called when a player is created and from the seed. It also adopts creatures
 * that have no corral — the ones born before corrals existed — because a
 * kriatura standing outside every pen is a bug the player can see.
 */
export async function giveStarterCorral(playerId: string): Promise<void> {
  const db = await getDb();
  const config = await loadGameConfig();

  const existing = await db.select().from(corrals).where(eq(corrals.playerId, playerId));
  let home = existing[0]?.id ?? null;

  if (!home) {
    const [created] = await db
      .insert(corrals)
      .values({
        playerId,
        name: 'Corral',
        capacity: config.corrals.starterCapacity,
        paidAmount: 0,
      })
      .returning();
    home = created?.id ?? null;
  }
  if (!home) return;

  await db
    .update(creatures)
    .set({ corralId: home })
    .where(and(eq(creatures.playerId, playerId), isNull(creatures.corralId)));
}
