import { describe, expect, it } from 'vitest';
import {
  careDateFor,
  daysBetween,
  evaluateHatch,
  payableDates,
  planPower,
  poweredDays,
  rollSpeciesFromPool,
  shiftCareDate,
} from '@/core/eggs';
import type { EggsConfig } from '@/core/schemas/config';

const config: EggsConfig = {
  dayBoundaryUtcOffsetMinutes: 0,
  maxActiveEggsPerPlayer: 5,
  spoiledRefundPercent: 0,
  incubatorsForSale: [{ capacityDays: 3, priceCoins: 400 }],
};

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

/**
 * LA INCUBADORA SE PAGA, NO SE VISITA.
 *
 * Paying inserts one row per day, future days included, and the unique index on
 * (egg, date) is what stops a day being paid twice. These tests pin the two
 * promises that model makes: being away costs nothing, and the battery is the
 * only thing that limits how far ahead you can buy.
 */
describe('poweredDays', () => {
  it('counts only the days that have arrived', () => {
    /** Paid for three, two of them already past: the egg has lived two. */
    expect(poweredDays(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-02')).toBe(2);
  });

  it('counts a day the moment it arrives, not the day after', () => {
    expect(poweredDays(['2026-03-05'], '2026-03-05')).toBe(1);
  });

  it('ADVANCES WHILE NOBODY LOOKS: days paid in advance arrive on their own', () => {
    const paid = ['2026-03-01', '2026-03-02', '2026-03-03'];
    /** Paid on the first and not opened again until the fourth. */
    expect(poweredDays(paid, '2026-03-04')).toBe(3);
  });

  it('is zero for an egg nobody has powered', () => {
    expect(poweredDays([], '2026-03-01')).toBe(0);
  });
});

describe('payableDates', () => {
  const base = { today: '2026-03-10', careDaysRequired: 3 };

  it('offers only TODAY with the free one-day battery', () => {
    expect(payableDates({ ...base, paidDates: [], capacityDays: 1 })).toEqual(['2026-03-10']);
  });

  it('offers the whole egg at once with a three-day battery', () => {
    expect(payableDates({ ...base, paidDates: [], capacityDays: 3 })).toEqual([
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
    ]);
  });

  it('never offers a day already paid', () => {
    expect(
      payableDates({ ...base, paidDates: ['2026-03-10'], capacityDays: 3 }),
    ).toEqual(['2026-03-11', '2026-03-12']);
  });

  it('never offers more days than the egg still needs', () => {
    /** A seven-day battery on a three-day egg still stops at three. */
    expect(payableDates({ ...base, paidDates: [], capacityDays: 7 })).toHaveLength(3);
  });

  it('never offers a day in the past: that one is gone', () => {
    const dates = payableDates({ ...base, paidDates: [], capacityDays: 3 });
    expect(dates.every((date) => date >= base.today)).toBe(true);
  });

  it('offers nothing once every day is paid for', () => {
    expect(
      payableDates({
        ...base,
        paidDates: ['2026-03-10', '2026-03-11', '2026-03-12'],
        capacityDays: 3,
      }),
    ).toEqual([]);
  });
});

describe('planPower', () => {
  const base = {
    today: '2026-03-10',
    careDaysRequired: 3,
    paidDates: [] as string[],
    capacityDays: 3,
    costPerDay: 25,
    coins: 500,
  };

  it('charges per day, so three days cost three times one', () => {
    const one = planPower({ ...base, wantedDays: 1 });
    const three = planPower({ ...base, wantedDays: 3 });
    expect(one.ok && one.cost).toBe(25);
    expect(three.ok && three.cost).toBe(75);
    expect(three.ok && three.dates).toHaveLength(3);
  });

  it('never sells more than the battery holds', () => {
    const plan = planPower({ ...base, capacityDays: 1, wantedDays: 3 });
    expect(plan.ok && plan.dates).toEqual(['2026-03-10']);
    expect(plan.ok && plan.cost).toBe(25);
  });

  it('refuses when the coins are short, and says what it would have cost', () => {
    const plan = planPower({ ...base, wantedDays: 3, coins: 40 });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toBe('not_enough_coins');
    expect(plan.cost).toBe(75);
  });

  it('says the battery is full rather than charging for nothing', () => {
    const plan = planPower({
      ...base,
      paidDates: ['2026-03-10', '2026-03-11'],
      capacityDays: 2,
      wantedDays: 1,
    });
    expect(!plan.ok && plan.reason).toBe('battery_full');
    expect(plan.cost).toBe(0);
  });

  it('says the egg is done when every day it needs is paid', () => {
    const plan = planPower({
      ...base,
      paidDates: ['2026-03-10', '2026-03-11', '2026-03-12'],
      wantedDays: 1,
    });
    expect(!plan.ok && plan.reason).toBe('already_done');
  });

  it('always sells at least one day when one is available', () => {
    const plan = planPower({ ...base, wantedDays: 0 });
    expect(plan.ok && plan.dates).toHaveLength(1);
  });
});

describe('evaluateHatch', () => {
  const eggType = { careDaysRequired: 3, electricityCost: 25 };

  it('refuses before enough powered days and says how many are missing', () => {
    const verdict = evaluateHatch({ status: 'incubating', poweredDays: 1 }, eggType);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.missing).toBe(2);
  });

  it('allows hatching at exactly the required days', () => {
    expect(evaluateHatch({ status: 'incubating', poweredDays: 3 }, eggType).ok).toBe(true);
  });

  it('refuses an egg that already hatched', () => {
    const verdict = evaluateHatch({ status: 'hatched', poweredDays: 9 }, eggType);
    expect(!verdict.ok && verdict.reason).toBe('already_hatched');
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
