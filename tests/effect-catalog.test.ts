import { describe, expect, it } from 'vitest';
import {
  CONDITION_FIELDS,
  EFFECT_CATALOG,
  EFFECT_TYPES,
  blankEffect,
  effectListSchema,
  effectSchema,
} from '@/core';
import { createSpeciesSchema } from '@/core/schemas/species';

/**
 * The catalogue is what the admin form draws from, so it has to agree with the
 * schema the server validates against. Nothing enforces that at compile time —
 * one is a table of numbers, the other a union — so it is enforced here.
 */
describe('the power catalogue agrees with the schema', () => {
  it('offers a row for every effect type, and no stranger', () => {
    expect(Object.keys(EFFECT_CATALOG).sort()).toEqual([...EFFECT_TYPES].sort());
  });

  it('builds a VALID blank for every single power', () => {
    for (const type of EFFECT_TYPES) {
      const parsed = effectSchema.safeParse(blankEffect(type));
      expect(parsed.success, `${type}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('never offers a number the schema would refuse, at either end', () => {
    for (const type of EFFECT_TYPES) {
      for (const field of EFFECT_CATALOG[type].numbers) {
        for (const edge of [field.min, field.max, field.initial]) {
          const parsed = effectSchema.safeParse({ ...blankEffect(type), [field.key]: edge });
          expect(parsed.success, `${type}.${field.key} = ${edge}`).toBe(true);
        }
        /** And the bound is a real bound: one past it is refused. */
        const tooHigh = effectSchema.safeParse({
          ...blankEffect(type),
          [field.key]: field.max + 1,
        });
        expect(tooHigh.success, `${type}.${field.key} = ${field.max + 1}`).toBe(false);
      }
    }
  });

  it('accepts every condition the editor can add, on a power that takes one', () => {
    for (const field of CONDITION_FIELDS) {
      const condition =
        field.kind === 'element'
          ? { [field.key]: 'water' }
          : field.kind === 'boolean'
            ? { [field.key]: true }
            : { [field.key]: field.initial };

      const parsed = effectSchema.safeParse({ ...blankEffect('heal'), condition });
      expect(parsed.success, `${field.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('refuses the empty condition the editor is careful never to send', () => {
    expect(effectSchema.safeParse({ ...blankEffect('heal'), condition: {} }).success).toBe(false);
  });

  it('takes a full list of eight, and refuses a ninth', () => {
    const eight = EFFECT_TYPES.slice(0, 8).map((type) => blankEffect(type));
    expect(effectListSchema.safeParse(eight).success).toBe(true);
    expect(effectListSchema.safeParse([...eight, blankEffect('heal')]).success).toBe(false);
  });
});

/**
 * What the admin form actually does: the editor stringifies its rows into one
 * hidden field and the action parses that string back. This is that trip, with
 * nothing mocked in between — a JSON shape the schema rejects would otherwise
 * only show up as a red notice in a browser nobody is watching.
 */
describe('the editor payload survives the round trip', () => {
  it('parses as a species, powers and conditions included', () => {
    const drafted = [
      { ...blankEffect('damage'), value: 26 },
      { ...blankEffect('poison'), value: 4, duration_turns: 3, condition: { turn_at_least: 3 } },
      { ...blankEffect('heal'), condition: { self_below_percent: 35 } },
      { ...blankEffect('drain_mana'), to_self: true, targets: 2 },
    ];

    const parsed = createSpeciesSchema.safeParse({
      name: 'Prueba',
      slug: 'prueba',
      baseElement: 'fire',
      baseHp: 30,
      baseAttack: 10,
      baseDefense: 5,
      manaCost: 12,
      description: null,
      isPublished: false,
      /** Exactly what the hidden input carries and the action reads back. */
      effects: JSON.parse(JSON.stringify(drafted)) as unknown,
    });

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.effects).toHaveLength(4);
    expect(parsed.data?.effects[1]).toMatchObject({ type: 'poison', duration_turns: 3 });
  });

  it('refuses a hand-written payload that the editor could never produce', () => {
    expect(
      effectListSchema.safeParse([{ type: 'damage', target: 'enemy', value: 999999 }]).success,
    ).toBe(false);
    expect(
      effectListSchema.safeParse([{ type: 'no_such_power', target: 'enemy', value: 5 }]).success,
    ).toBe(false);
  });
});
