import { z } from 'zod';

/**
 * Game tuning lives in DATABASE ROWS, never in constants.
 * Each row is (game_id, key, value jsonb) and every value is parsed with the
 * schema registered for its key before it is used.
 */

export const CONFIG_KEYS = ['stamina', 'play', 'combat', 'eggs'] as const;
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
   * What clearing a wave pays. Coins only: DRAKOFRUTA EXISTS ONLY ON THE BOARD,
   * where it buys a transformation that lasts one battle. There is no wallet to
   * pay it into.
   */
  coinsPerWin: z.number().int().min(0).max(10_000).default(50),
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
  /**
   * NOBODY HITS FOR A PLAIN MATCH. Aligning gems only charges the bar; the
   * damage comes out when the bar FILLS, carrying the creature's effects.
   *
   * A per-match attack made the special a rounding error: the fight was decided
   * by chip damage nobody aimed, and holding a bar for a big hit was worse than
   * matching anything. With this on, every gem you clear is an investment and
   * the interesting decision is which bar to feed.
   */
  damageOnlyOnSpecial: z.boolean().default(true),
  /**
   * Mana per gem cleared, and the bonus for each gem BEYOND the minimum match.
   *
   * A run of three is the baseline; a longer one is worth more than its extra
   * gems alone, which is what makes setting up a five worth the turn it costs.
   */
  manaPerGem: z.number().int().min(1).max(20).default(1),
  manaBonusPerExtraGem: z.number().int().min(0).max(20).default(2),
  /**
   * The rival plays the board too, on the SAME board, right after your move.
   * With it off the rival lineup just hits for the sum of its attacks, which is
   * what the battle did before it had a bot.
   */
  botEnabled: z.boolean().default(true),
  /**
   * How often the bot takes the best move it found, from 0 (any legal move) to
   * 1 (always the best). Difficulty is tuning, so it is a row, not a constant.
   */
  botSkill: z.number().min(0).max(1).default(0.75),
  /**
   * Moves each side gets before the turn passes, and the reward for a big
   * alignment: clear a run of at least `extraMoveMinRun` and you get one more
   * move — ONCE per turn, however many big runs you make.
   *
   * The cap is what makes it a reward instead of an engine: without it a lucky
   * cascade chain could hand someone an unbounded turn.
   */
  /**
   * How full every bar starts, as a percentage of its cost.
   *
   * Starting empty meant the first two or three turns paid NOTHING: you cleared
   * gems and watched a bar creep. The opening is where a player decides whether
   * the game is worth their evening, so both sides now start part-charged and
   * the first special lands almost immediately. Symmetric, so it is pace, not a
   * handicap.
   */
  startingManaPercent: z.number().int().min(0).max(100).default(40),
  /**
   * What a RIVAL's bar costs, as a percentage of its species cost.
   *
   * A rival carries no effects and never evolves, so its special is bare
   * damage: on the species price it simply never fired, and an opponent that
   * cannot answer is scenery, not a fight. Cheaper bars make it dangerous
   * without touching the damage numbers.
   */
  rivalManaCostPercent: z.number().int().min(10).max(200).default(70),
  /**
   * IN-BATTLE evolution: drakofruta aligned on the board fills one SHARED bar,
   * and filling it lets that side evolve one creature for the rest of the
   * fight. Nothing here touches the permanent evolution or the player's wallet.
   */
  fruitsToEvolve: z.number().int().min(1).max(60).default(6),
  /**
   * How often each tile is dealt, as relative weights.
   *
   * Six kinds dealt evenly would make every alignment rarer and hand out
   * drakofruta like gravel. The elements stay frequent enough to play with; the
   * fruit stays scarce enough that lining three up is an event.
   */
  tileWeights: z
    .strictObject({
      fire: z.number().int().min(0).max(50),
      water: z.number().int().min(0).max(50),
      plant: z.number().int().min(0).max(50),
      psychic: z.number().int().min(0).max(50),
      food: z.number().int().min(0).max(50),
      drakofruta: z.number().int().min(0).max(50),
    })
    .default({ fire: 4, water: 4, plant: 4, psychic: 4, food: 3, drakofruta: 2 }),
  movesPerTurn: z.number().int().min(1).max(10).default(2),
  extraMoveMinRun: z.number().int().min(3).max(12).default(4),
  extraMovesPerTurn: z.number().int().min(0).max(5).default(1),
});

export const CONFIG_SCHEMAS = {
  stamina: staminaConfigSchema,
  play: playConfigSchema,
  combat: combatConfigSchema,
  eggs: eggsConfigSchema,
} as const;

export type StaminaConfig = z.infer<typeof staminaConfigSchema>;
export type PlayConfig = z.infer<typeof playConfigSchema>;
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
    coinsPerWin: 50,
  },
  combat: {
    evolvedDamageMultiplier: 1.5,
    minMatchLength: 3,
    boardWidth: 7,
    boardHeight: 5,
    maxCascades: 20,
    /**
     * Health is the knob for LENGTH; the bars are the knob for RHYTHM, and the
     * two must not be confused. At 100 a battle ended in three turns; at 150 it
     * dragged with the rival unable to answer. 120 is the middle, measured.
     */
    playerMaxHp: 120,
    allowFreeSwaps: true,
    damageOnlyOnSpecial: true,
    manaPerGem: 1,
    manaBonusPerExtraGem: 2,
    botEnabled: true,
    botSkill: 0.85,
    startingManaPercent: 40,
    rivalManaCostPercent: 70,
    fruitsToEvolve: 6,
    tileWeights: { fire: 4, water: 4, plant: 4, psychic: 4, food: 3, drakofruta: 2 },
    movesPerTurn: 2,
    extraMoveMinRun: 4,
    extraMovesPerTurn: 1,
  },
  eggs: { dayBoundaryUtcOffsetMinutes: 0, maxActiveEggsPerPlayer: 5, spoiledRefundPercent: 0 },
};
