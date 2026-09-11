import type { Element } from '../elements';
import type { Combatant, TurnOutcome } from '../match3/combat';
import type { CombatConfig } from '../schemas/config';

/**
 * BATTLE STATE — two players, one life each.
 *
 * THE CREATURES DO NOT HAVE HEALTH AND DO NOT DIE. Your pair attacks the RIVAL
 * PLAYER; the rival's pair attacks you. A creature is a weapon with an element
 * and a mana bar, not a target — which is why nothing here reads or writes a
 * creature's hit points.
 *
 * Both bars are the same fixed size (`combat.playerMaxHp`), so a lineup changes
 * the damage you deal, never how much you can take.
 *
 * `species.baseHp` and `evolutionPath.hpBonus` therefore feed nothing in a
 * battle. They stay as species data for the roster and for whatever later mode
 * wants them.
 *
 * Pure: no clock, no randomness, no storage. The caller resolves the board move
 * first and hands the outcome in.
 */

export type Rival = {
  readonly id: string;
  readonly name: string;
  /** Drives `damage_by_type` conditions on your creatures' specials. */
  readonly element: Element;
  /** What this creature hits you for each turn. */
  readonly attack: number;
};

export type BattleStatus = 'active' | 'won' | 'lost';

export type BattleState = {
  readonly playerMaxHp: number;
  readonly playerHp: number;
  readonly opponentMaxHp: number;
  readonly opponentHp: number;
  /** Absorbs incoming damage before your health does. */
  readonly shield: number;
  readonly shieldTurns: number;
  /** Your lineup, carrying its mana between turns. */
  readonly team: readonly Combatant[];
  /** The rival's lineup. */
  readonly rivals: readonly Rival[];
  readonly turn: number;
  readonly status: BattleStatus;
};

export function startBattle(params: {
  team: readonly Combatant[];
  rivals: readonly Rival[];
  config: CombatConfig;
}): BattleState {
  if (params.rivals.length === 0) throw new Error('A battle needs at least one rival creature');
  return {
    playerMaxHp: params.config.playerMaxHp,
    playerHp: params.config.playerMaxHp,
    opponentMaxHp: params.config.playerMaxHp,
    opponentHp: params.config.playerMaxHp,
    shield: 0,
    shieldTurns: 0,
    team: params.team,
    rivals: params.rivals,
    turn: 0,
    status: 'active',
  };
}

/** What the rival lineup hits for in one turn. */
export function rivalDamage(rivals: readonly Rival[]): number {
  return rivals.reduce((total, rival) => total + Math.max(0, rival.attack), 0);
}

export type TurnLog = {
  readonly damageToOpponent: number;
  readonly healed: number;
  readonly shieldGained: number;
  readonly rivalAttack: number;
  readonly absorbedByShield: number;
  readonly damageToPlayer: number;
  readonly specialsFired: readonly string[];
};

export type TurnResult = {
  readonly state: BattleState;
  readonly log: TurnLog;
};

/**
 * Applies one resolved board move, then lets the rival lineup answer.
 *
 * Your damage lands FIRST: dropping the rival to zero ends the battle before
 * they can hit back, so finishing is worth more than trading.
 */
export function applyTurn(state: BattleState, outcome: TurnOutcome): TurnResult {
  if (state.status !== 'active') {
    return {
      state,
      log: {
        damageToOpponent: 0,
        healed: 0,
        shieldGained: 0,
        rivalAttack: 0,
        absorbedByShield: 0,
        damageToPlayer: 0,
        specialsFired: outcome.specialsFired,
      },
    };
  }

  /** 1. Your lineup hits the rival player. */
  const damageToOpponent = Math.min(outcome.totalDamage, state.opponentHp);
  const opponentHp = state.opponentHp - damageToOpponent;
  const opponentDown = opponentHp <= 0;

  /** 2. Healing and shields from the specials that fired. */
  const healed = Math.min(outcome.totalHeal, state.playerMaxHp - state.playerHp);
  let playerHp = state.playerHp + healed;
  let shield = state.shield + outcome.totalShield;
  let shieldTurns = Math.max(
    state.shieldTurns,
    outcome.attacks.reduce((turns, attack) => Math.max(turns, attack.shieldTurns), 0),
  );

  /** 3. Mana carried forward, so the bars survive between turns. */
  const manaById = new Map(outcome.attacks.map((attack) => [attack.creatureId, attack.manaAfter]));
  const team = state.team.map((member) => ({
    ...member,
    mana: manaById.get(member.creatureId) ?? member.mana,
  }));

  /** 4. The rival answers — unless the battle just ended. */
  let rivalAttack = 0;
  let absorbedByShield = 0;
  let damageToPlayer = 0;

  if (!opponentDown) {
    rivalAttack = rivalDamage(state.rivals);
    absorbedByShield = Math.min(shield, rivalAttack);
    shield -= absorbedByShield;
    damageToPlayer = rivalAttack - absorbedByShield;
    playerHp = Math.max(0, playerHp - damageToPlayer);
  }

  /** A shield lasts a number of turns, used or not. */
  if (shieldTurns > 0) {
    shieldTurns -= 1;
    if (shieldTurns === 0) shield = 0;
  }

  const status: BattleStatus = opponentDown ? 'won' : playerHp <= 0 ? 'lost' : 'active';

  return {
    state: {
      ...state,
      playerHp,
      opponentHp: Math.max(0, opponentHp),
      shield,
      shieldTurns,
      team,
      turn: state.turn + 1,
      status,
    },
    log: {
      damageToOpponent,
      healed,
      shieldGained: outcome.totalShield,
      rivalAttack,
      absorbedByShield,
      damageToPlayer,
      specialsFired: outcome.specialsFired,
    },
  };
}
