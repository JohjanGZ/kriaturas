import type { Effect } from '../effects/schema';
import { NO_EFFECTS, resolveEffects } from '../effects/resolve';
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
 * A MATCH IS NOT AN ATTACK. Aligning gems of a creature's element only CHARGES
 * ITS BAR (`combat.damageOnlyOnSpecial`). The damage comes out when the bar
 * fills, and it comes out carrying the creature's effects: its special.
 *
 * A small attack on every match made the special a rounding error — the fight
 * was decided by chip damage nobody aimed for, and holding a bar to land a big
 * hit was strictly worse than matching whatever was nearest. Paying only on a
 * full bar turns every gem into an investment and makes "which bar do I feed"
 * the actual decision of the turn.
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
  /**
   * Si tiene su piedra fusionada. `undefined` se lee como SÍ, para que el bot
   * y el simulador --que no tienen piedras-- sigan funcionando sin saber que
   * existen.
   */
  readonly evolutionUnlocked?: boolean;
  /**
   * Locks a rival power left on it.
   *
   * BLOCKED: its attack does not land — the bar still fills and still fires, but
   * the blow is caught. PARALYZED: the bar does not fill at all. Blocking beats
   * a full bar, paralysing beats an empty one, and they are different powers for
   * exactly that reason.
   */
  readonly blockedTurns?: number;
  readonly paralyzedTurns?: number;
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
  /**
   * Damage that ignores shields and survives a block, from `damage` effects.
   * Kept apart from `totalDamage` because the battle layer subtracts it from
   * health directly — a shield never sees it.
   */
  readonly pierceDamage: number;
  readonly totalDamage: number;
  readonly heal: number;
  readonly shield: number;
  readonly shieldTurns: number;
  readonly comboBonusPercent: number;
};

/**
 * What the specials asked the battle to DO this turn, summed across everyone
 * who fired.
 *
 * The board resolver knows arithmetic, not consequences: it says "six mana off
 * two enemies" and the battle layer, which owns that state, takes it off. That
 * split is what keeps `/core/match3` free of the battle's storage shape.
 */
export type TurnPowers = {
  readonly manaDrain: number;
  readonly manaDrainTargets: number;
  readonly manaStolen: boolean;
  readonly manaBoost: number;
  readonly manaBoostTargets: number;
  readonly fruitsAbsorbed: number;
  readonly extraMoves: number;
  readonly stolenMoves: number;
  readonly poisonPerMove: number;
  readonly poisonTurns: number;
  readonly blockedTargets: number;
  readonly blockedTurns: number;
  readonly paralyzedTargets: number;
  readonly paralyzedTurns: number;
  readonly convertedTiles: number;
  /** Tiles become the element of the creature that cast it. */
  readonly convertElement: BaseElement | null;
  /** A brand new board, and the locks that outlive the move. */
  readonly shuffleBoard: boolean;
  readonly cleanse: boolean;
  readonly fruitBlockTurns: number;
};

export const NO_POWERS: TurnPowers = {
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
  convertElement: null,
  shuffleBoard: false,
  cleanse: false,
  fruitBlockTurns: 0,
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
  /**
   * Drakofruta cleared this turn. It triggers nobody either — it charges the
   * IN-BATTLE evolution, which is the caller's business, not the board's.
   */
  readonly fruitsGained: number;
  /** Damage that ignores the shield, summed across the attacks that fired. */
  readonly totalPierce: number;
  readonly gemsByElement: Readonly<Record<BaseElement, number>>;
  readonly longestCombo: number;
  readonly cascades: number;
  /** What the specials that fired want done to the battle. */
  readonly powers: TurnPowers;
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

/**
 * How much a cleared alignment is worth in mana.
 *
 * Every gem pays (`manaPerGem`), and each gem BEYOND the minimum match pays a
 * bonus on top (`manaBonusPerExtraGem`). A run of five is therefore worth more
 * than a run of three plus two loose gems, which is what makes it worth
 * spending a turn to build one instead of clearing whatever is nearest.
 */
export function manaGainedFor(
  params: { gemsCleared: number; longestRun: number },
  config: CombatConfig,
): number {
  if (params.gemsCleared <= 0) return 0;
  const extra = Math.max(0, params.longestRun - config.minMatchLength);
  return params.gemsCleared * config.manaPerGem + extra * config.manaBonusPerExtraGem;
}

/**
 * What a bar holds at the start of a battle.
 *
 * An empty bar means the first turns pay nothing — the worst possible opening
 * for a game that has to earn attention in its first minute. Both sides get it,
 * so it sets the PACE rather than handing anyone an advantage.
 */
export function startingMana(manaCost: number, config: CombatConfig): number {
  return Math.floor((Math.max(1, manaCost) * config.startingManaPercent) / 100);
}

/**
 * What the condition gates read, beyond the move itself.
 *
 * Defaulted, because most callers (and every board-only test) do not care: a
 * gate that nobody set cannot fail on numbers nobody passed.
 */
export type BattleSnapshot = {
  readonly selfHealthPercent: number;
  readonly enemyHealthPercent: number;
  readonly fruits: number;
  readonly turn: number;
};

export const FULL_HEALTH: BattleSnapshot = {
  selfHealthPercent: 100,
  enemyHealthPercent: 100,
  fruits: 0,
  turn: 1,
};

export function resolveTurn(params: {
  move: ResolvedMove;
  team: readonly Combatant[];
  /** Every element the RIVAL brought: a matchup gate asks what, never who. */
  enemyElements: readonly Element[];
  battle?: BattleSnapshot;
  config: CombatConfig;
}): TurnOutcome {
  const { move, team, enemyElements, config } = params;
  const battle = params.battle ?? FULL_HEALTH;
  const attacks: CreatureAttack[] = [];
  /** Kept beside the attack so the powers can be summed without resolving twice. */
  const fired: { element: BaseElement; resolved: ReturnType<typeof resolveEffects> }[] = [];

  for (const combatant of team) {
    const gemsCleared = move.cleared[combatant.baseElement];
    if (gemsCleared === 0) continue;

    const longestRun = move.longestRun[combatant.baseElement];
    /** Paralysed: the gems clear, the bar does not move. */
    const paralyzed = (combatant.paralyzedTurns ?? 0) > 0;
    const manaGained = paralyzed ? 0 : manaGainedFor({ gemsCleared, longestRun }, config);
    const { manaAfter, charged } = paralyzed
      ? { manaAfter: combatant.mana, charged: false }
      : chargeMana(combatant.mana, manaGained, combatant.manaCost);

    /** Effects belong to the special: they are silent until the bar fills. */
    const resolved = charged
      ? resolveEffects(combatant.effects, {
          enemyElements,
          comboLength: longestRun,
          gemsCleared,
          selfEvolved: combatant.isEvolved,
          selfHealthPercent: battle.selfHealthPercent,
          enemyHealthPercent: battle.enemyHealthPercent,
          fruits: battle.fruits,
          turn: battle.turn,
        })
      : NO_EFFECTS;

    if (charged) fired.push({ element: combatant.baseElement, resolved });

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
    /**
     * THE HIT ONLY LANDS WHEN THE BAR FILLED. A match that merely charges it
     * deals nothing: that is the trade the whole mechanic is built on.
     */
    const rawBasic =
      charged || !config.damageOnlyOnSpecial
        ? damageForMatch({ power, matchLength: longestRun }, config)
        : 0;
    /** Blocked: it fires, and the blow is caught. The effects still land. */
    const blocked = (combatant.blockedTurns ?? 0) > 0;
    const basicDamage = blocked
      ? 0
      : Math.floor(rawBasic * (1 + resolved.comboBonusPercent / 100));
    /**
     * A block catches the blow, not the needle: piercing damage lands anyway.
     * Lifesteal reads everything that actually landed.
     */
    const pierceDamage = resolved.pierceDamage;
    const totalDamage = blocked ? 0 : basicDamage + resolved.damage;

    attacks.push({
      creatureId: combatant.creatureId,
      element: combatant.baseElement,
      gemsCleared,
      longestRun,
      power,
      manaBefore: combatant.mana,
      manaGained,
      manaAfter,
      manaCost: combatant.manaCost,
      charged,
      basicDamage,
      effectDamage: blocked ? 0 : resolved.damage,
      pierceDamage,
      totalDamage,
      heal:
        resolved.heal +
        Math.floor(((totalDamage + pierceDamage) * resolved.lifestealPercent) / 100),
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

  /**
   * Summed, not listed: the battle applies one set of consequences per turn.
   * Statuses take the STRONGER of two rather than adding, so two creatures
   * casting the same lock cannot chain it into an unanswerable turn.
   */
  const powers: TurnPowers = {
    manaDrain: fired.reduce((sum, entry) => sum + entry.resolved.manaDrain, 0),
    manaDrainTargets: fired.reduce(
      (most, entry) => Math.max(most, entry.resolved.manaDrainTargets),
      0,
    ),
    manaStolen: fired.some((entry) => entry.resolved.manaStolen),
    manaBoost: fired.reduce((sum, entry) => sum + entry.resolved.manaBoost, 0),
    manaBoostTargets: fired.reduce(
      (most, entry) => Math.max(most, entry.resolved.manaBoostTargets),
      0,
    ),
    fruitsAbsorbed: fired.reduce((sum, entry) => sum + entry.resolved.fruitsAbsorbed, 0),
    extraMoves: fired.reduce((sum, entry) => sum + entry.resolved.extraMoves, 0),
    stolenMoves: fired.reduce((sum, entry) => sum + entry.resolved.stolenMoves, 0),
    poisonPerMove: fired.reduce((most, entry) => Math.max(most, entry.resolved.poisonPerMove), 0),
    poisonTurns: fired.reduce((most, entry) => Math.max(most, entry.resolved.poisonTurns), 0),
    blockedTargets: fired.reduce((most, entry) => Math.max(most, entry.resolved.blockedTargets), 0),
    blockedTurns: fired.reduce((most, entry) => Math.max(most, entry.resolved.blockedTurns), 0),
    paralyzedTargets: fired.reduce(
      (most, entry) => Math.max(most, entry.resolved.paralyzedTargets),
      0,
    ),
    paralyzedTurns: fired.reduce((most, entry) => Math.max(most, entry.resolved.paralyzedTurns), 0),
    convertedTiles: fired.reduce((sum, entry) => sum + entry.resolved.convertedTiles, 0),
    shuffleBoard: fired.some((entry) => entry.resolved.shuffleBoard),
    cleanse: fired.some((entry) => entry.resolved.cleanse),
    fruitBlockTurns: fired.reduce(
      (most, entry) => Math.max(most, entry.resolved.fruitBlockTurns),
      0,
    ),
    /** The board becomes the element of whoever asked for it. */
    convertElement: fired.find((entry) => entry.resolved.convertedTiles > 0)?.element ?? null,
  };

  return {
    attacks,
    powers,
    totalDamage: attacks.reduce((sum, attack) => sum + attack.totalDamage, 0),
    totalPierce: attacks.reduce((sum, attack) => sum + attack.pierceDamage, 0),
    totalHeal: attacks.reduce((sum, attack) => sum + attack.heal, 0),
    totalShield: attacks.reduce((sum, attack) => sum + attack.shield, 0),
    specialsFired: attacks.filter((attack) => attack.charged).map((attack) => attack.creatureId),
    foodGained: move.cleared.food,
    fruitsGained: move.cleared.drakofruta,
    gemsByElement,
    longestCombo: Math.max(
      move.longestRun.fire,
      move.longestRun.water,
      move.longestRun.plant,
      move.longestRun.psychic,
      move.longestRun.food,
      move.longestRun.drakofruta,
    ),
    cascades: move.cascades,
  };
}
