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

export type EggTypeSnapshot = {
  careDaysRequired: number;
  /** Coins the incubator burns per day while this egg is in it. */
  electricityCost: number;
};

/** One care-day forward from a care-date key. */
export function shiftCareDate(careDate: string, days: number): string {
  const at = Date.parse(`${careDate}T00:00:00.000Z`) + days * MS_PER_DAY;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * LA INCUBADORA SE PAGA, NO SE VISITA.
 *
 * An egg advances because its incubator had power that day, and power is bought
 * with coins — the electricity bill. Paying inserts ONE ROW PER DAY into
 * `egg_care_log`, including days that have not arrived yet, and the unique
 * index on (egg, date) is what stops a day being paid twice.
 *
 * Two consequences fall out of that, and both are the point:
 *
 * - **Being away costs nothing.** A day paid in advance arrives whether anybody
 *   opened the game or not, so the egg keeps moving. Nothing here reads a
 *   streak, and no egg spoils: the stamina model already refuses to punish
 *   absence, and an egg bought with coins earned by playing should not be the
 *   one place that does.
 * - **The battery is the product.** How far ahead you may pay is the
 *   incubator's capacity: one day for the free one — so a three-day egg wants
 *   three visits — and three or seven for the ones you buy. What is sold is
 *   AUTONOMY, never forgiveness.
 */

/** Care-days the egg has actually lived: paid days that have already arrived. */
export function poweredDays(paidDates: readonly string[], today: string): number {
  return paidDates.filter((date) => daysBetween(date, today) >= 0).length;
}

export type PayableParams = {
  /** Every day already paid for this egg, arrived or not. */
  paidDates: readonly string[];
  today: string;
  /** How many days ahead this incubator can hold. The free one holds 1. */
  capacityDays: number;
  careDaysRequired: number;
};

/**
 * The days that can still be bought, in order, soonest first.
 *
 * Never a day in the past — that one is gone and paying for it would be
 * back-filling. Never beyond the battery. Never more than the egg still needs,
 * so nobody can prepay a fourth day of a three-day egg.
 */
export function payableDates(params: PayableParams): string[] {
  const paid = new Set(params.paidDates);
  const remaining = params.careDaysRequired - paid.size;
  if (remaining <= 0) return [];

  const dates: string[] = [];
  for (let ahead = 0; ahead < params.capacityDays && dates.length < remaining; ahead += 1) {
    const date = shiftCareDate(params.today, ahead);
    if (!paid.has(date)) dates.push(date);
  }
  return dates;
}

export type PowerPlan =
  | { ok: true; dates: string[]; cost: number }
  | {
      ok: false;
      reason: 'already_done' | 'battery_full' | 'not_enough_coins';
      /** What it would have cost, so the UI can say how short the player is. */
      cost: number;
    };

/**
 * What paying for `wantedDays` right now would mean. Pure: the caller spends
 * the coins and writes the rows in one transaction.
 *
 * `battery_full` is not an error state — it means every day this incubator can
 * hold is already paid, and the player simply has to wait for them to arrive.
 */
export function planPower(
  params: PayableParams & { wantedDays: number; coins: number; costPerDay: number },
): PowerPlan {
  const payable = payableDates(params);
  if (params.careDaysRequired - params.paidDates.length <= 0) {
    return { ok: false, reason: 'already_done', cost: 0 };
  }
  if (payable.length === 0) return { ok: false, reason: 'battery_full', cost: 0 };

  const dates = payable.slice(0, Math.max(1, Math.min(params.wantedDays, payable.length)));
  const cost = dates.length * params.costPerDay;
  if (cost > params.coins) return { ok: false, reason: 'not_enough_coins', cost };

  return { ok: true, dates, cost };
}

export type HatchVerdict =
  | { ok: true }
  | { ok: false; reason: 'already_hatched' | 'not_enough_care_days'; missing: number };

/**
 * Ready when enough PAID days have arrived. It takes the count rather than
 * reading a column, because the count is derived from the care log and a stored
 * number is one more thing that can disagree with it.
 */
export function evaluateHatch(
  params: { status: EggStatus; poweredDays: number },
  eggType: EggTypeSnapshot,
): HatchVerdict {
  if (params.status === 'hatched') return { ok: false, reason: 'already_hatched', missing: 0 };
  const missing = eggType.careDaysRequired - params.poweredDays;
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
