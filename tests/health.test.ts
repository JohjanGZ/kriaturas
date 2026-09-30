import { describe, expect, it } from 'vitest';
import { fallsIll, illnessChance, shouldRollForIllness, staminaCeiling } from '@/core/health';
import { deriveStamina, feed } from '@/core/stamina';
import type { HealthConfig, StaminaConfig } from '@/core/schemas/config';

const health: HealthConfig = {
  chanceAtEmptyPercent: 20,
  sickCeilingPercent: 25,
  curePriceCoins: 150,
};

const stamina: StaminaConfig = { maxStamina: 20, regenSeconds: 300, staminaPerFood: 5 };

/**
 * The rule is one sentence — leave it dry and it may fall ill — and it only
 * works because stamina falls by PLAYING. Being away can only raise it, so
 * absence makes creatures safer rather than punishing a quiet week.
 */
describe('illnessChance', () => {
  it('is EXACTLY zero on a full bar: a promise the player can act on', () => {
    expect(illnessChance(20, health, 20)).toBe(0);
  });

  it('peaks at the configured chance on an empty one', () => {
    expect(illnessChance(0, health, 20)).toBe(20);
  });

  it('hugs the floor until the creature is genuinely spent', () => {
    /** Half a bar under a straight line would be 10%; cubed it is a quarter of that. */
    expect(illnessChance(10, health, 20)).toBeCloseTo(2.5, 5);
    expect(illnessChance(15, health, 20)).toBeLessThan(1);
  });

  it('only ever goes up as the bar goes down', () => {
    let previous = -1;
    for (let left = 20; left >= 0; left -= 1) {
      const chance = illnessChance(left, health, 20);
      expect(chance).toBeGreaterThanOrEqual(previous);
      previous = chance;
    }
  });

  it('never goes negative or past the peak, whatever it is handed', () => {
    expect(illnessChance(-5, health, 20)).toBe(20);
    expect(illnessChance(999, health, 20)).toBe(0);
    expect(illnessChance(5, health, 0)).toBe(0);
  });
});

describe('fallsIll', () => {
  it('never falls ill on a full bar, whatever the roll says', () => {
    expect(fallsIll(20, health, 20, () => 0)).toBe(false);
  });

  it('falls ill when the roll lands under the chance', () => {
    /** 20% at empty: a roll of 0.1 is 10, which is under 20. */
    expect(fallsIll(0, health, 20, () => 0.1)).toBe(true);
    expect(fallsIll(0, health, 20, () => 0.9)).toBe(false);
  });

  it('is off entirely when the chance is configured to zero', () => {
    const never: HealthConfig = { ...health, chanceAtEmptyPercent: 0 };
    expect(fallsIll(0, never, 20, () => 0)).toBe(false);
  });
});

describe('shouldRollForIllness', () => {
  it('rolls ONCE, when the creature drops below what a battle needs', () => {
    expect(
      shouldRollForIllness({ staminaAfter: 0, minStaminaToPlay: 5, alreadySick: false }),
    ).toBe(true);
    expect(
      shouldRollForIllness({ staminaAfter: 5, minStaminaToPlay: 5, alreadySick: false }),
    ).toBe(false);
  });

  it('never rolls for one that is already ill', () => {
    /** Rolling again would quietly reset how long it has been sick. */
    expect(
      shouldRollForIllness({ staminaAfter: 0, minStaminaToPlay: 5, alreadySick: true }),
    ).toBe(false);
  });
});

/**
 * Sick is WEAK, not frozen. The bar keeps filling and stops early, so feeding
 * still does something — "food does nothing at all" reads as a broken button —
 * and the creature can still be played, badly.
 */
describe('the ceiling while sick', () => {
  it('is a quarter of the bar at the configured percentage', () => {
    expect(staminaCeiling(true, health, stamina)).toBe(5);
    expect(staminaCeiling(false, health, stamina)).toBe(20);
  });

  it('never drops to zero, however small the percentage', () => {
    const cruel: HealthConfig = { ...health, sickCeilingPercent: 1 };
    expect(staminaCeiling(true, cruel, stamina)).toBe(1);
  });

  it('stops the bar early and calls THAT full', () => {
    const anchor = new Date('2026-04-01T00:00:00Z');
    /** Two hours later a healthy creature would be at maximum. */
    const later = new Date(anchor.getTime() + 2 * 3_600_000);

    expect(deriveStamina(anchor, later, stamina).current).toBe(20);

    const sick = deriveStamina(anchor, later, stamina, 5);
    expect(sick.current).toBe(5);
    expect(sick.isFull).toBe(true);
    expect(sick.secondsUntilFull).toBe(0);
  });

  it('FOOD IS NOT A CURE: feeding cannot push past the ceiling', () => {
    const anchor = new Date('2026-04-01T00:00:00Z');
    const now = new Date(anchor.getTime());

    /** Ten units on an empty bar would fill it twice over. */
    const fed = feed(anchor, now, 10, stamina, 5);
    expect(fed.ok).toBe(true);
    expect(fed.ok && fed.staminaAfter).toBe(5);
  });

  it('and the anchor it leaves does not become a cure later', () => {
    const anchor = new Date('2026-04-01T00:00:00Z');
    const now = new Date(anchor.getTime());
    const fed = feed(anchor, now, 10, stamina, 5);
    if (!fed.ok) throw new Error('la comida fue rechazada');

    /**
     * The moment it is cured the bar must NOT already be at maximum: a feed
     * that pulled the anchor back to "full" would have bought the cure through
     * the back door.
     */
    expect(deriveStamina(fed.lastFed, now, stamina).current).toBe(5);
  });

  it('refuses food once the sick creature is at its ceiling', () => {
    const anchor = new Date('2026-04-01T00:00:00Z');
    const later = new Date(anchor.getTime() + 2 * 3_600_000);
    const fed = feed(anchor, later, 1, stamina, 5);
    expect(fed.ok).toBe(false);
    expect(!fed.ok && fed.reason).toBe('already_full');
  });
});
