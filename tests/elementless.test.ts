import { describe, expect, it } from 'vitest';
import { canFight, firstDuplicateElement, resolveElement } from '@/core/elements';

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
