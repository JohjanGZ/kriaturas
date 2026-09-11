import type { EvolutionConfig } from '../schemas/config';

/**
 * EVOLUTION — branching, gated, permanent.
 *
 * Pure decision logic. It reads a snapshot of rows and returns a verdict; the
 * caller performs the writes inside one transaction. Nothing here touches the
 * clock, the database, or randomness.
 *
 * The evolved element never appears in this file: the choice is a path id, and
 * the path is validated against the creature's species. There is no code path
 * by which a caller can name an element.
 */

/**
 * The threshold is not a constant. It rises with every evolution the player has
 * already performed:  cost(n) = baseFruitCost + n * costIncrementPerEvolution
 */
export function fruitCostFor(evolutionsPerformed: number, config: EvolutionConfig): number {
  const n = Math.max(0, Math.trunc(evolutionsPerformed));
  return config.baseFruitCost + n * config.costIncrementPerEvolution;
}

export type EvolutionRefusal =
  | 'already_evolved'
  | 'path_not_chosen'
  | 'path_belongs_to_other_species'
  | 'path_choice_locked'
  | 'objectives_incomplete'
  | 'insufficient_fruits'
  | 'max_evolutions_reached';

export type CreatureSnapshot = {
  id: string;
  speciesId: string;
  isEvolved: boolean;
  /** The path already locked for this creature, if any. */
  evolutionPathId: string | null;
};

export type PathSnapshot = {
  id: string;
  speciesId: string;
};

export type PlayerSnapshot = {
  drakofruta: number;
  evolutionsPerformed: number;
};

export type EvolutionAttempt = {
  creature: CreatureSnapshot;
  /** The path being attempted: the locked one, or the one passed in the action. */
  path: PathSnapshot;
  /** Objective ids this path requires. Empty means no requirements. */
  requiredObjectiveIds: readonly string[];
  /** Objective ids the creature/player has actually completed, server-verified. */
  completedObjectiveIds: readonly string[];
  player: PlayerSnapshot;
  config: EvolutionConfig;
};

export type EvolutionVerdict =
  | { ok: true; pathId: string; cost: number }
  | {
      ok: false;
      reason: EvolutionRefusal;
      cost: number;
      missingObjectiveIds: readonly string[];
    };

function refuse(
  reason: EvolutionRefusal,
  cost: number,
  missingObjectiveIds: readonly string[] = [],
): EvolutionVerdict {
  return { ok: false, reason, cost, missingObjectiveIds };
}

/**
 * Order matters and is deliberate: a creature that already evolved is refused
 * for that reason alone, whatever else is wrong. Cheap, permanent facts are
 * checked before the ones that a player can still fix.
 */
export function evaluateEvolution(attempt: EvolutionAttempt): EvolutionVerdict {
  const { creature, path, player, config } = attempt;
  const cost = fruitCostFor(player.evolutionsPerformed, config);

  if (creature.isEvolved) return refuse('already_evolved', cost);

  if (path.speciesId !== creature.speciesId) {
    return refuse('path_belongs_to_other_species', cost);
  }

  /**
   * A locked choice is permanent. Attempting a different path is an error, not
   * a silent override — that is the whole point of locking it.
   */
  if (creature.evolutionPathId !== null && creature.evolutionPathId !== path.id) {
    return refuse('path_choice_locked', cost);
  }

  if (creature.evolutionPathId === null && !config.allowEarlyPathChoice) {
    return refuse('path_not_chosen', cost);
  }

  if (
    config.maxEvolutionsPerPlayer !== null &&
    player.evolutionsPerformed >= config.maxEvolutionsPerPlayer
  ) {
    return refuse('max_evolutions_reached', cost);
  }

  if (config.requireObjectives) {
    const completed = new Set(attempt.completedObjectiveIds);
    const missing = attempt.requiredObjectiveIds.filter((id) => !completed.has(id));
    if (missing.length > 0) return refuse('objectives_incomplete', cost, missing);
  }

  if (player.drakofruta < cost) return refuse('insufficient_fruits', cost);

  return { ok: true, pathId: path.id, cost };
}

export type PathChoiceVerdict =
  | { ok: true; pathId: string }
  | { ok: false; reason: 'already_evolved' | 'path_choice_locked' | 'path_belongs_to_other_species' };

/**
 * Locking the path is a separate, earlier step. It does NOT require the
 * objectives to be met — it is the player committing to a branch.
 */
export function evaluatePathChoice(
  creature: CreatureSnapshot,
  path: PathSnapshot,
): PathChoiceVerdict {
  if (creature.isEvolved) return { ok: false, reason: 'already_evolved' };
  if (path.speciesId !== creature.speciesId) {
    return { ok: false, reason: 'path_belongs_to_other_species' };
  }
  if (creature.evolutionPathId !== null) {
    return { ok: false, reason: 'path_choice_locked' };
  }
  return { ok: true, pathId: path.id };
}
