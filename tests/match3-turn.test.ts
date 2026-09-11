import { describe, expect, it } from 'vitest';
import type { Effect } from '@/core/effects/schema';
import {
  type Combatant,
  applyGravity,
  clearedIndices,
  findRuns,
  formatBoard,
  parseBoard,
  resolveMove,
  resolveTurn,
} from '@/core/match3';
import type { CombatConfig } from '@/core/schemas/config';

const combat: CombatConfig = {
  evolvedDamageMultiplier: 1.5,
  minMatchLength: 3,
  boardWidth: 8,
  boardHeight: 8,
  maxCascades: 20,
  playerMaxHp: 100,
  allowFreeSwaps: true,
};

const options = { minMatchLength: 3 };

/** Deterministic refills: every new tile is food, so cascades are predictable. */
const alwaysFood = (): number => 0.99;

/** A refill source that cycles a fixed script of choices. */
function script(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe('resolveMove — refusals', () => {
  const board = parseBoard('fwpf\nwpfw\npfwp\nfwpf');

  it('refuses a swap between cells that do not touch', () => {
    const result = resolveMove(board, { row: 0, col: 0 }, { row: 1, col: 1 }, options, alwaysFood);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_adjacent');
    expect(formatBoard(result.board)).toBe(formatBoard(board));
  });

  it('refuses a swap that leaves the board', () => {
    const result = resolveMove(board, { row: 0, col: 0 }, { row: -1, col: 0 }, options, alwaysFood);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('out_of_bounds');
  });

  it('refuses a swap that makes no run, and leaves the board untouched', () => {
    const result = resolveMove(board, { row: 0, col: 0 }, { row: 0, col: 1 }, options, alwaysFood);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_match');
    // The move is not spent and the swap is never applied.
    expect(formatBoard(result.board)).toBe(formatBoard(board));
  });
});

describe('resolveMove — clearing', () => {
  /**
   * maxCascades: 0 means "resolve the first clear and stop". These tests are
   * about what the swap itself clears, and `alwaysFood` would otherwise keep
   * lining food up forever — which is exactly why the cascade cap exists.
   */
  const firstClearOnly = { minMatchLength: 3, maxCascades: 0 };

  it('clears the run the swap created', () => {
    /**
     *   p f f      swapping (0,0) with (1,0) puts fire across the top row
     *   f w w
     *   w p p
     */
    const board = parseBoard('pff\nfww\nwpp');
    const result = resolveMove(
      board,
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      firstClearOnly,
      alwaysFood,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleared.fire).toBe(3);
    expect(result.longestRun.fire).toBe(3);
    expect(result.cascades).toBe(0);
    expect(result.steps).toHaveLength(1);
  });

  it('counts a five-run as five and records the run length', () => {
    const board = parseBoard('ffpff\nwwfww\nppwpp');
    const result = resolveMove(
      board,
      { row: 0, col: 2 },
      { row: 1, col: 2 },
      firstClearOnly,
      alwaysFood,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleared.fire).toBe(5);
    expect(result.longestRun.fire).toBe(5);
  });

  it('counts the shared cell of an L shape only once', () => {
    /**
     * Fire fills the top row and the left column: two runs meeting at (0,0).
     * That corner belongs to both, so the turn clears 5 distinct tiles, not 6 —
     * otherwise a lucky shape would silently inflate the reward.
     */
    const board = parseBoard('fffp\nfwpw\nfpwp\nwfpw');
    const runs = findRuns(board, 3);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.positions.length)).toEqual([3, 3]);
    expect(clearedIndices(board, runs).size).toBe(5);
  });
});

describe('gravity', () => {
  it('drops survivors and refills from the top', () => {
    const board = parseBoard('fff\nwww\nppp');
    const cleared = new Set([0, 1, 2]); // the whole top row
    const next = applyGravity(board, cleared, alwaysFood);

    // Everything shifts down one and food lands on top.
    expect(formatBoard(next)).toBe('ooo\nwww\nppp');
  });

  it('only moves the column that lost tiles', () => {
    const board = parseBoard('fwp\nfwp\nfwp');
    const next = applyGravity(board, new Set([0]), alwaysFood); // clear 0,0 only
    expect(formatBoard(next)).toBe('owp\nfwp\nfwp');
  });
});

describe('resolveMove — cascades', () => {
  it('keeps clearing while the refill makes new runs', () => {
    /**
     * The first clear drops food into the top row; the scripted source keeps
     * feeding food, so the refill immediately lines three food up and the turn
     * cascades a second time.
     */
    const board = parseBoard('pff\nfww\nwpp');
    const result = resolveMove(board, { row: 0, col: 0 }, { row: 1, col: 0 }, options, alwaysFood);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cascades).toBeGreaterThanOrEqual(1);
    expect(result.cleared.food).toBeGreaterThanOrEqual(3);
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('reports settled: false when the cap stops it with runs still on the board', () => {
    const board = parseBoard('pff\nfww\nwpp');
    const result = resolveMove(
      board,
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { minMatchLength: 3, maxCascades: 0 },
      alwaysFood,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // alwaysFood refills a full row of food, so a run is waiting right there.
    expect(result.settled).toBe(false);
    expect(findRuns(result.board, 3).length).toBeGreaterThan(0);
  });

  it('reports settled: true when the board really is clean', () => {
    const board = parseBoard('pffw\nfwwp\nwppf\npwfw');
    const result = resolveMove(
      board,
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      options,
      script([0.05, 0.3, 0.55, 0.8, 0.95, 0.2, 0.7, 0.45]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settled).toBe(true);
    expect(findRuns(result.board, 3)).toHaveLength(0);
  });

  it('stops at maxCascades instead of looping forever', () => {
    const board = parseBoard('pff\nfww\nwpp');
    const result = resolveMove(
      board,
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { minMatchLength: 3, maxCascades: 2 },
      alwaysFood,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.length).toBeLessThanOrEqual(3);
  });

  it('settles with no run left when the refill is varied', () => {
    const board = parseBoard('pffw\nfwwp\nwppf\npwfw');
    const result = resolveMove(
      board,
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      options,
      script([0.05, 0.3, 0.55, 0.8, 0.95, 0.2, 0.7, 0.45]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findRuns(result.board, 3)).toHaveLength(0);
  });
});

describe('resolveTurn', () => {
  const move = (source: string, a: [number, number], b: [number, number]) => {
    const result = resolveMove(
      parseBoard(source),
      { row: a[0], col: a[1] },
      { row: b[0], col: b[1] },
      { minMatchLength: 3, maxCascades: 1 },
      alwaysFood,
    );
    if (!result.ok) throw new Error(`move refused: ${result.reason}`);
    return result;
  };

  /**
   * Defaults to a bar that is already one gem from full, so a 3-match charges
   * it. Tests that care about the unfilled case set `mana: 0` explicitly.
   */
  const combatant = (over: Partial<Combatant> = {}): Combatant => ({
    creatureId: 'c1',
    baseElement: 'fire',
    baseAttack: 10,
    pathAttackBonus: 0,
    isEvolved: false,
    effects: [],
    manaCost: 3,
    mana: 0,
    ...over,
  });

  it('only the creatures whose element was matched attack', () => {
    const result = move('pff\nfww\nwpp', [0, 0], [1, 0]); // clears fire
    const outcome = resolveTurn({
      move: result,
      team: [combatant(), combatant({ creatureId: 'c2', baseElement: 'psychic' })],
      enemyElement: 'water',
      config: combat,
    });

    expect(outcome.attacks).toHaveLength(1);
    expect(outcome.attacks[0]?.creatureId).toBe('c1');
    expect(outcome.attacks[0]?.element).toBe('fire');
  });

  it('an evolved creature triggers on the same base gem and hits harder', () => {
    const result = move('pff\nfww\nwpp', [0, 0], [1, 0]);
    const base = resolveTurn({
      move: result,
      team: [combatant()],
      enemyElement: 'water',
      config: combat,
    });
    const evolved = resolveTurn({
      move: result,
      team: [combatant({ isEvolved: true, pathAttackBonus: 6 })],
      enemyElement: 'water',
      config: combat,
    });

    expect(evolved.attacks[0]?.element).toBe('fire'); // never the evolved element
    expect(evolved.attacks[0]?.power).toBe(24); // (10 + 6) * 1.5
    expect(evolved.totalDamage).toBeGreaterThan(base.totalDamage);
  });

  it('applies damage_by_type only against the matching enemy', () => {
    const result = move('pff\nfww\nwpp', [0, 0], [1, 0]);
    const effect: Effect = {
      type: 'damage_by_type',
      target: 'enemy',
      value: 30,
      condition: { enemy_element: 'plant' },
    };

    const against = resolveTurn({
      move: result,
      team: [combatant({ effects: [effect] })],
      enemyElement: 'plant',
      config: combat,
    });
    const wrong = resolveTurn({
      move: result,
      team: [combatant({ effects: [effect] })],
      enemyElement: 'water',
      config: combat,
    });

    expect(against.attacks[0]?.charged).toBe(true);

    expect(against.attacks[0]?.effectDamage).toBe(30);
    expect(wrong.attacks[0]?.effectDamage).toBe(0);
  });

  it('the combo bonus lifts the creature attack, not only the effect damage', () => {
    const result = move('ffpff\nwwfww\nppwpp', [0, 2], [1, 2]); // a run of five
    const plain = resolveTurn({
      move: result,
      team: [combatant()],
      enemyElement: 'water',
      config: combat,
    });
    const boosted = resolveTurn({
      move: result,
      team: [
        combatant({
          effects: [
            { type: 'combo_bonus', target: 'self', value: 100, condition: { min_combo: 5 } },
          ],
        }),
      ],
      enemyElement: 'water',
      config: combat,
    });

    expect(plain.attacks[0]?.basicDamage).toBe(30); // power 10 x (5 - 3 + 1)
    expect(boosted.attacks[0]?.charged).toBe(true);
    expect(boosted.attacks[0]?.basicDamage).toBe(60);
  });

  it('food is a resource: it triggers nobody and is reported separately', () => {
    const result = move('pff\nfww\nwpp', [0, 0], [1, 0]);
    const outcome = resolveTurn({
      move: result,
      team: [combatant({ baseElement: 'water' })],
      enemyElement: 'plant',
      config: combat,
    });

    expect(result.cleared.food).toBeGreaterThan(0);
    expect(outcome.foodGained).toBe(result.cleared.food);
    expect(outcome.attacks).toHaveLength(0);
    expect(outcome.totalDamage).toBe(0);
  });

  it('two creatures of the same element both trigger on one run', () => {
    const result = move('pff\nfww\nwpp', [0, 0], [1, 0]);
    const outcome = resolveTurn({
      move: result,
      team: [combatant(), combatant({ creatureId: 'c2' })],
      enemyElement: 'water',
      config: combat,
    });

    expect(outcome.attacks).toHaveLength(2);
    expect(outcome.totalDamage).toBe(
      (outcome.attacks[0]?.totalDamage ?? 0) + (outcome.attacks[1]?.totalDamage ?? 0),
    );
  });
});

describe('resolveMove — free swaps', () => {
  /** A genuine deadlock: no swap on this board lines three up. */
  const dead = parseBoard('fwpf\nwpfw\npfwp\nfwpf');
  const free = { minMatchLength: 3, allowNonMatching: true };

  it('accepts a swap that aligns nothing, and keeps the exchange', () => {
    const result = resolveMove(dead, { row: 0, col: 0 }, { row: 0, col: 1 }, free, alwaysFood);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatBoard(result.board)).toBe('wfpf\nwpfw\npfwp\nfwpf');
    expect(result.steps).toHaveLength(0);
    expect(result.cascades).toBe(0);
    expect(result.settled).toBe(true);
    expect(Object.values(result.cleared).every((count) => count === 0)).toBe(true);
  });

  it('still refuses it when free swaps are off, leaving the board untouched', () => {
    const result = resolveMove(dead, { row: 0, col: 0 }, { row: 0, col: 1 }, options, alwaysFood);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_match');
    expect(formatBoard(result.board)).toBe(formatBoard(dead));
  });

  it('never lets a free swap skip the geometry rules', () => {
    const far = resolveMove(dead, { row: 0, col: 0 }, { row: 2, col: 2 }, free, alwaysFood);
    const off = resolveMove(dead, { row: 0, col: 0 }, { row: -1, col: 0 }, free, alwaysFood);
    expect(far.ok).toBe(false);
    expect(off.ok).toBe(false);
    if (far.ok || off.ok) return;
    expect(far.reason).toBe('not_adjacent');
    expect(off.reason).toBe('out_of_bounds');
  });

  it('a free swap deals no damage and charges nobody — the turn is the price', () => {
    const result = resolveMove(dead, { row: 0, col: 0 }, { row: 0, col: 1 }, free, alwaysFood);
    if (!result.ok) throw new Error('free swap was refused');
    const outcome = resolveTurn({
      move: result,
      team: [
        {
          creatureId: 'c1',
          baseElement: 'fire',
          baseAttack: 10,
          pathAttackBonus: 0,
          isEvolved: false,
          effects: [],
          manaCost: 6,
          mana: 0,
        },
      ],
      enemyElement: 'water',
      config: combat,
    });
    expect(outcome.attacks).toHaveLength(0);
    expect(outcome.totalDamage).toBe(0);
    expect(outcome.foodGained).toBe(0);
  });
});
