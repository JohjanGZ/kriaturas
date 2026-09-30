import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { applyAdjustment, effectiveAdjustment } from '@/core/balance';
import { type BaseElement, resolveElement } from '@/core/elements';
import { feed } from '@/core/stamina';
import type { StaminaConfig } from '@/core/schemas/config';
import { getDb } from '../client';
import {
  creatures,
  evolutionPaths,
  evolutionRequirements,
  objectiveProgress,
  objectives,
  players,
  species,
} from '../schema';
import { loadGameConfig } from './battle';
import { adjustmentFor, loadSeasonBalance } from './season';

/**
 * Creature care.
 *
 * The other half of the loop: the board hands out food and objective progress,
 * and this is where the player spends them. Every number that matters is
 * recomputed here from rows — the caller supplies an id and an amount, never a
 * stamina value or a completion.
 *
 * EVOLUTION IS NOT HERE ANY MORE. It happens inside a battle, paid for with the
 * drakofruta aligned on the board, and it lasts exactly that battle — see
 * `core/battle` and `db/queries/battle.ts`. Nothing may write `is_evolved`.
 */

export type CreatureListItem = {
  id: string;
  name: string;
  speciesName: string;
  /** Null for a white creature: no stone has given it one yet. */
  element: string | null;
  attack: number;
  manaCost: number;
  /** What the running season adds or takes away. Zero when nothing is tuned. */
  attackDelta: number;
  manaCostDelta: number;
  /** The rare mark. In battle it transforms into the SUPERIOR element. */
  isExcellent: boolean;
  lastFed: Date;
};

export async function listPlayerCreatures(playerId: string): Promise<CreatureListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: creatures.id,
      nickname: creatures.nickname,
      lastFed: creatures.lastFed,
      isExcellent: creatures.isExcellent,
      speciesName: species.name,
      speciesElement: species.baseElement,
      /** What a stone gave it, if anything. Null for every ordinary creature. */
      awakenedElement: creatures.element,
      attack: species.baseAttack,
      manaCost: species.manaCost,
      speciesId: creatures.speciesId,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(creatures.playerId, playerId))
    .orderBy(asc(creatures.createdAt));

  /**
   * THE SEASON IS SHOWN WHERE THE PLAYER CHOOSES, not only where the battle
   * resolves. A roster printing the species numbers while the fight uses tuned
   * ones is a roster that lies.
   */
  const balance = await loadSeasonBalance();

  return rows.map((row) => {
    /** Effective, not raw: an excellent creature ignores the season's nerfs. */
    const adjustment = effectiveAdjustment(adjustmentFor(balance, row.speciesId), {
      excellent: row.isExcellent,
    });
    const tuned = applyAdjustment({ attack: row.attack, manaCost: row.manaCost }, adjustment);
    return {
      id: row.id,
      name: row.nickname ?? row.speciesName,
      speciesName: row.speciesName,
      /** Null means WHITE: it has no element yet, so it cannot be played. */
      element: resolveElement(row.speciesElement, row.awakenedElement),
      attack: tuned.attack,
      manaCost: tuned.manaCost,
      attackDelta: adjustment.attackDelta,
      manaCostDelta: adjustment.manaCostDelta,
      isExcellent: row.isExcellent,
      lastFed: row.lastFed,
    };
  });
}

export type PathView = {
  id: string;
  targetElement: string;
  name: string;
  description: string | null;
  hpBonus: number;
  attackBonus: number;
  defenseBonus: number;
  isDefault: boolean;
  requirements: {
    objectiveId: string;
    code: string;
    name: string;
    target: number;
    current: number;
    completed: boolean;
  }[];
  allRequirementsMet: boolean;
};

export type CreatureDetail = {
  id: string;
  name: string;
  speciesName: string;
  speciesId: string;
  /** Null for a white creature: no stone has given it one yet. */
  element: string | null;
  attack: number;
  hp: number;
  manaCost: number;
  attackDelta: number;
  manaCostDelta: number;
  lastFed: Date;
  isEvolved: boolean;
  chosenPathId: string | null;
  /** What it LOOKS like once evolved. The attack trigger is still `element`. */
  evolvedElement: string | null;
  paths: PathView[];
  playerFood: number;
};

export async function getCreatureDetail(
  creatureId: string,
  playerId: string,
): Promise<CreatureDetail | null> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [row] = await db
    .select({
      id: creatures.id,
      nickname: creatures.nickname,
      lastFed: creatures.lastFed,
      isEvolved: creatures.isEvolved,
      isExcellent: creatures.isExcellent,
      chosenPathId: creatures.evolutionPathId,
      speciesId: species.id,
      speciesName: species.name,
      speciesElement: species.baseElement,
      awakenedElement: creatures.element,
      attack: species.baseAttack,
      hp: species.baseHp,
      manaCost: species.manaCost,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
    .limit(1);
  if (!row) return null;

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return null;

  const paths = await db
    .select()
    .from(evolutionPaths)
    .where(eq(evolutionPaths.speciesId, row.speciesId))
    .orderBy(asc(evolutionPaths.sortOrder));

  const pathIds = paths.map((path) => path.id);
  const requirements =
    pathIds.length === 0
      ? []
      : await db
          .select({
            pathId: evolutionRequirements.evolutionPathId,
            objectiveId: objectives.id,
            code: objectives.code,
            name: objectives.name,
            target: objectives.targetValue,
            scope: objectives.scope,
          })
          .from(evolutionRequirements)
          .innerJoin(objectives, eq(objectives.id, evolutionRequirements.objectiveId))
          .where(inArray(evolutionRequirements.evolutionPathId, pathIds));

  const objectiveIds = [...new Set(requirements.map((req) => req.objectiveId))];
  const progress =
    objectiveIds.length === 0
      ? []
      : await db
          .select()
          .from(objectiveProgress)
          .where(
            and(
              inArray(objectiveProgress.objectiveId, objectiveIds),
              eq(objectiveProgress.playerId, playerId),
            ),
          );

  /**
   * Creature-scoped progress belongs to THIS creature; player-scoped progress is
   * shared. Matching on both keeps one creature's work from unlocking another's.
   */
  const progressFor = (objectiveId: string, scope: string) =>
    progress.find(
      (entry) =>
        entry.objectiveId === objectiveId &&
        (scope === 'creature' ? entry.creatureId === creatureId : entry.creatureId === null),
    );

  const pathViews: PathView[] = paths.map((path) => {
    const reqs = requirements
      .filter((req) => req.pathId === path.id)
      .map((req) => {
        const entry = progressFor(req.objectiveId, req.scope);
        return {
          objectiveId: req.objectiveId,
          code: req.code,
          name: req.name,
          target: req.target,
          current: entry?.currentValue ?? 0,
          completed: entry?.completedAt !== null && entry?.completedAt !== undefined,
        };
      });

    return {
      id: path.id,
      targetElement: path.targetElement,
      name: path.name,
      description: path.description,
      hpBonus: path.hpBonus,
      attackBonus: path.attackBonus,
      defenseBonus: path.defenseBonus,
      isDefault: path.isDefault,
      requirements: reqs,
      allRequirementsMet: reqs.every((req) => req.completed),
    };
  });

  const balance = await loadSeasonBalance();
  const adjustment = effectiveAdjustment(adjustmentFor(balance, row.speciesId), {
    excellent: row.isExcellent,
  });
  const tuned = applyAdjustment({ attack: row.attack, manaCost: row.manaCost }, adjustment);

  return {
    id: row.id,
    name: row.nickname ?? row.speciesName,
    speciesName: row.speciesName,
    speciesId: row.speciesId,
    /** Null means WHITE: no stone has landed on it yet, and it cannot fight. */
    element: resolveElement(row.speciesElement, row.awakenedElement),
    attack: tuned.attack,
    hp: row.hp,
    manaCost: tuned.manaCost,
    attackDelta: adjustment.attackDelta,
    manaCostDelta: adjustment.manaCostDelta,
    lastFed: row.lastFed,
    isEvolved: row.isEvolved,
    chosenPathId: row.chosenPathId,
    evolvedElement: row.isEvolved
      ? (pathViews.find((path) => path.id === row.chosenPathId)?.targetElement ?? null)
      : null,
    paths: pathViews,
    playerFood: player.food,
  };
}

export type FeedFailure = 'not_found' | 'no_food' | 'already_full';

export type FeedResultRow =
  | { ok: true; unitsConsumed: number; staminaBefore: number; staminaAfter: number }
  | { ok: false; reason: FeedFailure };

/**
 * Feeding: spends food and pulls the stamina anchor backwards, in one
 * transaction because it touches two tables.
 *
 * Only the food actually needed is consumed — `core/stamina` caps it — so
 * feeding a nearly full creature cannot silently burn the stack.
 */
export async function feedCreature(
  creatureId: string,
  playerId: string,
  units: number,
  now: Date,
): Promise<FeedResultRow> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [creature] = await db
    .select()
    .from(creatures)
    .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
    .limit(1);
  if (!creature) return { ok: false, reason: 'not_found' };

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return { ok: false, reason: 'not_found' };
  if (player.food < 1) return { ok: false, reason: 'no_food' };

  const available = Math.min(units, player.food);
  const result = feed(creature.lastFed, now, available, config.stamina satisfies StaminaConfig);
  if (!result.ok) return { ok: false, reason: 'already_full' };

  await db.transaction(async (tx) => {
    await tx
      .update(creatures)
      .set({ lastFed: result.lastFed })
      .where(eq(creatures.id, creatureId));
    await tx
      .update(players)
      .set({ food: player.food - result.unitsConsumed })
      .where(eq(players.id, playerId));
  });

  return {
    ok: true,
    unitsConsumed: result.unitsConsumed,
    staminaBefore: result.staminaBefore,
    staminaAfter: result.staminaAfter,
  };
}

export type AwakenFailure =
  | 'not_your_creature'
  | 'species_has_its_own_element'
  | 'already_awakened';

/**
 * A STONE LANDS: the white creature becomes one of the four.
 *
 * Written ONCE, like the evolution path, and guarded by a WHERE rather than by
 * a read-then-write: two stones used at the same instant would both pass a
 * check done in TypeScript, and the second must lose. The row's own constraint
 * backs it up, so a creature can never end up with an element and no instant.
 *
 * What SPENDS the stone is not here yet — the item does not exist — so this is
 * the write the mechanic will call, and for now the dev tool does.
 */
export async function awakenCreature(
  creatureId: string,
  playerId: string,
  element: BaseElement,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: AwakenFailure }> {
  const db = await getDb();

  const [row] = await db
    .select({ id: creatures.id, speciesElement: species.baseElement })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
    .limit(1);
  if (!row) return { ok: false, reason: 'not_your_creature' };

  /** A creature that already has an element of its own has nothing to decide. */
  if (row.speciesElement !== null) {
    return { ok: false, reason: 'species_has_its_own_element' };
  }

  const written = await db
    .update(creatures)
    .set({ element, awakenedAt: now })
    .where(and(eq(creatures.id, creatureId), isNull(creatures.element)))
    .returning({ id: creatures.id });

  return written.length > 0 ? { ok: true } : { ok: false, reason: 'already_awakened' };
}
