import type { PlayConfig, StaminaConfig } from '../schemas/config';

/**
 * STAMINA — derived, never stored.
 *
 * The only persisted state is `lastFed`, a timestamp that acts as the
 * REGENERATION ANCHOR:
 *
 *   stamina(now) = clamp(floor((now - lastFed) / regenSeconds), 0, maxStamina)
 *
 * Everything below is a pure function of (anchor, now, config). `now` is always
 * passed in by the caller, which server-side is the server clock. Nothing here
 * reads Date.now(), so a client can never influence the result and every clock
 * edge case is testable.
 *
 * Playing pushes the anchor FORWARD. Feeding pulls it BACKWARD. Absence only
 * moves `now` forward, so it can only ever raise stamina — never decay it.
 */

const MS = 1000;

export type StaminaSnapshot = {
  current: number;
  max: number;
  isFull: boolean;
  /** Seconds until the next point regenerates, or null when already full. */
  secondsUntilNextPoint: number | null;
  secondsUntilFull: number;
};

function msPerPoint(config: StaminaConfig): number {
  return config.regenSeconds * MS;
}

/**
 * The earliest anchor that still derives to full stamina. Anchors older than
 * this carry no extra credit: stamina caps, it does not bank.
 */
function fullAnchorMs(now: Date, config: StaminaConfig): number {
  return now.getTime() - config.maxStamina * msPerPoint(config);
}

/**
 * Clamps an anchor into the meaningful range before arithmetic.
 *
 * Without this, spending from a long-idle creature would do nothing visible:
 * its anchor is far in the past, so pushing it forward would still derive to
 * max. Normalising first makes "spend 5" always cost exactly 5.
 */
export function normalizeAnchor(lastFed: Date, now: Date, config: StaminaConfig): Date {
  return new Date(Math.max(lastFed.getTime(), fullAnchorMs(now, config)));
}

/**
 * The anchor for a BRAND-NEW creature, so it starts FULL instead of empty.
 *
 * The column default is plain now(), which derives to zero stamina — fine as a
 * database floor, wrong as a welcome. Creation code (hatching an egg, seeding)
 * must set the anchor with this helper; the default is only a fallback.
 */
export function initialAnchor(now: Date, config: StaminaConfig): Date {
  return new Date(fullAnchorMs(now, config));
}

export function deriveStamina(
  lastFed: Date,
  now: Date,
  config: StaminaConfig,
  /**
   * How high the bar may go — the whole thing unless something is capping it.
   * A sick creature keeps regenerating but stops early, which is what makes
   * illness "weak" rather than "frozen": feeding still does something, it just
   * cannot do much.
   */
  ceiling: number = config.maxStamina,
): StaminaSnapshot {
  const perPoint = msPerPoint(config);
  const elapsedMs = now.getTime() - lastFed.getTime();

  /**
   * A negative elapsed time means the anchor sits in the future — which is the
   * normal state right after playing. Math.floor takes it further negative, and
   * the clamp brings it to 0. Stamina is never negative.
   */
  const top = Math.min(Math.max(1, ceiling), config.maxStamina);
  const raw = Math.floor(elapsedMs / perPoint);
  const current = Math.min(Math.max(raw, 0), top);
  /** "Full" means "as high as it can get", which for a sick one is its ceiling. */
  const isFull = current >= top;

  const nextPointAtMs = lastFed.getTime() + (Math.max(raw, 0) + 1) * perPoint;
  const fullAtMs = lastFed.getTime() + top * perPoint;

  return {
    current,
    max: top,
    isFull,
    secondsUntilNextPoint: isFull ? null : Math.ceil((nextPointAtMs - now.getTime()) / MS),
    secondsUntilFull: isFull ? 0 : Math.ceil((fullAtMs - now.getTime()) / MS),
  };
}

export type SpendStaminaResult =
  | { ok: true; lastFed: Date; staminaBefore: number; staminaAfter: number }
  | {
      ok: false;
      reason: 'insufficient_stamina' | 'below_minimum';
      staminaBefore: number;
      required: number;
    };

/**
 * Spends stamina by pushing the anchor forward. The sub-point remainder is
 * preserved, so a player never loses partial regeneration by playing.
 */
export function spendStamina(
  lastFed: Date,
  now: Date,
  cost: number,
  config: StaminaConfig,
): SpendStaminaResult {
  const before = deriveStamina(lastFed, now, config).current;
  if (before < cost) {
    return { ok: false, reason: 'insufficient_stamina', staminaBefore: before, required: cost };
  }
  const anchor = normalizeAnchor(lastFed, now, config).getTime();
  return {
    ok: true,
    lastFed: new Date(anchor + cost * msPerPoint(config)),
    staminaBefore: before,
    staminaAfter: before - cost,
  };
}

/**
 * Whether this creature may start a match. Both gates come from config rows:
 * a minimum level to play at all, and the cost of one match.
 */
export function canPlay(
  lastFed: Date,
  now: Date,
  staminaConfig: StaminaConfig,
  playConfig: PlayConfig,
): SpendStaminaResult {
  const before = deriveStamina(lastFed, now, staminaConfig).current;
  if (before < playConfig.minStaminaToPlay) {
    return {
      ok: false,
      reason: 'below_minimum',
      staminaBefore: before,
      required: playConfig.minStaminaToPlay,
    };
  }
  return spendStamina(lastFed, now, playConfig.staminaCostPerMatch, staminaConfig);
}

export type FeedResult =
  | {
      ok: true;
      lastFed: Date;
      staminaBefore: number;
      staminaAfter: number;
      /** Food actually consumed. Never more than needed to fill. */
      unitsConsumed: number;
    }
  | { ok: false; reason: 'already_full'; staminaBefore: number };

/**
 * Feeding pulls the anchor backward, clamped so the derived value can never
 * exceed max. Only the food actually needed is consumed — overfeeding a nearly
 * full creature does not silently burn the rest of the stack.
 */
export function feed(
  lastFed: Date,
  now: Date,
  units: number,
  config: StaminaConfig,
  /** A sick creature cannot be fed past its ceiling — food is not a cure. */
  ceiling: number = config.maxStamina,
): FeedResult {
  const top = Math.min(Math.max(1, ceiling), config.maxStamina);
  const before = deriveStamina(lastFed, now, config, top).current;
  if (before >= top) {
    return { ok: false, reason: 'already_full', staminaBefore: before };
  }

  const missing = top - before;
  const unitsNeeded = Math.ceil(missing / config.staminaPerFood);
  const unitsConsumed = Math.min(units, unitsNeeded);
  const restored = unitsConsumed * config.staminaPerFood;

  const anchor = normalizeAnchor(lastFed, now, config).getTime();
  const pulled = anchor - restored * msPerPoint(config);
  /**
   * The anchor is clamped to the CEILING, not to the full bar. Pulling it
   * further back would park a sick creature's anchor so early that the moment
   * it is cured it would already be at maximum — food would have bought a cure
   * through the back door.
   */
  const clamped = Math.max(pulled, now.getTime() - top * msPerPoint(config));

  return {
    ok: true,
    lastFed: new Date(clamped),
    staminaBefore: before,
    staminaAfter: Math.min(before + restored, top),
    unitsConsumed,
  };
}
