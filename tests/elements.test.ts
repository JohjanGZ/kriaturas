import { describe, expect, it } from 'vitest';
import {
  BASE_ELEMENTS,
  CANONICAL_EVOLUTIONS,
  ELEMENTS,
  EVOLVED_ELEMENTS,
  defaultEvolvedElementFor,
  isBaseElement,
  isEvolvedElement,
  triggerElementFor,
} from '@/core/elements';
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
  it('holds the four base elements plus one neutral tile, and no evolved element', () => {
    expect(BOARD_TILE_KINDS).toEqual(['fire', 'water', 'plant', 'psychic', 'food']);
    for (const evolved of EVOLVED_ELEMENTS) {
      expect(BOARD_TILE_KINDS).not.toContain(evolved);
    }
  });

  it('never puts drakofruta on the board', () => {
    expect(BOARD_TILE_KINDS).not.toContain('drakofruta');
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
