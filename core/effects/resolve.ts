import type { Element } from '../elements';
import type { Effect, EffectCondition } from './schema';

/**
 * EFFECT RESOLUTION — server-side only.
 *
 * The five primitives are implemented here once. The admin combines them as
 * data; this file never grows a new branch per species. The client receives the
 * resolved numbers and renders them — it never runs this.
 */

export type EffectContext = {
  /** The element of the enemy being hit, base or evolved. */
  enemyElement: Element;
  /** Length of the alignment that triggered this attack. */
  comboLength: number;
  /** Whether the attacking creature has evolved. */
  selfEvolved: boolean;
};

export type ResolvedEffects = {
  damage: number;
  heal: number;
  shield: number;
  shieldTurns: number;
  /** Total percentage bonus applied to damage from combo_bonus effects. */
  comboBonusPercent: number;
  /** The effects whose conditions held. Useful for the battle log and the UI. */
  applied: readonly Effect[];
  skipped: readonly Effect[];
};

/** Every declared field must hold. An absent field is not a constraint. */
export function conditionHolds(
  condition: EffectCondition | undefined,
  context: EffectContext,
): boolean {
  if (condition === undefined) return true;
  if (condition.enemy_element !== undefined && condition.enemy_element !== context.enemyElement) {
    return false;
  }
  if (condition.min_combo !== undefined && context.comboLength < condition.min_combo) {
    return false;
  }
  if (condition.self_evolved !== undefined && condition.self_evolved !== context.selfEvolved) {
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
  let heal = 0;
  let shield = 0;
  let shieldTurns = 0;
  let comboBonusPercent = 0;
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
    }
  }

  return {
    damage: Math.floor(rawDamage * (1 + comboBonusPercent / 100)),
    heal,
    shield,
    shieldTurns,
    comboBonusPercent,
    applied,
    skipped,
  };
}
