import type { EggsConfig } from '../schemas/config';
import type { EggStatus } from '../schemas/eggs';

/**
 * EGGS — bought, cared for daily, hatched.
 *
 * Two things must never come from the client and never happen twice:
 *
 * 1. WHICH SPECIES. Rolled once, server-side, at purchase, with an injected RNG
 *    so tests are deterministic and production uses a real source. There is no
 *    function here that takes a species id as a wish.
 * 2. WHICH DAY. Derived from the server clock via `careDateFor`. The unique
 *    index on (egg_id, care_date) is the real guard; this function is what
 *    computes the key it guards.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * The care day as a YYYY-MM-DD key, in UTC, shifted by the configured boundary.
 *
 * With offset 0 a care day runs 00:00-24:00 UTC. With offset 300 (05:00 UTC) an
 * action at 04:00 UTC still belongs to the previous day — useful so late-night
 * players are not punished by a boundary in the middle of their evening.
 */
export function careDateFor(now: Date, config: EggsConfig): string {
  const shifted = new Date(now.getTime() - config.dayBoundaryUtcOffsetMinutes * MS_PER_MINUTE);
  const iso = shifted.toISOString();
  return iso.slice(0, 10);
}

/** Whole days between two care-day keys. Both are UTC midnights, so this is exact. */
export function daysBetween(fromCareDate: string, toCareDate: string): number {
  const from = Date.parse(`${fromCareDate}T00:00:00.000Z`);
  const to = Date.parse(`${toCareDate}T00:00:00.000Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

export type EggSnapshot = {
  status: EggStatus;
  careDaysCompleted: number;
  currentStreak: number;
  /** The care-day key of the last successful care, or null if never cared for. */
  lastCareDate: string | null;
};

export type EggTypeSnapshot = {
  careDaysRequired: number;
  maxMissedDays: number;
};

export type EggCareOutcome =
  | {
      ok: true;
      careDate: string;
      missedDays: number;
      /** Broken by a gap longer than one day, so the streak restarts at 1. */
      currentStreak: number;
      careDaysCompleted: number;
      readyToHatch: boolean;
    }
  | {
      ok: false;
      reason: 'already_cared_today' | 'already_hatched' | 'spoiled' | 'not_incubating';
      careDate: string;
      missedDays: number;
      /** True when this call is what discovers the egg has spoiled. */
      shouldMarkSpoiled: boolean;
    };

/**
 * Decides what caring for an egg right now means. Pure: the caller writes the
 * care-log row and updates the egg inside one transaction.
 */
export function evaluateEggCare(
  egg: EggSnapshot,
  eggType: EggTypeSnapshot,
  now: Date,
  config: EggsConfig,
): EggCareOutcome {
  const careDate = careDateFor(now, config);

  if (egg.status === 'hatched') {
    return { ok: false, reason: 'already_hatched', careDate, missedDays: 0, shouldMarkSpoiled: false };
  }
  if (egg.status === 'spoiled') {
    return { ok: false, reason: 'spoiled', careDate, missedDays: 0, shouldMarkSpoiled: false };
  }

  if (egg.lastCareDate === careDate) {
    return {
      ok: false,
      reason: 'already_cared_today',
      careDate,
      missedDays: 0,
      shouldMarkSpoiled: false,
    };
  }

  /**
   * Days skipped since the last care. Caring on consecutive days gives a gap of
   * 1, so missed = gap - 1. A brand-new egg has missed nothing.
   */
  const missedDays =
    egg.lastCareDate === null ? 0 : Math.max(0, daysBetween(egg.lastCareDate, careDate) - 1);

  if (missedDays > eggType.maxMissedDays) {
    return { ok: false, reason: 'spoiled', careDate, missedDays, shouldMarkSpoiled: true };
  }

  const careDaysCompleted = egg.careDaysCompleted + 1;
  return {
    ok: true,
    careDate,
    missedDays,
    currentStreak: missedDays === 0 ? egg.currentStreak + 1 : 1,
    careDaysCompleted,
    readyToHatch: careDaysCompleted >= eggType.careDaysRequired,
  };
}

export type HatchVerdict =
  | { ok: true }
  | { ok: false; reason: 'already_hatched' | 'spoiled' | 'not_enough_care_days'; missing: number };

export function evaluateHatch(egg: EggSnapshot, eggType: EggTypeSnapshot): HatchVerdict {
  if (egg.status === 'hatched') return { ok: false, reason: 'already_hatched', missing: 0 };
  if (egg.status === 'spoiled') return { ok: false, reason: 'spoiled', missing: 0 };
  const missing = eggType.careDaysRequired - egg.careDaysCompleted;
  if (missing > 0) return { ok: false, reason: 'not_enough_care_days', missing };
  return { ok: true };
}

export type PoolEntry = { speciesId: string; weight: number };

/**
 * Weighted draw for the species an egg will produce.
 *
 * `random` is injected — production passes a real source, tests pass a fixed
 * sequence. The draw happens ONCE, at purchase, and the result is stored
 * immediately, so there is nothing left to re-roll.
 */
export function rollSpeciesFromPool(pool: readonly PoolEntry[], random: () => number): string {
  if (pool.length === 0) throw new Error('Cannot roll from an empty egg pool');

  let total = 0;
  for (const entry of pool) {
    if (!Number.isInteger(entry.weight) || entry.weight < 1) {
      throw new Error(`Invalid pool weight for species ${entry.speciesId}: ${entry.weight}`);
    }
    total += entry.weight;
  }

  const roll = random() * total;
  let cumulative = 0;
  for (const entry of pool) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.speciesId;
  }

  /** Only reachable if random() returns exactly 1; fall back to the last entry. */
  const last = pool[pool.length - 1];
  if (last === undefined) throw new Error('Cannot roll from an empty egg pool');
  return last.speciesId;
}
