import type { ObjectiveMetric } from '../schemas/objectives';

/**
 * OBJECTIVE PROGRESS — advanced server-side only.
 *
 * Pure functions over a progress snapshot. The caller supplies the amount, which
 * server-side comes from a resolved match or a completed care day, never from
 * the client.
 */

/**
 * How a metric accumulates.
 *
 *   sum — counters that add up over time (matches won, gems cleared).
 *   max — high-water marks: reaching 8 once is enough, a later 4 must not undo it.
 */
export const OBJECTIVE_AGGREGATION = {
  matches_played: 'sum',
  matches_won: 'sum',
  damage_dealt: 'sum',
  enemies_defeated: 'sum',
  element_gems_cleared: 'sum',
  max_combo: 'max',
  days_cared: 'sum',
  times_fed: 'sum',
  evolutions_performed: 'sum',
} as const satisfies Record<ObjectiveMetric, 'sum' | 'max'>;

export type ObjectiveAggregation = (typeof OBJECTIVE_AGGREGATION)[ObjectiveMetric];

export function aggregationFor(metric: ObjectiveMetric): ObjectiveAggregation {
  return OBJECTIVE_AGGREGATION[metric];
}

export type ObjectiveSnapshot = {
  id: string;
  metric: ObjectiveMetric;
  targetValue: number;
};

export type ProgressSnapshot = {
  currentValue: number;
  completedAt: Date | null;
};

export type ProgressUpdate = {
  currentValue: number;
  completedAt: Date | null;
  justCompleted: boolean;
  changed: boolean;
};

/**
 * Advances progress and decides completion.
 *
 * `completedAt` is written ONCE and never cleared. Raising an objective's target
 * later must not un-complete what a player already earned, and lowering it must
 * not silently re-date an old completion.
 */
export function advanceObjective(
  objective: ObjectiveSnapshot,
  progress: ProgressSnapshot,
  amount: number,
  now: Date,
): ProgressUpdate {
  const delta = Math.trunc(amount);
  const nextValue =
    aggregationFor(objective.metric) === 'max'
      ? Math.max(progress.currentValue, delta)
      : progress.currentValue + Math.max(delta, 0);

  const wasComplete = progress.completedAt !== null;
  const reachesTarget = nextValue >= objective.targetValue;
  const justCompleted = !wasComplete && reachesTarget;

  return {
    currentValue: nextValue,
    completedAt: wasComplete ? progress.completedAt : justCompleted ? now : null,
    justCompleted,
    changed: nextValue !== progress.currentValue || justCompleted,
  };
}

export function isObjectiveComplete(progress: ProgressSnapshot): boolean {
  return progress.completedAt !== null;
}

/** Which of the required objectives are still missing. Server-verified input. */
export function missingObjectives(
  requiredObjectiveIds: readonly string[],
  completedObjectiveIds: readonly string[],
): string[] {
  const completed = new Set(completedObjectiveIds);
  return requiredObjectiveIds.filter((id) => !completed.has(id));
}
