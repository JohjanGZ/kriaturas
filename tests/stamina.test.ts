import { describe, expect, it } from 'vitest';
import type { PlayConfig, StaminaConfig } from '@/core/schemas/config';
import {
  canPlay,
  deriveStamina,
  feed,
  initialAnchor,
  spendStamina,
} from '@/core/stamina';

/**
 * Every test passes `now` explicitly. Nothing in /core reads the clock, so these
 * are exact, not approximate — no fake timers, no tolerance windows.
 */

const config: StaminaConfig = { maxStamina: 20, regenSeconds: 300, staminaPerFood: 5 };
const play: PlayConfig = {
  minStaminaToPlay: 5,
  staminaCostPerMatch: 5,
  teamSize: 2,
  defaultManaCost: 12,
  drakofrutaPerWin: 1,
  coinsPerWin: 50,
};

const MINUTE = 60_000;
const POINT = config.regenSeconds * 1000; // 5 minutes per stamina point

const at = (iso: string) => new Date(iso);
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);

const NOW = at('2026-06-15T12:00:00.000Z');

describe('deriveStamina', () => {
  it('is empty for a creature whose anchor is this instant (the raw column default)', () => {
    // The DB default now() derives to zero. This is why creation must use initialAnchor.
    expect(deriveStamina(NOW, NOW, config).current).toBe(0);
  });

  it('starts full when created through initialAnchor', () => {
    const snapshot = deriveStamina(initialAnchor(NOW, config), NOW, config);
    expect(snapshot.current).toBe(20);
    expect(snapshot.isFull).toBe(true);
    expect(snapshot.secondsUntilNextPoint).toBeNull();
    expect(snapshot.secondsUntilFull).toBe(0);
  });

  it('is full for a creature never fed since long ago — absence never decays stamina', () => {
    const neverFed = plus(NOW, -30 * 24 * 60 * MINUTE); // 30 days
    expect(deriveStamina(neverFed, NOW, config).current).toBe(20);
  });

  it('caps at max and does not bank credit for extra idle time', () => {
    const oneYear = plus(NOW, -365 * 24 * 60 * MINUTE);
    const oneDay = plus(NOW, -24 * 60 * MINUTE);
    expect(deriveStamina(oneYear, NOW, config).current).toBe(20);
    expect(deriveStamina(oneDay, NOW, config).current).toBe(20);
  });

  it('lands exactly on the threshold, and one millisecond short does not count', () => {
    expect(deriveStamina(plus(NOW, -3 * POINT), NOW, config).current).toBe(3);
    expect(deriveStamina(plus(NOW, -3 * POINT + 1), NOW, config).current).toBe(2);
    expect(deriveStamina(plus(NOW, -POINT + 1), NOW, config).current).toBe(0);
  });

  it('never goes negative when the anchor sits in the future', () => {
    // The normal state right after playing, and also what a skewed clock looks like.
    const future = plus(NOW, 3 * POINT);
    const snapshot = deriveStamina(future, NOW, config);
    expect(snapshot.current).toBe(0);
    expect(snapshot.secondsUntilNextPoint).toBe((3 * POINT + POINT) / 1000);
  });

  it('reports the wait to the next point and to full', () => {
    const snapshot = deriveStamina(plus(NOW, -(2 * POINT + 60_000)), NOW, config);
    expect(snapshot.current).toBe(2);
    expect(snapshot.secondsUntilNextPoint).toBe(240); // 4 minutes into the 5-minute step
    expect(snapshot.secondsUntilFull).toBe(18 * 300 - 60);
  });

  it('measures absolute time, so a DST jump changes nothing', () => {
    // Europe/Madrid springs forward at 01:00 UTC on 2026-03-29. One real hour
    // of elapsed time is 12 points regardless of what the wall clock did.
    const before = at('2026-03-29T00:30:00.000Z');
    const after = at('2026-03-29T01:30:00.000Z');
    expect(deriveStamina(before, after, config).current).toBe(12);
  });
});

describe('spendStamina', () => {
  it('refuses when there is not enough', () => {
    const result = spendStamina(plus(NOW, -2 * POINT), NOW, 5, config);
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient_stamina',
      staminaBefore: 2,
      required: 5,
    });
  });

  it('spends exactly the cost from a full creature', () => {
    const anchor = initialAnchor(NOW, config);
    const result = spendStamina(anchor, NOW, 5, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.staminaAfter).toBe(15);
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(15);
  });

  it('spends exactly the cost from a long-idle creature, without swallowing the charge', () => {
    // Regression guard: without normalising the anchor first, pushing a very old
    // anchor forward would still derive to max and the match would be free.
    const ancient = plus(NOW, -365 * 24 * 60 * MINUTE);
    const result = spendStamina(ancient, NOW, 5, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(15);
  });

  it('preserves the partial progress towards the next point', () => {
    const anchor = plus(NOW, -(10 * POINT + 4 * MINUTE)); // 10 points + 4 of the 5 minutes
    const result = spendStamina(anchor, NOW, 3, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(7);
    // One more minute still tips it over, exactly as it would have without playing.
    expect(deriveStamina(result.lastFed, plus(NOW, MINUTE), config).current).toBe(8);
  });

  it('leaves an empty creature at zero, not below', () => {
    const anchor = plus(NOW, -5 * POINT);
    const result = spendStamina(anchor, NOW, 5, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(0);
  });
});

describe('canPlay', () => {
  it('refuses below the configured minimum even when some stamina exists', () => {
    const result = canPlay(plus(NOW, -4 * POINT), NOW, config, play);
    expect(result).toEqual({ ok: false, reason: 'below_minimum', staminaBefore: 4, required: 5 });
  });

  it('allows play exactly at the minimum', () => {
    const result = canPlay(plus(NOW, -5 * POINT), NOW, config, play);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.staminaAfter).toBe(0);
  });
});

describe('feed', () => {
  it('refuses to feed a full creature instead of wasting the food', () => {
    const result = feed(initialAnchor(NOW, config), NOW, 1, config);
    expect(result).toEqual({ ok: false, reason: 'already_full', staminaBefore: 20 });
  });

  it('restores staminaPerFood per unit', () => {
    const result = feed(plus(NOW, -2 * POINT), NOW, 2, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.staminaBefore).toBe(2);
    expect(result.staminaAfter).toBe(12);
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(12);
  });

  it('never exceeds max and consumes only the food actually needed', () => {
    const result = feed(plus(NOW, -18 * POINT), NOW, 10, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.staminaAfter).toBe(20);
    expect(result.unitsConsumed).toBe(1); // 1 unit covers the missing 2 points
    expect(deriveStamina(result.lastFed, NOW, config).current).toBe(20);
  });

  it('can revive a creature drained to zero by playing', () => {
    const spent = spendStamina(initialAnchor(NOW, config), NOW, 20, config);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    expect(deriveStamina(spent.lastFed, NOW, config).current).toBe(0);

    const fed = feed(spent.lastFed, NOW, 1, config);
    expect(fed.ok).toBe(true);
    if (!fed.ok) return;
    expect(fed.staminaAfter).toBe(5);
    expect(deriveStamina(fed.lastFed, NOW, config).current).toBe(5);
  });
});
