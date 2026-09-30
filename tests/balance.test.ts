import { describe, expect, it } from 'vitest';
import { NO_ADJUSTMENT, applyAdjustment, effectiveAdjustment, isNeutral } from '@/core/balance';

describe('seasonal balance', () => {
  const base = { attack: 12, manaCost: 8 };

  it('leaves a creature alone when the season says nothing', () => {
    expect(applyAdjustment(base)).toEqual(base);
    expect(applyAdjustment(base, NO_ADJUSTMENT)).toEqual(base);
  });

  it('buffs and nerfs with deltas, not absolute values', () => {
    expect(applyAdjustment(base, { attackDelta: 4, manaCostDelta: -2 })).toEqual({
      attack: 16,
      manaCost: 6,
    });
    expect(applyAdjustment(base, { attackDelta: -5, manaCostDelta: 3 })).toEqual({
      attack: 7,
      manaCost: 11,
    });
  });

  it('never nerfs a creature into harmlessness', () => {
    /** Zero attack would deal nothing for ever, whatever the player did. */
    expect(applyAdjustment(base, { attackDelta: -999, manaCostDelta: 0 }).attack).toBe(1);
  });

  it('never buffs a bar down to nothing', () => {
    /** A zero-cost bar would fire a special on every single match. */
    expect(applyAdjustment(base, { attackDelta: 0, manaCostDelta: -999 }).manaCost).toBe(1);
  });

  it('knows an adjustment that would change nothing', () => {
    expect(isNeutral({ attackDelta: 0, manaCostDelta: 0 })).toBe(true);
    expect(isNeutral({ attackDelta: -1, manaCostDelta: 0 })).toBe(false);
  });
});

describe('excellent creatures ignore a nerf', () => {
  const ordinary = { excellent: false };
  const excellent = { excellent: true };

  it('leaves an ordinary creature exposed to everything', () => {
    const nerf = { attackDelta: -4, manaCostDelta: 3 };
    expect(effectiveAdjustment(nerf, ordinary)).toEqual(nerf);
  });

  it('drops the penalties and keeps the gifts', () => {
    /** Less attack is a nerf; MORE mana cost is a nerf too. Both are dropped. */
    expect(effectiveAdjustment({ attackDelta: -4, manaCostDelta: 3 }, excellent)).toEqual({
      attackDelta: 0,
      manaCostDelta: 0,
    });

    /** A buff is a buff: more attack, and a cheaper bar. Both are kept. */
    expect(effectiveAdjustment({ attackDelta: 5, manaCostDelta: -2 }, excellent)).toEqual({
      attackDelta: 5,
      manaCostDelta: -2,
    });
  });

  it('filters per stat, not by sign', () => {
    /**
     * A season that lowers attack AND lowers the mana cost is half nerf, half
     * buff. Sign alone would keep the wrong half.
     */
    expect(effectiveAdjustment({ attackDelta: -6, manaCostDelta: -2 }, excellent)).toEqual({
      attackDelta: 0,
      manaCostDelta: -2,
    });
  });

  it('an excellent creature keeps its printed numbers through a nerf', () => {
    const base = { attack: 12, manaCost: 8 };
    const nerf = { attackDelta: -4, manaCostDelta: 2 };

    expect(applyAdjustment(base, effectiveAdjustment(nerf, excellent))).toEqual(base);
    expect(applyAdjustment(base, effectiveAdjustment(nerf, ordinary))).toEqual({
      attack: 8,
      manaCost: 10,
    });
  });
});
