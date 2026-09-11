import { describe, expect, it } from 'vitest';
import {
  type EggSnapshot,
  type EggTypeSnapshot,
  careDateFor,
  daysBetween,
  evaluateEggCare,
  evaluateHatch,
  rollSpeciesFromPool,
} from '@/core/eggs';
import type { EggsConfig } from '@/core/schemas/config';

const config: EggsConfig = {
  dayBoundaryUtcOffsetMinutes: 0,
  maxActiveEggsPerPlayer: 5,
  spoiledRefundPercent: 0,
};

const eggType: EggTypeSnapshot = { careDaysRequired: 3, maxMissedDays: 1 };

const egg = (over: Partial<EggSnapshot> = {}): EggSnapshot => ({
  status: 'incubating',
  careDaysCompleted: 0,
  currentStreak: 0,
  lastCareDate: null,
  ...over,
});

describe('careDateFor', () => {
  it('uses the UTC calendar day', () => {
    expect(careDateFor(new Date('2026-06-15T00:00:00.000Z'), config)).toBe('2026-06-15');
    expect(careDateFor(new Date('2026-06-15T23:59:59.999Z'), config)).toBe('2026-06-15');
    expect(careDateFor(new Date('2026-06-16T00:00:00.000Z'), config)).toBe('2026-06-16');
  });

  it('shifts the boundary so late-night play still counts as the previous day', () => {
    const fiveAm: EggsConfig = { ...config, dayBoundaryUtcOffsetMinutes: 300 };
    expect(careDateFor(new Date('2026-06-16T04:59:00.000Z'), fiveAm)).toBe('2026-06-15');
    expect(careDateFor(new Date('2026-06-16T05:00:00.000Z'), fiveAm)).toBe('2026-06-16');
  });

  it('counts whole days between care keys, across a month boundary', () => {
    expect(daysBetween('2026-06-15', '2026-06-16')).toBe(1);
    expect(daysBetween('2026-06-30', '2026-07-02')).toBe(2);
    expect(daysBetween('2026-06-15', '2026-06-15')).toBe(0);
  });
});

describe('evaluateEggCare', () => {
  it('accepts the first care of a fresh egg', () => {
    const outcome = evaluateEggCare(egg(), eggType, new Date('2026-06-15T10:00:00Z'), config);
    expect(outcome).toEqual({
      ok: true,
      careDate: '2026-06-15',
      missedDays: 0,
      currentStreak: 1,
      careDaysCompleted: 1,
      readyToHatch: false,
    });
  });

  it('refuses a second care on the same day', () => {
    const outcome = evaluateEggCare(
      egg({ lastCareDate: '2026-06-15', careDaysCompleted: 1, currentStreak: 1 }),
      eggType,
      new Date('2026-06-15T23:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('already_cared_today');
  });

  it('extends the streak on consecutive days', () => {
    const outcome = evaluateEggCare(
      egg({ lastCareDate: '2026-06-15', careDaysCompleted: 1, currentStreak: 1 }),
      eggType,
      new Date('2026-06-16T08:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.missedDays).toBe(0);
    expect(outcome.currentStreak).toBe(2);
  });

  it('tolerates a missed day but restarts the streak', () => {
    const outcome = evaluateEggCare(
      egg({ lastCareDate: '2026-06-15', careDaysCompleted: 2, currentStreak: 2 }),
      eggType,
      new Date('2026-06-17T08:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.missedDays).toBe(1);
    expect(outcome.currentStreak).toBe(1);
    expect(outcome.careDaysCompleted).toBe(3);
    expect(outcome.readyToHatch).toBe(true);
  });

  it('spoils the egg once the tolerance is exceeded', () => {
    const outcome = evaluateEggCare(
      egg({ lastCareDate: '2026-06-15', careDaysCompleted: 2, currentStreak: 2 }),
      eggType,
      new Date('2026-06-18T08:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('spoiled');
    expect(outcome.missedDays).toBe(2);
    expect(outcome.shouldMarkSpoiled).toBe(true);
  });

  it('does not re-spoil an egg already marked spoiled', () => {
    const outcome = evaluateEggCare(
      egg({ status: 'spoiled' }),
      eggType,
      new Date('2026-06-18T08:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.shouldMarkSpoiled).toBe(false);
  });

  it('refuses care on a hatched egg', () => {
    const outcome = evaluateEggCare(
      egg({ status: 'hatched' }),
      eggType,
      new Date('2026-06-18T08:00:00Z'),
      config,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('already_hatched');
  });
});

describe('evaluateHatch', () => {
  it('refuses before enough care days and says how many are missing', () => {
    expect(evaluateHatch(egg({ careDaysCompleted: 1 }), eggType)).toEqual({
      ok: false,
      reason: 'not_enough_care_days',
      missing: 2,
    });
  });

  it('allows hatching at exactly the required care days', () => {
    expect(evaluateHatch(egg({ careDaysCompleted: 3 }), eggType)).toEqual({ ok: true });
  });

  it('refuses a spoiled egg', () => {
    const verdict = evaluateHatch(egg({ status: 'spoiled', careDaysCompleted: 9 }), eggType);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('spoiled');
  });
});

describe('rollSpeciesFromPool', () => {
  const pool = [
    { speciesId: 'common', weight: 7 },
    { speciesId: 'rare', weight: 2 },
    { speciesId: 'legendary', weight: 1 },
  ];

  it('picks by weight, deterministically for a given roll', () => {
    expect(rollSpeciesFromPool(pool, () => 0)).toBe('common');
    expect(rollSpeciesFromPool(pool, () => 0.69)).toBe('common');
    expect(rollSpeciesFromPool(pool, () => 0.7)).toBe('rare');
    expect(rollSpeciesFromPool(pool, () => 0.89)).toBe('rare');
    expect(rollSpeciesFromPool(pool, () => 0.9)).toBe('legendary');
    expect(rollSpeciesFromPool(pool, () => 0.999999)).toBe('legendary');
  });

  it('never falls off the end when random() returns exactly 1', () => {
    expect(rollSpeciesFromPool(pool, () => 1)).toBe('legendary');
  });

  it('respects the declared distribution over many draws', () => {
    // A deterministic sweep, not a random sample: no flaky test.
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      const id = rollSpeciesFromPool(pool, () => i / 1000);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('common')).toBe(700);
    expect(counts.get('rare')).toBe(200);
    expect(counts.get('legendary')).toBe(100);
  });

  it('rejects an empty pool instead of returning something arbitrary', () => {
    expect(() => rollSpeciesFromPool([], () => 0.5)).toThrow(/empty egg pool/);
  });

  it('rejects a malformed weight', () => {
    expect(() => rollSpeciesFromPool([{ speciesId: 'x', weight: 0 }], () => 0)).toThrow(
      /Invalid pool weight/,
    );
  });
});
