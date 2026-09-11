import { describe, expect, it } from 'vitest';
import {
  type ObjectiveSnapshot,
  advanceObjective,
  aggregationFor,
  isObjectiveComplete,
  missingObjectives,
} from '@/core/objectives';
import { parseObjectiveParams } from '@/core/schemas/objectives';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const LATER = new Date('2026-06-20T12:00:00.000Z');

const wins: ObjectiveSnapshot = { id: 'obj-wins', metric: 'matches_won', targetValue: 10 };
const combo: ObjectiveSnapshot = { id: 'obj-combo', metric: 'max_combo', targetValue: 6 };

describe('aggregation', () => {
  it('sums counters and keeps high-water marks for max metrics', () => {
    expect(aggregationFor('matches_won')).toBe('sum');
    expect(aggregationFor('max_combo')).toBe('max');
  });
});

describe('advanceObjective', () => {
  it('accumulates progress without completing early', () => {
    const update = advanceObjective(wins, { currentValue: 3, completedAt: null }, 4, NOW);
    expect(update.currentValue).toBe(7);
    expect(update.completedAt).toBeNull();
    expect(update.justCompleted).toBe(false);
  });

  it('completes exactly at the target and stamps the instant', () => {
    const update = advanceObjective(wins, { currentValue: 9, completedAt: null }, 1, NOW);
    expect(update.currentValue).toBe(10);
    expect(update.justCompleted).toBe(true);
    expect(update.completedAt).toEqual(NOW);
  });

  it('keeps the original completion instant on later progress', () => {
    const update = advanceObjective(wins, { currentValue: 10, completedAt: NOW }, 5, LATER);
    expect(update.currentValue).toBe(15);
    expect(update.justCompleted).toBe(false);
    expect(update.completedAt).toEqual(NOW);
  });

  it('never un-completes an objective whose target was raised afterwards', () => {
    const raised: ObjectiveSnapshot = { ...wins, targetValue: 50 };
    const update = advanceObjective(raised, { currentValue: 10, completedAt: NOW }, 1, LATER);
    expect(isObjectiveComplete(update)).toBe(true);
    expect(update.completedAt).toEqual(NOW);
  });

  it('keeps the highest value for max metrics, so a worse run cannot undo a good one', () => {
    const best = advanceObjective(combo, { currentValue: 0, completedAt: null }, 8, NOW);
    expect(best.currentValue).toBe(8);
    expect(best.justCompleted).toBe(true);

    const worse = advanceObjective(combo, best, 4, LATER);
    expect(worse.currentValue).toBe(8);
    expect(worse.completedAt).toEqual(NOW);
  });

  it('ignores negative deltas on cumulative metrics', () => {
    const update = advanceObjective(wins, { currentValue: 5, completedAt: null }, -3, NOW);
    expect(update.currentValue).toBe(5);
    expect(update.changed).toBe(false);
  });
});

describe('missingObjectives', () => {
  it('reports only what is still missing', () => {
    expect(missingObjectives(['a', 'b', 'c'], ['b', 'z'])).toEqual(['a', 'c']);
    expect(missingObjectives([], ['b'])).toEqual([]);
    expect(missingObjectives(['a'], ['a'])).toEqual([]);
  });
});

describe('objective params validation', () => {
  it('requires an element for element_gems_cleared', () => {
    expect(parseObjectiveParams('element_gems_cleared', { element: 'plant' })).toEqual({
      metric: 'element_gems_cleared',
      params: { element: 'plant' },
    });
    expect(() => parseObjectiveParams('element_gems_cleared', {})).toThrow();
  });

  it('rejects an evolved element for a board metric — the board holds base elements only', () => {
    expect(() => parseObjectiveParams('element_gems_cleared', { element: 'poison' })).toThrow();
  });

  it('rejects stray params on a metric that takes none', () => {
    expect(() => parseObjectiveParams('matches_won', { element: 'fire' })).toThrow();
  });
});
