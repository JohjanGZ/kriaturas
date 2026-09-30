import { describe, expect, it } from 'vitest';
import { BASE_ELEMENTS, CANONICAL_EVOLUTIONS, ELEMENTS, EVOLVED_ELEMENTS, defaultEvolvedElementFor, isBaseElement, isEvolvedElement, pathTier, superiorElementFor, triggerElementFor } from '@/core/elements';
import { BOARD_TILE_KINDS, attackPowerFor, damageForMatch, isElementTile } from '@/core/match3';
import type { CombatConfig } from '@/core/schemas/config';

const combat: CombatConfig = {
  evolvedDamageMultiplier: 1.5,
  minMatchLength: 3,
  boardWidth: 8,
  boardHeight: 8,
  maxCascades: 20,
  playerMaxHp: 100,
  allowFreeSwaps: true,
  damageOnlyOnSpecial: true,
  manaPerGem: 1,
  manaBonusPerExtraGem: 2,
  botEnabled: true,
  botSkill: 0.75,
  movesPerTurn: 2,
  extraMoveMinRun: 4,
  extraMovesPerTurn: 1,
  startingManaPercent: 40,
  rivalManaCostPercent: 70,
  fruitsToEvolve: 6,
  tileWeights: { fire: 4, water: 4, plant: 4, psychic: 4, food: 3, drakofruta: 2 },
};

describe('elements', () => {
  it('keeps exactly four base elements', () => {
    expect(BASE_ELEMENTS).toEqual(['fire', 'water', 'plant', 'psychic']);
  });

  it('has no element that is both base and evolved', () => {
    const overlap = ELEMENTS.filter((e) => isBaseElement(e) && isEvolvedElement(e));
    expect(overlap).toEqual([]);
  });

  it('maps every base element to its canonical default evolution', () => {
    expect(defaultEvolvedElementFor('fire')).toBe('light');
    expect(defaultEvolvedElementFor('water')).toBe('ice');
    expect(defaultEvolvedElementFor('plant')).toBe('poison');
    expect(defaultEvolvedElementFor('psychic')).toBe('astral');
  });

  it('covers every base element in the canonical map', () => {
    expect(Object.keys(CANONICAL_EVOLUTIONS).sort()).toEqual([...BASE_ELEMENTS].sort());
  });

  it('allows more evolved elements than canonical pairs — evolution branches', () => {
    expect(EVOLVED_ELEMENTS.length).toBeGreaterThan(BASE_ELEMENTS.length);
    expect(EVOLVED_ELEMENTS).toContain('rock');
  });
});

describe('board tiles', () => {
  it('holds the four base elements plus the two resource tiles, and no evolved element', () => {
    expect(BOARD_TILE_KINDS).toEqual([
      'fire',
      'water',
      'plant',
      'psychic',
      'food',
      'drakofruta',
    ]);
    for (const evolved of EVOLVED_ELEMENTS) {
      expect(BOARD_TILE_KINDS).not.toContain(evolved);
    }
  });

  it('puts drakofruta on the board as a RESOURCE, never as an element', () => {
    /**
     * It is aligned like any other tile, but it charges the IN-BATTLE evolution
     * and triggers no creature — so nothing may ever read it as an element.
     */
    expect(BOARD_TILE_KINDS).toContain('drakofruta');
    expect(isElementTile('drakofruta')).toBe(false);
    expect(BASE_ELEMENTS).not.toContain('drakofruta');
  });

  it('treats food as a resource tile, not an element', () => {
    expect(isElementTile('food')).toBe(false);
    expect(isElementTile('plant')).toBe(true);
  });

  it('triggers an evolved creature on its base element, not its evolved one', () => {
    // A plant creature that evolved into rock still attacks on plant gems.
    expect(triggerElementFor('plant')).toBe('plant');
    expect(BOARD_TILE_KINDS).toContain(triggerElementFor('plant'));
  });
});

describe('damage', () => {
  it('gives an evolved creature its path bonus and the configured multiplier', () => {
    const base = attackPowerFor(
      { speciesBaseAttack: 10, pathAttackBonus: 6, isEvolved: false },
      combat,
    );
    const evolved = attackPowerFor(
      { speciesBaseAttack: 10, pathAttackBonus: 6, isEvolved: true },
      combat,
    );
    expect(base).toBe(10);
    expect(evolved).toBe(24); // (10 + 6) * 1.5
    expect(evolved).toBeGreaterThan(base);
  });

  it('scales with alignment length from the configured minimum', () => {
    expect(damageForMatch({ power: 10, matchLength: 3 }, combat)).toBe(10);
    expect(damageForMatch({ power: 10, matchLength: 4 }, combat)).toBe(20);
    expect(damageForMatch({ power: 10, matchLength: 5 }, combat)).toBe(30);
  });

  it('deals nothing below the minimum match length', () => {
    expect(damageForMatch({ power: 10, matchLength: 2 }, combat)).toBe(0);
  });
});

/**
 * THE GRADE IS READ FROM THE TARGET, never from a column that could contradict
 * it. Both halves are legitimate paths, and the admin panel now creates both —
 * it used to make only the superior one and mark it default, which handed the
 * excellent-only form to every ordinary creature.
 */
describe('pathTier', () => {
  it('a path at a BASE element is the ordinary evolution', () => {
    expect(pathTier('fire')).toBe('normal');
    expect(pathTier('water')).toBe('normal');
    expect(pathTier('plant')).toBe('normal');
    expect(pathTier('psychic')).toBe('normal');
  });

  it('a path at an EVOLVED element is the excellent-only form', () => {
    expect(pathTier('light')).toBe('superior');
    expect(pathTier('ice')).toBe('superior');
    expect(pathTier('poison')).toBe('superior');
    expect(pathTier('astral')).toBe('superior');
    expect(pathTier('rock')).toBe('superior');
  });

  it('agrees with the canonical pair: the superior of a base is superior', () => {
    for (const base of BASE_ELEMENTS) {
      expect(pathTier(base)).toBe('normal');
      expect(pathTier(superiorElementFor(base))).toBe('superior');
    }
  });
});
