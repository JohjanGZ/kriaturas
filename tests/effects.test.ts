import { describe, expect, it } from 'vitest';
import { type Effect, effectListSchema, parseEffectList } from '@/core/effects/schema';
import { type EffectContext, conditionHolds, resolveEffects } from '@/core/effects/resolve';

const context: EffectContext = {
  enemyElements: ['plant'],
  comboLength: 4,
  gemsCleared: 4,
  selfEvolved: false,
  selfHealthPercent: 100,
  enemyHealthPercent: 100,
  fruits: 0,
  turn: 1,
};

describe('conditionHolds', () => {
  it('holds when there is no condition at all', () => {
    expect(conditionHolds(undefined, context)).toBe(true);
  });

  it('requires every declared field to match', () => {
    expect(conditionHolds({ enemy_element: 'plant' }, context)).toBe(true);
    expect(conditionHolds({ enemy_element: 'fire' }, context)).toBe(false);
    expect(conditionHolds({ min_combo: 4 }, context)).toBe(true);
    expect(conditionHolds({ min_combo: 5 }, context)).toBe(false);
    expect(conditionHolds({ enemy_element: 'plant', min_combo: 5 }, context)).toBe(false);
  });

  it('distinguishes evolved from unevolved attackers', () => {
    expect(conditionHolds({ self_evolved: false }, context)).toBe(true);
    expect(conditionHolds({ self_evolved: true }, context)).toBe(false);
    expect(conditionHolds({ self_evolved: true }, { ...context, selfEvolved: true })).toBe(true);
  });
});

describe('resolveEffects', () => {
  it('sums PIERCING damage and reports what was applied', () => {
    const effects: Effect[] = [
      { type: 'damage', target: 'enemy', value: 20 },
      { type: 'damage', target: 'enemy', value: 5 },
    ];
    const resolved = resolveEffects(effects, context);
    /** `damage` is the piercing channel: no shield, no block. */
    expect(resolved.pierceDamage).toBe(25);
    expect(resolved.damage).toBe(0);
    expect(resolved.applied).toHaveLength(2);
    expect(resolved.skipped).toHaveLength(0);
  });

  it('applies damage_by_type only against the matching element', () => {
    const effect: Effect = {
      type: 'damage_by_type',
      target: 'enemy',
      value: 30,
      condition: { enemy_element: 'plant' },
    };
    expect(resolveEffects([effect], context).damage).toBe(30);
    const missed = resolveEffects([effect], { ...context, enemyElements: ['fire'] });
    expect(missed.damage).toBe(0);
    expect(missed.skipped).toHaveLength(1);
  });

  it('applies the combo bonus to the total, whatever order the admin listed them in', () => {
    const damage: Effect = { type: 'damage', target: 'enemy', value: 100 };
    const bonus: Effect = {
      type: 'combo_bonus',
      target: 'self',
      value: 50,
      condition: { min_combo: 4 },
    };
    expect(resolveEffects([damage, bonus], context).pierceDamage).toBe(150);
    expect(resolveEffects([bonus, damage], context).pierceDamage).toBe(150);
  });

  it('ignores the combo bonus when the combo is too short', () => {
    const effects: Effect[] = [
      { type: 'damage', target: 'enemy', value: 100 },
      { type: 'combo_bonus', target: 'self', value: 50, condition: { min_combo: 5 } },
    ];
    expect(resolveEffects(effects, context).pierceDamage).toBe(100);
  });

  it('collects heal and shield separately from damage', () => {
    const effects: Effect[] = [
      { type: 'heal', target: 'self', value: 12 },
      { type: 'shield', target: 'self', value: 8, duration_turns: 3 },
      { type: 'shield', target: 'self', value: 4, duration_turns: 1 },
    ];
    const resolved = resolveEffects(effects, context);
    expect(resolved.heal).toBe(12);
    expect(resolved.shield).toBe(12);
    expect(resolved.shieldTurns).toBe(3);
    expect(resolved.damage).toBe(0);
    expect(resolved.pierceDamage).toBe(0);
  });

  it('resolves an empty list to nothing rather than throwing', () => {
    const resolved = resolveEffects([], context);
    expect(resolved).toMatchObject({ damage: 0, heal: 0, shield: 0, comboBonusPercent: 0 });
  });
});

describe('effect validation', () => {
  it('accepts the documented example shape', () => {
    const parsed = parseEffectList([
      {
        type: 'damage_by_type',
        target: 'enemy',
        value: 30,
        condition: { enemy_element: 'plant' },
      },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it('requires an enemy element on damage_by_type', () => {
    expect(() =>
      parseEffectList([{ type: 'damage_by_type', target: 'enemy', value: 30 }]),
    ).toThrow();
  });

  it('requires a min_combo on combo_bonus', () => {
    expect(() => parseEffectList([{ type: 'combo_bonus', target: 'self', value: 30 }])).toThrow();
  });

  it('rejects an unknown effect type — effects are a closed set', () => {
    expect(() => parseEffectList([{ type: 'instant_win', target: 'enemy', value: 1 }])).toThrow();
  });

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(() =>
      parseEffectList([{ type: 'damage', target: 'enemy', value: 10, multiplier: 99 }]),
    ).toThrow();
  });

  it('defaults a shield to one turn', () => {
    const parsed = effectListSchema.parse([{ type: 'shield', target: 'self', value: 5 }]);
    expect(parsed[0]).toMatchObject({ duration_turns: 1 });
  });
});
