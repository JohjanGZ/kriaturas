import { and, asc, eq, inArray } from 'drizzle-orm';
import { evaluateEvolution, evaluatePathChoice, fruitCostFor } from '@/core/evolution';
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

/**
 * Creature care and evolution.
 *
 * Both are the other half of the loop: the board hands out food and objective
 * progress, and this is where the player spends them. Every number that matters
 * is recomputed here from rows — the caller supplies an id and an amount, never
 * a stamina value, a cost or a completion.
 */

export type CreatureListItem = {
  id: string;
  name: string;
  speciesName: string;
  element: string;
  attack: number;
  manaCost: number;
  isEvolved: boolean;
  evolvedElement: string | null;
  lastFed: Date;
};

export async function listPlayerCreatures(playerId: string): Promise<CreatureListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: creatures.id,
      nickname: creatures.nickname,
      lastFed: creatures.lastFed,
      isEvolved: creatures.isEvolved,
      speciesName: species.name,
      element: species.baseElement,
      attack: species.baseAttack,
      manaCost: species.manaCost,
      pathBonus: evolutionPaths.attackBonus,
      pathElement: evolutionPaths.targetElement,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .leftJoin(evolutionPaths, eq(evolutionPaths.id, creatures.evolutionPathId))
    .where(eq(creatures.playerId, playerId))
    .orderBy(asc(creatures.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.nickname ?? row.speciesName,
    speciesName: row.speciesName,
    element: row.element,
    attack: row.attack + (row.isEvolved ? (row.pathBonus ?? 0) : 0),
    manaCost: row.manaCost,
    isEvolved: row.isEvolved,
    evolvedElement: row.isEvolved ? (row.pathElement ?? null) : null,
    lastFed: row.lastFed,
  }));
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
  element: string;
  attack: number;
  hp: number;
  manaCost: number;
  lastFed: Date;
  isEvolved: boolean;
  chosenPathId: string | null;
  paths: PathView[];
  fruitCost: number;
  playerFruits: number;
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
      chosenPathId: creatures.evolutionPathId,
      speciesId: species.id,
      speciesName: species.name,
      element: species.baseElement,
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

  return {
    id: row.id,
    name: row.nickname ?? row.speciesName,
    speciesName: row.speciesName,
    speciesId: row.speciesId,
    element: row.element,
    attack: row.attack,
    hp: row.hp,
    manaCost: row.manaCost,
    lastFed: row.lastFed,
    isEvolved: row.isEvolved,
    chosenPathId: row.chosenPathId,
    paths: pathViews,
    fruitCost: fruitCostFor(player.evolutionsPerformed, config.evolution),
    playerFruits: player.drakofruta,
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

export type ChoosePathResult = { ok: true } | { ok: false; reason: string };

/** Locking a branch. Permanent — the service refuses a second write. */
export async function chooseEvolutionPath(
  creatureId: string,
  playerId: string,
  pathId: string,
  now: Date,
): Promise<ChoosePathResult> {
  const db = await getDb();

  const [creature] = await db
    .select()
    .from(creatures)
    .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
    .limit(1);
  if (!creature) return { ok: false, reason: 'not_found' };

  const [path] = await db.select().from(evolutionPaths).where(eq(evolutionPaths.id, pathId)).limit(1);
  if (!path) return { ok: false, reason: 'path_not_found' };

  const verdict = evaluatePathChoice(
    {
      id: creature.id,
      speciesId: creature.speciesId,
      isEvolved: creature.isEvolved,
      evolutionPathId: creature.evolutionPathId,
    },
    { id: path.id, speciesId: path.speciesId },
  );
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  await db
    .update(creatures)
    .set({ evolutionPathId: path.id, evolutionChosenAt: now })
    .where(eq(creatures.id, creatureId));

  return { ok: true };
}

export type EvolveResult =
  | { ok: true; cost: number; targetElement: string }
  | { ok: false; reason: string; missing?: string[] };

/**
 * Evolving. Three tables move together — the player loses fruits and gains a
 * counter, the creature flips — so it is one transaction, and the cost is
 * recomputed from the config row rather than trusted from the page that
 * displayed it.
 */
export async function evolveCreature(
  creatureId: string,
  playerId: string,
  pathId: string | null,
  now: Date,
): Promise<EvolveResult> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [creature] = await db
    .select()
    .from(creatures)
    .where(and(eq(creatures.id, creatureId), eq(creatures.playerId, playerId)))
    .limit(1);
  if (!creature) return { ok: false, reason: 'not_found' };

  const targetPathId = creature.evolutionPathId ?? pathId;
  if (!targetPathId) return { ok: false, reason: 'path_not_chosen' };

  const [path] = await db
    .select()
    .from(evolutionPaths)
    .where(eq(evolutionPaths.id, targetPathId))
    .limit(1);
  if (!path) return { ok: false, reason: 'path_not_found' };

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return { ok: false, reason: 'not_found' };

  const reqs = await db
    .select({ objectiveId: objectives.id, scope: objectives.scope })
    .from(evolutionRequirements)
    .innerJoin(objectives, eq(objectives.id, evolutionRequirements.objectiveId))
    .where(eq(evolutionRequirements.evolutionPathId, path.id));

  const completed: string[] = [];
  for (const req of reqs) {
    const [entry] = await db
      .select()
      .from(objectiveProgress)
      .where(
        and(
          eq(objectiveProgress.objectiveId, req.objectiveId),
          eq(objectiveProgress.playerId, playerId),
        ),
      );
    const matchesScope =
      req.scope === 'creature' ? entry?.creatureId === creatureId : entry?.creatureId === null;
    if (entry && matchesScope && entry.completedAt !== null) completed.push(req.objectiveId);
  }

  const verdict = evaluateEvolution({
    creature: {
      id: creature.id,
      speciesId: creature.speciesId,
      isEvolved: creature.isEvolved,
      evolutionPathId: creature.evolutionPathId,
    },
    path: { id: path.id, speciesId: path.speciesId },
    requiredObjectiveIds: reqs.map((req) => req.objectiveId),
    completedObjectiveIds: completed,
    player: { drakofruta: player.drakofruta, evolutionsPerformed: player.evolutionsPerformed },
    config: config.evolution,
  });

  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason, missing: [...verdict.missingObjectiveIds] };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(players)
      .set({
        drakofruta: player.drakofruta - verdict.cost,
        evolutionsPerformed: player.evolutionsPerformed + 1,
      })
      .where(eq(players.id, playerId));

    await tx
      .update(creatures)
      .set({
        isEvolved: true,
        evolvedAt: now,
        evolutionPathId: path.id,
        evolutionChosenAt: creature.evolutionChosenAt ?? now,
      })
      .where(eq(creatures.id, creatureId));
  });

  return { ok: true, cost: verdict.cost, targetElement: path.targetElement };
}
