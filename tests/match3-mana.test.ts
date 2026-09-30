import { describe, expect, it } from 'vitest';
import type { Effect } from '@/core/effects/schema';
import {
  BOARD_TILE_KINDS,
  type Combatant,
  chargeMana,
  manaGainedFor,
  parseBoard,
  resolveMove,
  resolveTurn,
  startingMana,
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

/**
 * Deterministic refills. `applyGravity` picks kinds[floor(r * kinds.length)],
 * so this aims the source at FOOD — and keeps aiming there now that drakofruta
 * has joined the bag, instead of silently refilling with the new tile.
 */
const alwaysFood = (): number =>
  (BOARD_TILE_KINDS.indexOf('food') + 0.5) / BOARD_TILE_KINDS.length;

/** Clears exactly three fire gems, no cascade. */
function fireMatch() {
  const result = resolveMove(
    parseBoard('pff\nfww\nwpp'),
    { row: 0, col: 0 },
    { row: 1, col: 0 },
    { minMatchLength: 3, maxCascades: 0 },
    alwaysFood,
  );
  if (!result.ok) throw new Error('fixture move was refused');
  return result;
}

const special: Effect[] = [
  { type: 'damage', target: 'enemy', value: 50 },
  { type: 'heal', target: 'self', value: 20 },
];

const combatant = (over: Partial<Combatant> = {}): Combatant => ({
  creatureId: 'c1',
  baseElement: 'fire',
  baseAttack: 10,
  pathAttackBonus: 0,
  isEvolved: false,
  effects: special,
  manaCost: 6,
  mana: 0,
  ...over,
});

const turn = (team: readonly Combatant[]) =>
  resolveTurn({ move: fireMatch(), team, enemyElements: ['water'], config: combat });

describe('chargeMana', () => {
  it('accumulates without firing while the bar is short', () => {
    expect(chargeMana(0, 3, 6)).toEqual({ manaAfter: 3, charged: false });
    expect(chargeMana(3, 2, 6)).toEqual({ manaAfter: 5, charged: false });
  });

  it('fires exactly at the cost and empties the bar', () => {
    expect(chargeMana(3, 3, 6)).toEqual({ manaAfter: 0, charged: true });
  });

  it('carries the leftover instead of wasting it', () => {
    expect(chargeMana(5, 4, 6)).toEqual({ manaAfter: 3, charged: true });
  });

  it('fires once per turn even when a cascade delivers several bars', () => {
    // 30 gems on a 6-cost bar is five charges worth; only one special comes out.
    const result = chargeMana(0, 30, 6);
    expect(result.charged).toBe(true);
    // And the carry is capped at one bar, so charges cannot be banked.
    expect(result.manaAfter).toBe(6);
  });

  it('treats a zero or negative cost as one, instead of dividing the game by zero', () => {
    expect(chargeMana(0, 1, 0).charged).toBe(true);
    expect(chargeMana(0, 1, -5).charged).toBe(true);
  });
});

describe('manaGainedFor — longer runs are worth more', () => {
  it('pays one per gem for a minimum-length run', () => {
    expect(manaGainedFor({ gemsCleared: 3, longestRun: 3 }, combat)).toBe(3);
  });

  it('pays a bonus for every gem beyond the minimum', () => {
    // 5 gems x 1, plus 2 gems past the minimum x 2.
    expect(manaGainedFor({ gemsCleared: 5, longestRun: 5 }, combat)).toBe(9);
  });

  it('a five-run beats a three-run plus two loose gems of the same element', () => {
    const five = manaGainedFor({ gemsCleared: 5, longestRun: 5 }, combat);
    const scattered = manaGainedFor({ gemsCleared: 5, longestRun: 3 }, combat);
    expect(five).toBeGreaterThan(scattered);
  });

  it('charges nothing when nothing was cleared', () => {
    expect(manaGainedFor({ gemsCleared: 0, longestRun: 0 }, combat)).toBe(0);
  });
});

describe('startingMana — the opening pays immediately', () => {
  it('fills the configured share of the bar', () => {
    expect(startingMana(10, combat)).toBe(4);
    expect(startingMana(5, combat)).toBe(2);
  });

  it('can still start empty', () => {
    expect(startingMana(10, { ...combat, startingManaPercent: 0 })).toBe(0);
  });

  it('never hands out more than one full bar', () => {
    expect(startingMana(10, { ...combat, startingManaPercent: 100 })).toBe(10);
  });
});

describe('resolveTurn — a match is not an attack', () => {
  it('deals NO damage while the bar is unfilled: the gems only charge it', () => {
    const outcome = turn([combatant({ mana: 0, manaCost: 6 })]);
    const attack = outcome.attacks[0];

    expect(attack?.charged).toBe(false);
    /** The whole point: clearing gems is an investment, not a hit. */
    expect(attack?.basicDamage).toBe(0);
    expect(attack?.effectDamage).toBe(0);
    expect(attack?.totalDamage).toBe(0);
    expect(outcome.totalDamage).toBe(0);
    expect(attack?.manaAfter).toBeGreaterThan(0); // but the bar did move
    expect(outcome.specialsFired).toEqual([]);
  });

  it('still hits on every match when damageOnlyOnSpecial is switched off', () => {
    const outcome = resolveTurn({
      move: fireMatch(),
      team: [combatant({ mana: 0, manaCost: 6 })],
      enemyElements: ['water'],
      config: { ...combat, damageOnlyOnSpecial: false },
    });
    expect(outcome.attacks[0]?.charged).toBe(false);
    expect(outcome.attacks[0]?.basicDamage).toBeGreaterThan(0);
  });

  it('fires the special when the gems fill the bar, and the attack carries the effect', () => {
    const outcome = turn([combatant({ mana: 3, manaCost: 6 })]); // 3 + 3 gems = 6
    const attack = outcome.attacks[0];

    expect(attack?.charged).toBe(true);
    expect(attack?.basicDamage).toBeGreaterThan(0);
    /** The special is a `damage` effect: it pierces, so it rides its own channel. */
    expect(attack?.pierceDamage).toBe(50);
    expect(attack?.totalDamage).toBe(attack?.basicDamage);
    expect(attack?.heal).toBe(20);
    expect(outcome.specialsFired).toEqual(['c1']);
  });

  it('empties the bar after firing, so the next turn starts again', () => {
    const first = turn([combatant({ mana: 3, manaCost: 6 })]);
    expect(first.attacks[0]?.manaAfter).toBe(0);

    const second = turn([combatant({ mana: first.attacks[0]?.manaAfter ?? 0, manaCost: 6 })]);
    expect(second.attacks[0]?.charged).toBe(false);
    expect(second.attacks[0]?.manaAfter).toBe(3);
  });

  it('reports the bar so the UI can draw it', () => {
    const attack = turn([combatant({ mana: 1, manaCost: 6 })]).attacks[0];
    expect(attack?.manaBefore).toBe(1);
    expect(attack?.manaGained).toBe(3);
    expect(attack?.manaAfter).toBe(4);
    expect(attack?.manaCost).toBe(6);
  });

  it('charges nothing for a creature whose element was not matched', () => {
    const outcome = turn([combatant({ baseElement: 'psychic', mana: 5, manaCost: 6 })]);
    expect(outcome.attacks).toHaveLength(0);
    expect(outcome.totalDamage).toBe(0);
  });

  it('a cheaper bar fires sooner than an expensive one on the same match', () => {
    const outcome = turn([
      combatant({ creatureId: 'cheap', manaCost: 3, mana: 0 }),
      combatant({ creatureId: 'pricey', manaCost: 30, mana: 0 }),
    ]);

    expect(outcome.specialsFired).toEqual(['cheap']);
    const cheap = outcome.attacks.find((a) => a.creatureId === 'cheap');
    const pricey = outcome.attacks.find((a) => a.creatureId === 'pricey');
    expect(cheap?.pierceDamage).toBe(50);
    expect(pricey?.pierceDamage).toBe(0);
    // The one that did not fill its bar dealt nothing at all.
    expect(pricey?.basicDamage).toBe(0);
    expect(pricey?.totalDamage).toBe(0);
  });

  it('a team of two with different elements charges independently', () => {
    const outcome = turn([
      combatant({ creatureId: 'fuego', baseElement: 'fire', mana: 3, manaCost: 6 }),
      combatant({ creatureId: 'agua', baseElement: 'water', mana: 5, manaCost: 6 }),
    ]);

    // Only fire was on the board this turn.
    expect(outcome.attacks.map((a) => a.creatureId)).toEqual(['fuego']);
    expect(outcome.specialsFired).toEqual(['fuego']);
  });

  it('an evolved creature charges the same but hits harder', () => {
    const plain = turn([combatant({ mana: 3, manaCost: 6 })]);
    const evolved = turn([
      combatant({ mana: 3, manaCost: 6, isEvolved: true, pathAttackBonus: 6 }),
    ]);

    expect(evolved.attacks[0]?.manaAfter).toBe(plain.attacks[0]?.manaAfter);
    expect(evolved.attacks[0]?.element).toBe('fire');
    expect(evolved.attacks[0]?.basicDamage).toBeGreaterThan(plain.attacks[0]?.basicDamage ?? 0);
  });
});
