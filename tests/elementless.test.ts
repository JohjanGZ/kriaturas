import { describe, expect, it } from 'vitest';
import {
  canFight,
  firstDuplicateElement,
  pickDistinctElements,
  resolveElement,
} from '@/core/elements';

/**
 * THE WHITE CREATURE — born with no element, useless until a stone gives it one.
 *
 * The rule is one function, and every caller asks it rather than reimplementing
 * the coalesce: the roster, the picker and the battle must agree on what a
 * creature fights with, or one of them will offer a fight the others refuse.
 */
describe('resolveElement', () => {
  it('uses the species element for an ordinary creature', () => {
    expect(resolveElement('fire', null)).toBe('fire');
  });

  it('is NULL when neither the species nor the stone gave one', () => {
    expect(resolveElement(null, null)).toBeNull();
  });

  it('takes the stone element for a white creature', () => {
    expect(resolveElement(null, 'water')).toBe('water');
  });

  it('lets the creature win, so an awakening is never overruled by its species', () => {
    /** Not a case the game creates today, but the precedence has to be stated. */
    expect(resolveElement('fire', 'plant')).toBe('plant');
  });

  it('refuses anything that is not a BASE element', () => {
    /** The board only ever holds the four: an evolved element charges nothing. */
    expect(resolveElement('light', null)).toBeNull();
    expect(resolveElement(null, 'poison')).toBeNull();
    expect(resolveElement('nonsense', null)).toBeNull();
    expect(resolveElement(undefined, undefined)).toBeNull();
  });
});

describe('canFight', () => {
  it('is exactly "has an element", because that is what a gem charges', () => {
    expect(canFight('psychic', null)).toBe(true);
    expect(canFight(null, 'fire')).toBe(true);
    /** White: no gem on the board would ever charge it. */
    expect(canFight(null, null)).toBe(false);
  });
});

/**
 * ONE ELEMENT PER TEAM.
 *
 * A gem charges every creature of its element at once, so a pair sharing an
 * element is worth double per gem and deletes the decision the turn is built
 * around. The picker draws the rule and `startBattle` enforces it — both ask
 * this, so they cannot drift apart.
 */
describe('firstDuplicateElement', () => {
  it('is null for a team with one of each', () => {
    expect(firstDuplicateElement(['fire', 'water'])).toBeNull();
    expect(firstDuplicateElement(['fire', 'water', 'plant', 'psychic'])).toBeNull();
  });

  it('names the element that repeats', () => {
    expect(firstDuplicateElement(['fire', 'fire'])).toBe('fire');
    expect(firstDuplicateElement(['water', 'plant', 'water'])).toBe('water');
  });

  it('reports the FIRST repeat, so the message can name it', () => {
    expect(firstDuplicateElement(['plant', 'fire', 'fire', 'plant'])).toBe('fire');
  });

  it('ignores the creatures that have no element at all', () => {
    /** Two white ones are not "two of the same": they charge on nothing. */
    expect(firstDuplicateElement([null, null])).toBeNull();
    expect(firstDuplicateElement(['fire', null, undefined])).toBeNull();
  });

  it('says nothing about a team of one, or of none', () => {
    expect(firstDuplicateElement(['fire'])).toBeNull();
    expect(firstDuplicateElement([])).toBeNull();
  });
});

/**
 * The rival lineup is BUILT, not chosen, so there is no form to grey out: a
 * pair sharing an element would just quietly charge both bars off one gem and
 * fire twice as often. Same rule as the player's team, enforced where the
 * server assembles the pair.
 */
describe('pickDistinctElements', () => {
  const pool = [
    { slug: 'brasilla', element: 'fire' },
    { slug: 'pirox', element: 'fire' },
    { slug: 'gotina', element: 'water' },
    { slug: 'retono', element: 'plant' },
    { slug: 'albo', element: null },
  ];
  const elementOf = (row: { element: string | null }) => row.element;

  /** Deterministic, so a failure is reproducible rather than a flake. */
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  };

  it('never returns two of the same element, whatever the draw', () => {
    for (let seed = 1; seed < 60; seed += 1) {
      const picked = pickDistinctElements(pool, elementOf, 2, seeded(seed));
      expect(picked).toHaveLength(2);
      expect(firstDuplicateElement(picked.map(elementOf))).toBeNull();
    }
  });

  it('skips the ones with no element: nothing would ever charge them', () => {
    const onlyWhite = [{ slug: 'albo', element: null }];
    expect(pickDistinctElements(onlyWhite, elementOf, 2, seeded(3))).toEqual([]);
  });

  it('returns fewer than asked rather than refusing', () => {
    const oneElement = [
      { slug: 'brasilla', element: 'fire' },
      { slug: 'pirox', element: 'fire' },
    ];
    expect(pickDistinctElements(oneElement, elementOf, 2, seeded(5))).toHaveLength(1);
  });

  it('varies with the draw, so every battle is not the same battle', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40; seed += 1) {
      seen.add(
        pickDistinctElements(pool, elementOf, 2, seeded(seed))
          .map((row) => row.slug)
          .sort()
          .join('+'),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('asks for none and gets none', () => {
    expect(pickDistinctElements(pool, elementOf, 0, seeded(9))).toEqual([]);
  });
});
