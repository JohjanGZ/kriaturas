import type { Effect } from '../effects/schema';
import { resolveEffects } from '../effects/resolve';
import type { BaseElement, Element } from '../elements';
import type { CombatConfig } from '../schemas/config';
import type { MoveResult } from './matching';
import { attackPowerFor, damageForMatch } from './tiles';

/**
 * TURN RESOLUTION — gems become mana, mana becomes a special.
 *
 * Aligning gems of an element triggers every creature whose SPECIES BASE
 * ELEMENT is that element. An evolved creature triggers on the same gem and
 * only hits harder, so nothing here ever looks at an evolved element.
 *
 * Each triggered creature does two things at once:
 *
 *   1. BASIC ATTACK — always, on every match of its element. Small, immediate,
 *      no effects. The player never has a turn where nothing happens.
 *   2. MANA — the gems cleared charge its bar. When the bar fills, THIS SAME
 *      attack comes out carrying the creature's effects: its special. The bar
 *      then empties and starts again.
 *
 * So effects are not a per-match freebie. They are what the bar is for, and
 * that is the whole reason two creatures of one element can feel different.
 *
 * A creature whose element was not matched does nothing and charges nothing:
 * being on the team is not the trigger, the board is.
 *
 * Mana is BATTLE state, owned and written by the server from resolved moves.
 * Storing it as a number is safe — unlike stamina it does not regenerate with
 * real time, so there is no clock for a client to lie about.
 */

export type Combatant = {
  readonly creatureId: string;
  readonly baseElement: BaseElement;
  readonly baseAttack: number;
  /** Stat bonus from the evolution path this creature took, 0 when unevolved. */
  readonly pathAttackBonus: number;
  readonly isEvolved: boolean;
  readonly effects: readonly Effect[];
  /** Gems of its own element needed to fire the special. */
  readonly manaCost: number;
  /** Mana carried into this turn. */
  readonly mana: number;
};

export type CreatureAttack = {
  readonly creatureId: string;
  readonly element: BaseElement;
  readonly gemsCleared: number;
  /** Longest single run of that element — what combo conditions are tested on. */
  readonly longestRun: number;
  readonly power: number;

  readonly manaBefore: number;
  readonly manaGained: number;
  readonly manaAfter: number;
  readonly manaCost: number;
  /** True when the bar filled this turn and the special came out. */
  readonly charged: boolean;

  readonly basicDamage: number;
  /** Damage from the effects. Zero unless the special fired. */
  readonly effectDamage: number;
  readonly totalDamage: number;
  readonly heal: number;
  readonly shield: number;
  readonly shieldTurns: number;
  readonly comboBonusPercent: number;
};

export type TurnOutcome = {
  readonly attacks: readonly CreatureAttack[];
  readonly totalDamage: number;
  readonly totalHeal: number;
  readonly totalShield: number;
  /** Creatures whose special fired this turn. */
  readonly specialsFired: readonly string[];
  /** Food tiles are a resource, not an element: they trigger nobody. */
  readonly foodGained: number;
  readonly gemsByElement: Readonly<Record<BaseElement, number>>;
  readonly longestCombo: number;
  readonly cascades: number;
};

export type ResolvedMove = Extract<MoveResult, { ok: true }>;

/**
 * Charges a bar with the gems cleared this turn.
 *
 * The special fires at most ONCE per turn even if a huge cascade delivers twice
 * the cost — a single move should not discharge two specials. The leftover is
 * carried, so no gem is wasted, but the carry is capped at one full bar so a
 * lucky cascade cannot bank charges for later.
 */
export function chargeMana(
  mana: number,
  gems: number,
  manaCost: number,
): { manaAfter: number; charged: boolean } {
  const cost = Math.max(1, manaCost);
  const raw = mana + gems;
  if (raw < cost) return { manaAfter: raw, charged: false };
  return { manaAfter: Math.min(raw - cost, cost), charged: true };
}

export function resolveTurn(params: {
  move: ResolvedMove;
  team: readonly Combatant[];
  enemyElement: Element;
  config: CombatConfig;
}): TurnOutcome {
  const { move, team, enemyElement, config } = params;
  const attacks: CreatureAttack[] = [];

  for (const combatant of team) {
    const gemsCleared = move.cleared[combatant.baseElement];
    if (gemsCleared === 0) continue;

    const longestRun = move.longestRun[combatant.baseElement];
    const { manaAfter, charged } = chargeMana(
      combatant.mana,
      gemsCleared,
      combatant.manaCost,
    );

    /** Effects belong to the special: they are silent until the bar fills. */
    const resolved = charged
      ? resolveEffects(combatant.effects, {
          enemyElement,
          comboLength: longestRun,
          selfEvolved: combatant.isEvolved,
        })
      : {
          damage: 0,
          heal: 0,
          shield: 0,
          shieldTurns: 0,
          comboBonusPercent: 0,
          applied: [],
          skipped: [],
        };

    const power = attackPowerFor(
      {
        speciesBaseAttack: combatant.baseAttack,
        pathAttackBonus: combatant.pathAttackBonus,
        isEvolved: combatant.isEvolved,
      },
      config,
    );

    /**
     * The combo bonus lifts the creature's own attack too, not just its effect
     * damage — otherwise the primitive would be nearly worthless on a creature
     * whose damage comes from its stats.
     */
    const rawBasic = damageForMatch({ power, matchLength: longestRun }, config);
    const basicDamage = Math.floor(rawBasic * (1 + resolved.comboBonusPercent / 100));

    attacks.push({
      creatureId: combatant.creatureId,
      element: combatant.baseElement,
      gemsCleared,
      longestRun,
      power,
      manaBefore: combatant.mana,
      manaGained: gemsCleared,
      manaAfter,
      manaCost: combatant.manaCost,
      charged,
      basicDamage,
      effectDamage: resolved.damage,
      totalDamage: basicDamage + resolved.damage,
      heal: resolved.heal,
      shield: resolved.shield,
      shieldTurns: resolved.shieldTurns,
      comboBonusPercent: resolved.comboBonusPercent,
    });
  }

  const gemsByElement = {
    fire: move.cleared.fire,
    water: move.cleared.water,
    plant: move.cleared.plant,
    psychic: move.cleared.psychic,
  } as const;

  return {
    attacks,
    totalDamage: attacks.reduce((sum, attack) => sum + attack.totalDamage, 0),
    totalHeal: attacks.reduce((sum, attack) => sum + attack.heal, 0),
    totalShield: attacks.reduce((sum, attack) => sum + attack.shield, 0),
    specialsFired: attacks.filter((attack) => attack.charged).map((attack) => attack.creatureId),
    foodGained: move.cleared.food,
    gemsByElement,
    longestCombo: Math.max(
      move.longestRun.fire,
      move.longestRun.water,
      move.longestRun.plant,
      move.longestRun.psychic,
      move.longestRun.food,
    ),
    cascades: move.cascades,
  };
}
