import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { type BaseElement, resolveElement } from '@/core/elements';
import {
  deriveAffinity,
  isHighAffinity,
  nestChance,
  nestLaysEgg,
} from '@/core/affinity';
import { applyAdjustment, effectiveAdjustment } from '@/core/balance';
import { careDateFor, rollSpeciesFromPool } from '@/core/eggs';
import { staminaCeiling } from '@/core/health';
import { deriveStamina } from '@/core/stamina';
import { imageStorage } from '@/lib/storage';
import { getDb } from '../client';
import {
  corrals,
  creatures,
  eggTypeSpecies,
  eggTypes,
  eggs,
  incubators,
  players,
  species,
} from '../schema';
import { loadGameConfig } from './battle';
import { adjustmentFor, loadSeasonBalance } from './season';

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
  /** Enferma: la barra sube, pero con el techo bajo. Null es sana. */
  sickSince: Date | null;
  /** Lo que cuesta curarla de golpe, sin pasar por las misiones. */
  curePrice: number;
  /** Lo que cuesta la piedra: despierta a una blanca y abre la evolución de cualquiera. */
  stonePrice: number;
  /**
   * Si tiene su piedra fusionada. Sin ella la kriatura PELEA IGUAL pero no se
   * transforma — es un techo, no un muro, que es lo que hace que la piedra se
   * desee en vez de estorbar.
   */
  evolutionUnlocked: boolean;
  /** Afinidad de HOY, 0..100, ya con lo que el tiempo se llevó descontado. */
  affinity: number;
  /** Si cuenta para el nido. */
  highAffinity: boolean;
  /**
   * Los números con los que se compara una kriatura, YA AJUSTADOS por la
   * temporada. El corral sustituye al listado de "mis kriaturas", así que tiene
   * que heredar lo que aquello enseñaba: un sitio que imprime los números de la
   * ficha mientras el combate usa otros es un sitio que miente.
   */
  attack: number;
  manaCost: number;
  attackDelta: number;
  manaCostDelta: number;
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
  /** El nido: cuántas en afinidad alta, qué probabilidad hay y si ya se miró. */
  nest: { high: number; chance: number; checkedToday: boolean };
  /** Creatures with no corral — born before there were any. */
  loose: PennedCreature[];
  forSale: { capacity: number; priceCoins: number }[];
  coins: number;
  food: number;
  /** Piedras de regalo sin gastar: se usan ANTES que las monedas. */
  freeStones: number;
  /** El fondo del cercado, ya resuelto a URL. Null deja el degradado de siempre. */
  backgroundUrl: string | null;
  /** Plazas totales y ocupadas, para decirlo de un vistazo. */
  used: number;
  total: number;
};

/**
 * El fondo admite un `public_id` o una ruta directa de `public/`, y lo que las
 * distingue es la barra inicial: nada que empiece por `/` o por `http` pasa por
 * el adaptador, porque ya es una dirección.
 */
function resolveBackground(
  value: string | null,
  storage: { urlFor: (key: string) => string },
): string | null {
  if (!value) return null;
  if (value.startsWith('/') || value.startsWith('http')) return value;
  return storage.urlFor(value);
}

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
      sickSince: creatures.sickSince,
      affinityPoints: creatures.affinityPoints,
      affinityAt: creatures.affinityAt,
      unlockedAt: creatures.evolutionUnlockedAt,
      awakenedElement: creatures.element,
      speciesName: species.name,
      speciesElement: species.baseElement,
      imagePath: species.baseImagePath,
      speciesId: creatures.speciesId,
      attack: species.baseAttack,
      manaCost: species.manaCost,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(creatures.playerId, playerId))
    .orderBy(asc(creatures.createdAt));

  /** La temporada se aplica donde el jugador ELIGE, no solo donde se resuelve. */
  const balance = await loadSeasonBalance();
  const storage = imageStorage();

  /** Stamina is DERIVED for this render, never read from a column. */
  const toView = (row: (typeof rows)[number]): PennedCreature => {
    const sick = row.sickSince !== null;
    const stamina = deriveStamina(
      row.lastFed,
      now,
      config.stamina,
      staminaCeiling(sick, config.health, config.stamina),
    );
    /** Efectivo, no bruto: una excelente ignora los nerfeos de la temporada. */
    const adjustment = effectiveAdjustment(adjustmentFor(balance, row.speciesId), {
      excellent: row.isExcellent,
    });
    const tuned = applyAdjustment({ attack: row.attack, manaCost: row.manaCost }, adjustment);

    /** Derivada, nunca leída de una columna: lo ganado menos lo que el tiempo se llevó. */
    const affinity = deriveAffinity(row.affinityPoints, row.affinityAt, now, config.affinity);

    return {
      affinity,
      highAffinity: isHighAffinity(affinity, config.affinity),
      id: row.id,
      name: row.nickname ?? row.speciesName,
      speciesName: row.speciesName,
      attack: tuned.attack,
      manaCost: tuned.manaCost,
      attackDelta: adjustment.attackDelta,
      manaCostDelta: adjustment.manaCostDelta,
      element: resolveElement(row.speciesElement, row.awakenedElement),
      isExcellent: row.isExcellent,
      stamina: stamina.current,
      /** El máximo que ESTA kriatura alcanza: su techo si está enferma. */
      maxStamina: stamina.max,
      rested: !sick && stamina.current >= config.play.minStaminaToPlay,
      sickSince: row.sickSince,
      /**
       * El dibujo de verdad. Antes era `null` fijo, así que el corral leía la
       * columna y la tiraba: toda la arte subida quedaba guardada y sin
       * enseñar, y no se notaba porque el relleno siempre dibuja algo.
       */
      imageUrl: row.imagePath ? storage.urlFor(row.imagePath) : null,
      curePrice: config.health.curePriceCoins,
      stonePrice: config.shop.elementStonePriceCoins,
      evolutionUnlocked: row.unlockedAt !== null,
    };
  };

  const everyone = rows.map(toView);
  const high = everyone.filter((one) => one.highAffinity).length;

  return {
    nest: {
      high,
      chance: nestChance(high, config.affinity),
      checkedToday: player.lastNestCheck === careDateFor(now, config.eggs),
    },
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
    freeStones: player.freeStones,
    backgroundUrl: resolveBackground(config.corrals.backgroundImage, storage),
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

export type CureFailure = 'not_yours' | 'not_sick' | 'not_enough_coins';

/**
 * LA CURA COMPRADA — la vía rápida.
 *
 * Quien tiene monedas paga y sigue jugando; quien no, conseguirá los
 * ingredientes haciendo misiones. Que exista este camino es lo que hace
 * aceptable que enfermar duela: el precio de la enfermedad son monedas, no
 * días de tu vida esperando a terminar recados.
 *
 * Es el mismo principio que las baterías de las incubadoras — **las monedas
 * compran tiempo, nunca perdón.**
 */
export async function cureCreature(
  creatureId: string,
  playerId: string,
): Promise<{ ok: true; paid: number } | { ok: false; reason: CureFailure }> {
  const db = await getDb();
  const config = await loadGameConfig();
  const price = config.health.curePriceCoins;

  return db.transaction(async (tx) => {
    const [mine] = await tx
      .select({ id: creatures.id, sickSince: creatures.sickSince })
      .from(creatures)
      .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
      .limit(1);
    if (!mine) return { ok: false as const, reason: 'not_yours' as const };
    if (mine.sickSince === null) return { ok: false as const, reason: 'not_sick' as const };

    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'not_yours' as const };
    if (player.coins < price) {
      return { ok: false as const, reason: 'not_enough_coins' as const };
    }

    await tx
      .update(players)
      .set({ coins: player.coins - price })
      .where(eq(players.id, playerId));

    /**
     * Guarded by `sick_since IS NOT NULL` rather than by the read above: two
     * cures bought at the same instant would both pass a check made in
     * TypeScript, and the second must not charge for nothing.
     */
    await tx
      .update(creatures)
      .set({ sickSince: null })
      .where(and(eq(creatures.id, creatureId), isNotNull(creatures.sickSince)));

    return { ok: true as const, paid: price };
  });
}

export type StoneFailure =
  | 'not_yours'
  | 'wrong_element'
  | 'already_unlocked'
  | 'not_enough_coins';

/**
 * LA PIEDRA ELEMENTAL — el permiso para transformarse.
 *
 * La piedra y la drakofruta hacen trabajos distintos: la piedra es el
 * **permiso**, una vez y para siempre; la fruta es el **combustible**, cada
 * partida. Sin piedra una kriatura alinea toda la fruta del mundo y no se
 * transforma.
 *
 * Hace DOS cosas según a quién se le dé, y eso es deliberado:
 *
 * - a una kriatura normal, hay que darle **la de su propio elemento** y le
 *   abre la evolución;
 * - a una **blanca**, le da el elemento Y le abre la evolución de una vez. Una
 *   sola piedra por dos efectos es la compensación por nacer inservible, y es
 *   lo que impide que el Albo se sienta un caso aparte.
 *
 * Se escribe una vez con `WHERE evolution_unlocked_at IS NULL` dentro de la
 * transacción: dos piedras usadas a la vez pasarían las dos una comprobación
 * hecha en TypeScript, y si no se escribió ninguna fila no se cobra.
 */
export async function useElementStone(
  creatureId: string,
  playerId: string,
  element: BaseElement,
  now: Date,
): Promise<
  { ok: true; paid: number; freeUsed: boolean; awakened: boolean } | { ok: false; reason: StoneFailure }
> {
  const db = await getDb();
  const config = await loadGameConfig();
  const price = config.shop.elementStonePriceCoins;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: creatures.id,
        element: creatures.element,
        unlockedAt: creatures.evolutionUnlockedAt,
        speciesElement: species.baseElement,
      })
      .from(creatures)
      .innerJoin(species, eq(species.id, creatures.speciesId))
      .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
      .limit(1);
    if (!row) return { ok: false as const, reason: 'not_yours' as const };
    if (row.unlockedAt !== null) {
      return { ok: false as const, reason: 'already_unlocked' as const };
    }

    /**
     * Una blanca ACEPTA cualquier elemento: elegir es su gracia. Una normal
     * exige el suyo — para ella la piedra no es una decisión sino una compra,
     * y la decisión real es a cuál de tus kriaturas le inviertes.
     */
    const white = row.speciesElement === null && row.element === null;
    const own = row.element ?? row.speciesElement;
    if (!white && own !== element) {
      return { ok: false as const, reason: 'wrong_element' as const };
    }

    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'not_yours' as const };

    /** La primera es gratis: el primer bloqueo trae su propia solución. */
    const free = player.freeStones > 0;
    if (!free && player.coins < price) {
      return { ok: false as const, reason: 'not_enough_coins' as const };
    }

    await tx
      .update(players)
      .set(
        free
          ? { freeStones: player.freeStones - 1 }
          : { coins: player.coins - price },
      )
      .where(eq(players.id, playerId));

    const written = await tx
      .update(creatures)
      .set({
        evolutionUnlockedAt: now,
        ...(white ? { element, awakenedAt: now } : {}),
      })
      .where(and(eq(creatures.id, creatureId), isNull(creatures.evolutionUnlockedAt)))
      .returning({ id: creatures.id });

    /** La carrera la pierde la segunda: sin fila escrita, nada que cobrar. */
    if (written.length === 0) {
      return { ok: false as const, reason: 'already_unlocked' as const };
    }

    return { ok: true as const, paid: free ? 0 : price, freeUsed: free, awakened: white };
  });
}

export type NestResult =
  | { ok: true; laid: false; chance: number }
  | { ok: true; laid: true; chance: number; from: string }
  | { ok: false; reason: 'already_checked' | 'no_room' | 'no_egg_type' };

/**
 * EL NIDO — una tirada al día, y solo una.
 *
 * La probabilidad sube con cuántas kriaturas tienes en afinidad ALTA y nunca
 * pasa del tope (`maxChancePercent`). Ese techo es lo que mantiene al corral
 * como un extra: la tienda sigue siendo el camino fiable y ninguna cantidad de
 * kriaturas lo convierte en una fábrica.
 *
 * **Una vez al día, guardado en una fecha.** Si la tirada ocurriera al cargar
 * la página bastaría con recargar hasta que saliera huevo — el mismo agujero
 * que el registro de días pagados cierra con su índice único, resuelto igual:
 * la fecha se escribe en la misma transacción que mira si ya se tiró.
 *
 * Y el huevo que sale ocupa **slot de incubadora**, no plaza de corral: si no
 * hay sitio, no se tira. Mejor decir "no cabe" que gastar la tirada del día en
 * un huevo que no puede existir.
 */
export async function checkNest(playerId: string, now: Date): Promise<NestResult> {
  const db = await getDb();
  const config = await loadGameConfig();
  const today = careDateFor(now, config.eggs);

  return db.transaction(async (tx) => {
    const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player) return { ok: false as const, reason: 'already_checked' as const };
    if (player.lastNestCheck === today) {
      return { ok: false as const, reason: 'already_checked' as const };
    }

    /** Un huevo necesita incubadora libre: sin sitio no se gasta la tirada. */
    const owned = await tx.select().from(incubators).where(eq(incubators.playerId, playerId));
    const busy = await tx
      .select({ incubatorId: eggs.incubatorId })
      .from(eggs)
      .where(and(eq(eggs.playerId, playerId), eq(eggs.status, 'incubating')));
    const taken = new Set(busy.map((row) => row.incubatorId));
    const idle = owned.find((row) => !taken.has(row.id));
    if (!idle) return { ok: false as const, reason: 'no_room' as const };

    const mine = await tx
      .select({
        id: creatures.id,
        nickname: creatures.nickname,
        speciesName: species.name,
        affinityPoints: creatures.affinityPoints,
        affinityAt: creatures.affinityAt,
      })
      .from(creatures)
      .innerJoin(species, eq(species.id, creatures.speciesId))
      .where(eq(creatures.playerId, playerId));

    const high = mine.filter((row) =>
      isHighAffinity(
        deriveAffinity(row.affinityPoints, row.affinityAt, now, config.affinity),
        config.affinity,
      ),
    );
    const chance = nestChance(high.length, config.affinity);

    /** La fecha se escribe pase lo que pase: la tirada del día se gastó. */
    await tx
      .update(players)
      .set({ lastNestCheck: today })
      .where(eq(players.id, playerId));

    if (!nestLaysEgg(high.length, config.affinity, Math.random)) {
      return { ok: true as const, laid: false as const, chance };
    }

    /** El huevo del nido sale del tipo más barato publicado: es un regalo. */
    const [type] = await tx
      .select()
      .from(eggTypes)
      .where(eq(eggTypes.isPublished, true))
      .orderBy(asc(eggTypes.priceAmount))
      .limit(1);
    if (!type) return { ok: false as const, reason: 'no_egg_type' as const };

    const pool = await tx
      .select({ speciesId: eggTypeSpecies.speciesId, weight: eggTypeSpecies.weight })
      .from(eggTypeSpecies)
      .innerJoin(species, eq(species.id, eggTypeSpecies.speciesId))
      .where(and(eq(eggTypeSpecies.eggTypeId, type.id), eq(species.isPublished, true)));
    if (pool.length === 0) return { ok: false as const, reason: 'no_egg_type' as const };

    /** La especie se sortea aquí, server-side, como en cualquier otro huevo. */
    const rolled = rollSpeciesFromPool(pool, Math.random);
    const mother = high[Math.min(high.length - 1, Math.floor(Math.random() * high.length))];

    await tx.insert(eggs).values({
      playerId,
      eggTypeId: type.id,
      speciesId: rolled,
      /** Lo puso una kriatura: no se pagó nada, pero la columna exige un número. */
      paidAmount: 1,
      paidResource: type.priceResource,
      incubatorId: idle.id,
    });

    return {
      ok: true as const,
      laid: true as const,
      chance,
      from: mother?.nickname ?? mother?.speciesName ?? 'una de tus kriaturas',
    };
  });
}
