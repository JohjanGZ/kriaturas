import { z } from 'zod';

/**
 * Game tuning lives in DATABASE ROWS, never in constants.
 * Each row is (game_id, key, value jsonb) and every value is parsed with the
 * schema registered for its key before it is used.
 */

export const CONFIG_KEYS = ['stamina', 'play', 'evolution', 'combat', 'eggs'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export const configKeySchema = z.enum(CONFIG_KEYS);

/**
 * Stamina is never stored as a number. `last_fed` is the regeneration anchor:
 *   stamina = clamp(floor((now - last_fed) / regenSeconds), 0, maxStamina)
 * so absence can only ever increase stamina, never decay it.
 */
export const staminaConfigSchema = z.strictObject({
  maxStamina: z.number().int().min(1).max(1000),
  /** Seconds of elapsed real time that regenerate one stamina point. */
  regenSeconds: z.number().int().min(1).max(86_400),
  /** Stamina points restored by one unit of food. */
  staminaPerFood: z.number().int().min(1).max(1000),
});

export const playConfigSchema = z.strictObject({
  /** Playing is refused below this value. Defined per game. */
  minStaminaToPlay: z.number().int().min(1).max(1000),
  /** Stamina consumed by one match. */
  staminaCostPerMatch: z.number().int().min(1).max(1000),
  /**
   * Creatures a player brings to a match.
   *
   * The board carries four base elements, so a team smaller than four leaves
   * elements that charge nobody. That is a deliberate tuning choice, which is
   * why it lives here and not in code.
   */
  teamSize: z.number().int().min(1).max(6),
  /** Default gems needed to fill a bar, until a species overrides it. */
  defaultManaCost: z.number().int().min(1).max(100),
  /**
   * What clearing a wave pays.
   *
   * Drakofruta is deliberately NOT a board tile — rare enough to protect the
   * evolution economy would mean it almost never aligns, and common enough to
   * align would make it farmable. Winning is where it comes from instead, so
   * the rate stays a number you tune rather than a probability you fight.
   */
  drakofrutaPerWin: z.number().int().min(0).max(100).default(1),
  coinsPerWin: z.number().int().min(0).max(10_000).default(50),
});

/**
 * Evolution cost in drakofruta. The threshold is not a constant: it grows with
 * the number of evolutions the player has already performed.
 *   cost(n) = baseFruitCost + n * costIncrementPerEvolution
 */
export const evolutionConfigSchema = z.strictObject({
  baseFruitCost: z.number().int().min(1).max(10_000),
  costIncrementPerEvolution: z.number().int().min(0).max(10_000),
  maxEvolutionsPerPlayer: z.number().int().min(1).max(10_000).nullable(),
  /** Whether the objective requirements of the chosen path gate the evolution. */
  requireObjectives: z.boolean(),
  /** Whether the player may lock a path before its requirements are met. */
  allowEarlyPathChoice: z.boolean(),
});

/**
 * Eggs. Care is a server-side UTC calendar day; this offset lets the care day
 * start at something other than 00:00 UTC without ever asking the client.
 */
export const eggsConfigSchema = z.strictObject({
  dayBoundaryUtcOffsetMinutes: z.number().int().min(0).max(1439),
  maxActiveEggsPerPlayer: z.number().int().min(1).max(100),
  /** Percentage of the price refunded when an egg spoils. */
  spoiledRefundPercent: z.number().int().min(0).max(100),
});

export const combatConfigSchema = z.strictObject({
  /** Evolved creatures trigger on the same base element but hit harder. */
  evolvedDamageMultiplier: z.number().min(1).max(10),
  minMatchLength: z.number().int().min(3).max(8),
  /** Board size. Tuning, so it is a config row and never a constant. */
  boardWidth: z.number().int().min(4).max(12),
  boardHeight: z.number().int().min(4).max(12),
  /** Cascades allowed in one turn before the resolver stops. */
  maxCascades: z.number().int().min(1).max(50),
  /**
   * The player's health, FIXED for everyone.
   *
   * It does not depend on the team: swapping creatures changes the damage you
   * deal, never how much you can take. That keeps a two-creature team from
   * being punished twice for a bad matchup.
   */
  playerMaxHp: z.number().int().min(1).max(100_000),
  /**
   * Whether a swap that aligns nothing is allowed. It spends the turn and the
   * rival still answers, so it is a trade: an attack given up to reposition
   * pieces for a better alignment, or to spoil one. Defaulted so rows written
   * before this key existed still parse.
   */
  allowFreeSwaps: z.boolean().default(true),
});

export const CONFIG_SCHEMAS = {
  stamina: staminaConfigSchema,
  play: playConfigSchema,
  evolution: evolutionConfigSchema,
  combat: combatConfigSchema,
  eggs: eggsConfigSchema,
} as const;

export type StaminaConfig = z.infer<typeof staminaConfigSchema>;
export type PlayConfig = z.infer<typeof playConfigSchema>;
export type EvolutionConfig = z.infer<typeof evolutionConfigSchema>;
export type CombatConfig = z.infer<typeof combatConfigSchema>;
export type EggsConfig = z.infer<typeof eggsConfigSchema>;

export type ConfigValue<K extends ConfigKey> = z.infer<(typeof CONFIG_SCHEMAS)[K]>;

/** Parses an untrusted jsonb value against the schema registered for its key. */
export function parseConfig<K extends ConfigKey>(key: K, value: unknown): ConfigValue<K> {
  return CONFIG_SCHEMAS[key].parse(value) as ConfigValue<K>;
}

/** Defaults used by the seed script. Written as rows, never read as constants. */
export const DEFAULT_CONFIG: { [K in ConfigKey]: ConfigValue<K> } = {
  stamina: { maxStamina: 20, regenSeconds: 300, staminaPerFood: 5 },
  play: {
    minStaminaToPlay: 5,
    staminaCostPerMatch: 5,
    teamSize: 2,
    defaultManaCost: 12,
    drakofrutaPerWin: 1,
    coinsPerWin: 50,
  },
  evolution: {
    baseFruitCost: 3,
    costIncrementPerEvolution: 2,
    maxEvolutionsPerPlayer: null,
    requireObjectives: true,
    allowEarlyPathChoice: true,
  },
  combat: {
    evolvedDamageMultiplier: 1.5,
    minMatchLength: 3,
    boardWidth: 7,
    boardHeight: 5,
    maxCascades: 20,
    playerMaxHp: 100,
    allowFreeSwaps: true,
  },
  eggs: { dayBoundaryUtcOffsetMinutes: 0, maxActiveEggsPerPlayer: 5, spoiledRefundPercent: 0 },
};
