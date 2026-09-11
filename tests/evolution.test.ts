import { describe, expect, it } from 'vitest';
import {
  type CreatureSnapshot,
  type EvolutionAttempt,
  type PathSnapshot,
  evaluateEvolution,
  evaluatePathChoice,
  fruitCostFor,
} from '@/core/evolution';
import type { EvolutionConfig } from '@/core/schemas/config';

const config: EvolutionConfig = {
  baseFruitCost: 3,
  costIncrementPerEvolution: 2,
  maxEvolutionsPerPlayer: null,
  requireObjectives: true,
  allowEarlyPathChoice: true,
};

const SPECIES = 'species-plant';
const POISON: PathSnapshot = { id: 'path-poison', speciesId: SPECIES };
const ROCK: PathSnapshot = { id: 'path-rock', speciesId: SPECIES };
const FOREIGN: PathSnapshot = { id: 'path-astral', speciesId: 'species-psychic' };

const creature = (over: Partial<CreatureSnapshot> = {}): CreatureSnapshot => ({
  id: 'creature-1',
  speciesId: SPECIES,
  isEvolved: false,
  evolutionPathId: null,
  ...over,
});

const attempt = (over: Partial<EvolutionAttempt> = {}): EvolutionAttempt => ({
  creature: creature(),
  path: POISON,
  requiredObjectiveIds: [],
  completedObjectiveIds: [],
  player: { drakofruta: 99, evolutionsPerformed: 0 },
  config,
  ...over,
});

describe('fruitCostFor', () => {
  it('rises with every evolution the player has performed', () => {
    expect(fruitCostFor(0, config)).toBe(3);
    expect(fruitCostFor(1, config)).toBe(5);
    expect(fruitCostFor(4, config)).toBe(11);
  });

  it('is flat when the increment is zero', () => {
    expect(fruitCostFor(7, { ...config, costIncrementPerEvolution: 0 })).toBe(3);
  });
});

describe('evaluateEvolution', () => {
  it('refuses when the player has one fruit too few', () => {
    const verdict = evaluateEvolution(
      attempt({ player: { drakofruta: 4, evolutionsPerformed: 1 } }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('insufficient_fruits');
    expect(verdict.cost).toBe(5);
  });

  it('allows evolution at exactly the threshold', () => {
    const verdict = evaluateEvolution(
      attempt({ player: { drakofruta: 5, evolutionsPerformed: 1 } }),
    );
    expect(verdict).toEqual({ ok: true, pathId: 'path-poison', cost: 5 });
  });

  it('refuses a creature that already evolved, whatever else is true', () => {
    const verdict = evaluateEvolution(
      attempt({
        creature: creature({ isEvolved: true, evolutionPathId: POISON.id }),
        player: { drakofruta: 9999, evolutionsPerformed: 0 },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('already_evolved');
  });

  it('refuses a path belonging to another species', () => {
    const verdict = evaluateEvolution(attempt({ path: FOREIGN }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('path_belongs_to_other_species');
  });

  it('refuses a different path once one is locked — the choice is permanent', () => {
    const verdict = evaluateEvolution(
      attempt({ creature: creature({ evolutionPathId: ROCK.id }), path: POISON }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('path_choice_locked');
  });

  it('accepts the very path that was locked', () => {
    const verdict = evaluateEvolution(
      attempt({ creature: creature({ evolutionPathId: ROCK.id }), path: ROCK }),
    );
    expect(verdict).toEqual({ ok: true, pathId: 'path-rock', cost: 3 });
  });

  it('refuses while required objectives are still missing, and names them', () => {
    const verdict = evaluateEvolution(
      attempt({
        requiredObjectiveIds: ['obj-wins', 'obj-gems'],
        completedObjectiveIds: ['obj-wins'],
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('objectives_incomplete');
    expect(verdict.missingObjectiveIds).toEqual(['obj-gems']);
  });

  it('allows evolution once every required objective is completed', () => {
    const verdict = evaluateEvolution(
      attempt({
        requiredObjectiveIds: ['obj-wins', 'obj-gems'],
        completedObjectiveIds: ['obj-gems', 'obj-wins', 'obj-unrelated'],
      }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('skips the objective gate when config turns it off', () => {
    const verdict = evaluateEvolution(
      attempt({
        requiredObjectiveIds: ['obj-wins'],
        completedObjectiveIds: [],
        config: { ...config, requireObjectives: false },
      }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('requires a locked path first when early choice is disabled', () => {
    const verdict = evaluateEvolution(
      attempt({ config: { ...config, allowEarlyPathChoice: false } }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('path_not_chosen');
  });

  it('refuses once the player hits the evolution cap', () => {
    const verdict = evaluateEvolution(
      attempt({
        player: { drakofruta: 9999, evolutionsPerformed: 3 },
        config: { ...config, maxEvolutionsPerPlayer: 3 },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('max_evolutions_reached');
  });
});

describe('evaluatePathChoice', () => {
  it('locks a branch without requiring the objectives yet', () => {
    expect(evaluatePathChoice(creature(), ROCK)).toEqual({ ok: true, pathId: 'path-rock' });
  });

  it('refuses to relock an already chosen creature', () => {
    expect(evaluatePathChoice(creature({ evolutionPathId: POISON.id }), ROCK)).toEqual({
      ok: false,
      reason: 'path_choice_locked',
    });
  });

  it('refuses a path from another species', () => {
    expect(evaluatePathChoice(creature(), FOREIGN)).toEqual({
      ok: false,
      reason: 'path_belongs_to_other_species',
    });
  });

  it('refuses an already evolved creature', () => {
    expect(evaluatePathChoice(creature({ isEvolved: true }), ROCK)).toEqual({
      ok: false,
      reason: 'already_evolved',
    });
  });
});
