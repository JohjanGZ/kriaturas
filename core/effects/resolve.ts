import type { Element } from '../elements';
import type { Effect, EffectCondition } from './schema';

/**
 * EFFECT RESOLUTION — server-side only.
 *
 * Every primitive is implemented here ONCE. The admin combines them as data;
 * this file never grows a branch per species, and the client receives resolved
 * numbers it could not have computed.
 *
 * What comes out is a plain tally. Applying it — taking mana off a rival,
 * shortening its turn, painting the board — belongs to the battle layer, which
 * owns that state. This file knows arithmetic, not consequences.
 */

export type EffectContext = {
  /**
   * Every element in the rival LINEUP. Damage lands on the rival player, so a
   * matchup bonus can only ask what they brought, never who it hits.
   */
  enemyElements: readonly Element[];
  /** Length of the alignment that triggered this attack. */
  comboLength: number;
  /** Gems of this creature's element cleared in that move. */
  gemsCleared: number;
  /** Whether the attacking creature has transformed. */
  selfEvolved: boolean;
  /** Both healths as percentages, for desperation and finisher gates. */
  selfHealthPercent: number;
  enemyHealthPercent: number;
  /** Your drakofruta bar, and which turn it is. */
  fruits: number;
  turn: number;
};

export type ResolvedEffects = {
  /** Blockable, absorbable damage. */
  damage: number;
  /** Damage that ignores shields and survives a block. */
  pierceDamage: number;
  heal: number;
  shield: number;
  shieldTurns: number;
  /** Total percentage bonus applied to damage from combo_bonus effects. */
  comboBonusPercent: number;

  /** Mana taken off enemy creatures, and how many of them it reaches. */
  manaDrain: number;
  manaDrainTargets: number;
  /** Whether the drained mana lands on your own bars instead of vanishing. */
  manaStolen: boolean;
  /** Mana handed to your OWN lineup. */
  manaBoost: number;
  manaBoostTargets: number;

  /** Drakofruta taken from the rival's shared bar. */
  fruitsAbsorbed: number;

  /** Moves added to this turn, and taken off the rival's next one. */
  extraMoves: number;
  stolenMoves: number;

  /** Damage the rival takes per move, and for how many turns. */
  poisonPerMove: number;
  poisonTurns: number;

  /** Enemy creatures whose attack is cancelled, or whose bar stops filling. */
  blockedTargets: number;
  blockedTurns: number;
  paralyzedTargets: number;
  paralyzedTurns: number;

  /** Board tiles turned into the caster's element. */
  convertedTiles: number;
  /** A whole new board. */
  shuffleBoard: boolean;

  /** Percentage of this attack's damage returned as health. */
  lifestealPercent: number;
  /** Clears your own poison and locks. */
  cleanse: boolean;
  /** Turns the other side banks no drakofruta. */
  fruitBlockTurns: number;

  /** The effects whose conditions held. Useful for the battle log and the UI. */
  applied: readonly Effect[];
  skipped: readonly Effect[];
};

/** Nothing fired: the shape of "no special this turn", in one place. */
export const NO_EFFECTS: ResolvedEffects = {
  damage: 0,
  pierceDamage: 0,
  heal: 0,
  shield: 0,
  shieldTurns: 0,
  comboBonusPercent: 0,
  manaDrain: 0,
  manaDrainTargets: 0,
  manaStolen: false,
  manaBoost: 0,
  manaBoostTargets: 0,
  fruitsAbsorbed: 0,
  extraMoves: 0,
  stolenMoves: 0,
  poisonPerMove: 0,
  poisonTurns: 0,
  blockedTargets: 0,
  blockedTurns: 0,
  paralyzedTargets: 0,
  paralyzedTurns: 0,
  convertedTiles: 0,
  shuffleBoard: false,
  lifestealPercent: 0,
  cleanse: false,
  fruitBlockTurns: 0,
  applied: [],
  skipped: [],
};

/** Every declared field must hold. An absent field is not a constraint. */
export function conditionHolds(
  condition: EffectCondition | undefined,
  context: EffectContext,
): boolean {
  if (condition === undefined) return true;
  if (
    condition.enemy_element !== undefined &&
    !context.enemyElements.includes(condition.enemy_element)
  ) {
    return false;
  }
  if (condition.min_combo !== undefined && context.comboLength < condition.min_combo) {
    return false;
  }
  if (condition.self_evolved !== undefined && condition.self_evolved !== context.selfEvolved) {
    return false;
  }
  if (condition.min_gems !== undefined && context.gemsCleared < condition.min_gems) {
    return false;
  }
  if (
    condition.self_below_percent !== undefined &&
    context.selfHealthPercent > condition.self_below_percent
  ) {
    return false;
  }
  if (
    condition.enemy_below_percent !== undefined &&
    context.enemyHealthPercent > condition.enemy_below_percent
  ) {
    return false;
  }
  if (condition.min_fruits !== undefined && context.fruits < condition.min_fruits) {
    return false;
  }
  if (condition.turn_at_least !== undefined && context.turn < condition.turn_at_least) {
    return false;
  }
  return true;
}

/**
 * Resolves a list of effects against one attack.
 *
 * combo_bonus is applied last, to the summed damage, so the order the admin
 * happens to list the effects in cannot change the outcome.
 */
export function resolveEffects(
  effects: readonly Effect[],
  context: EffectContext,
): ResolvedEffects {
  let rawDamage = 0;
  let rawPierce = 0;
  let heal = 0;
  let shield = 0;
  let shieldTurns = 0;
  let comboBonusPercent = 0;

  let manaDrain = 0;
  let manaDrainTargets = 0;
  let manaStolen = false;
  let manaBoost = 0;
  let manaBoostTargets = 0;
  let fruitsAbsorbed = 0;
  let extraMoves = 0;
  let stolenMoves = 0;
  let poisonPerMove = 0;
  let poisonTurns = 0;
  let blockedTargets = 0;
  let blockedTurns = 0;
  let paralyzedTargets = 0;
  let paralyzedTurns = 0;
  let convertedTiles = 0;
  let shuffleBoard = false;
  let lifestealPercent = 0;
  let cleanse = false;
  let fruitBlockTurns = 0;

  const applied: Effect[] = [];
  const skipped: Effect[] = [];

  for (const effect of effects) {
    if (!conditionHolds(effect.condition, context)) {
      skipped.push(effect);
      continue;
    }
    applied.push(effect);

    switch (effect.type) {
      case 'damage':
        /** The piercing channel: no shield, no block. */
        rawPierce += effect.value;
        break;
      case 'damage_by_type':
        rawDamage += effect.value;
        break;
      case 'heal':
        heal += effect.value;
        break;
      case 'shield':
        shield += effect.value;
        shieldTurns = Math.max(shieldTurns, effect.duration_turns);
        break;
      case 'combo_bonus':
        comboBonusPercent += effect.value;
        break;

      case 'drain_mana':
        manaDrain += effect.value;
        manaDrainTargets = Math.max(manaDrainTargets, effect.targets);
        manaStolen = manaStolen || effect.to_self;
        break;
      case 'mana_boost':
        manaBoost += effect.value;
        manaBoostTargets = Math.max(manaBoostTargets, effect.targets);
        break;
      case 'absorb_fruit':
        fruitsAbsorbed += effect.value;
        break;

      case 'extra_move':
        extraMoves += effect.value;
        break;
      case 'steal_move':
        stolenMoves += effect.value;
        break;

      /**
       * A status does not stack with itself: two poisons are the stronger tick
       * for the longer time, not a sum. Stacking is how a single lucky cascade
       * turns into an unanswerable lock.
       */
      case 'poison':
        poisonPerMove = Math.max(poisonPerMove, effect.value);
        poisonTurns = Math.max(poisonTurns, effect.duration_turns);
        break;
      case 'block_attack':
        blockedTargets = Math.max(blockedTargets, effect.targets);
        blockedTurns = Math.max(blockedTurns, effect.duration_turns);
        break;
      case 'paralyze':
        paralyzedTargets = Math.max(paralyzedTargets, effect.targets);
        paralyzedTurns = Math.max(paralyzedTurns, effect.duration_turns);
        break;

      case 'convert_tiles':
        convertedTiles += effect.value;
        break;
      case 'shuffle_board':
        shuffleBoard = true;
        break;
      case 'lifesteal':
        lifestealPercent += effect.value;
        break;
      case 'cleanse':
        cleanse = true;
        break;
      case 'fruit_block':
        fruitBlockTurns = Math.max(fruitBlockTurns, effect.duration_turns);
        break;
    }
  }

  return {
    damage: Math.floor(rawDamage * (1 + comboBonusPercent / 100)),
    pierceDamage: Math.floor(rawPierce * (1 + comboBonusPercent / 100)),
    heal,
    shield,
    shieldTurns,
    comboBonusPercent,
    manaDrain,
    manaDrainTargets,
    manaStolen,
    manaBoost,
    manaBoostTargets,
    fruitsAbsorbed,
    extraMoves,
    stolenMoves,
    poisonPerMove,
    poisonTurns,
    blockedTargets,
    blockedTurns,
    paralyzedTargets,
    paralyzedTurns,
    convertedTiles,
    shuffleBoard,
    lifestealPercent,
    cleanse,
    fruitBlockTurns,
    applied,
    skipped,
  };
}
