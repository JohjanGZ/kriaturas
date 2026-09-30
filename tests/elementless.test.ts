import { describe, expect, it } from 'vitest';
import { canFight, resolveElement } from '@/core/elements';

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
