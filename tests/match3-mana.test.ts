import { describe, expect, it } from 'vitest';
import type { Effect } from '@/core/effects/schema';
import { type Combatant, chargeMana, parseBoard, resolveMove, resolveTurn } from '@/core/match3';
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

const alwaysFood = (): number => 0.99;

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
  resolveTurn({ move: fireMatch(), team, enemyElement: 'water', config: combat });

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

describe('resolveTurn — basic attack and special', () => {
  it('attacks on every match even with the bar unfilled, but without effects', () => {
    const outcome = turn([combatant({ mana: 0, manaCost: 6 })]);
    const attack = outcome.attacks[0];

    expect(attack?.charged).toBe(false);
    expect(attack?.basicDamage).toBeGreaterThan(0); // the player is never idle
    expect(attack?.effectDamage).toBe(0);
    expect(attack?.heal).toBe(0);
    expect(outcome.specialsFired).toEqual([]);
  });

  it('fires the special when the gems fill the bar, and the attack carries the effect', () => {
    const outcome = turn([combatant({ mana: 3, manaCost: 6 })]); // 3 + 3 gems = 6
    const attack = outcome.attacks[0];

    expect(attack?.charged).toBe(true);
    expect(attack?.basicDamage).toBeGreaterThan(0);
    expect(attack?.effectDamage).toBe(50);
    expect(attack?.totalDamage).toBe((attack?.basicDamage ?? 0) + 50);
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
    expect(cheap?.effectDamage).toBe(50);
    expect(pricey?.effectDamage).toBe(0);
    // Both still landed their basic attack.
    expect(pricey?.basicDamage).toBeGreaterThan(0);
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
