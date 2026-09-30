/**
 * SEASONAL BALANCE — pure, like everything else in /core.
 *
 * A season adjusts creatures with DELTAS on top of their species numbers. The
 * species row is never rewritten, so ending a season restores everyone without
 * a migration, and the reason for every change stays on its own row.
 */

export type Adjustment = {
  readonly attackDelta: number;
  readonly manaCostDelta: number;
};

export const NO_ADJUSTMENT: Adjustment = { attackDelta: 0, manaCostDelta: 0 };

export type TunedStats = {
  readonly attack: number;
  readonly manaCost: number;
};

/**
 * Applies one season's adjustment to a species' printed numbers.
 *
 * Both results are clamped at 1: a nerf may make a creature weak, never
 * harmless — an attack of zero deals nothing for ever, and a mana cost of zero
 * would fire a special on every single match. A balance pass must not be able
 * to break the rules of the game by accident.
 */
export function applyAdjustment(base: TunedStats, adjustment: Adjustment = NO_ADJUSTMENT): TunedStats {
  return {
    attack: Math.max(1, base.attack + adjustment.attackDelta),
    manaCost: Math.max(1, base.manaCost + adjustment.manaCostDelta),
  };
}

/**
 * What a season is ALLOWED to do to this creature.
 *
 * An EXCELLENT creature is immune to nerfs: it keeps every improvement a season
 * hands out and ignores every penalty. That is a large part of what makes the
 * rare mark worth chasing — it survives the balance pass that flattens everyone
 * else.
 *
 * A nerf is not "a negative number": it is "worse", and worse points in a
 * different direction per stat. LESS attack is a nerf; MORE mana cost is a nerf
 * too, because it takes longer to fire. Filtering by sign alone would protect
 * excellent creatures from cheaper bars — a buff — and let expensive ones
 * through.
 */
export function effectiveAdjustment(
  adjustment: Adjustment,
  options: { excellent: boolean },
): Adjustment {
  if (!options.excellent) return adjustment;
  return {
    attackDelta: Math.max(0, adjustment.attackDelta),
    manaCostDelta: Math.min(0, adjustment.manaCostDelta),
  };
}

/** True when this adjustment would change nothing — worth not writing a row for. */
export function isNeutral(adjustment: Adjustment): boolean {
  return adjustment.attackDelta === 0 && adjustment.manaCostDelta === 0;
}
