import type { Element } from '../elements';
import type { Combatant, TurnOutcome, TurnPowers } from '../match3/combat';
import type { CombatConfig } from '../schemas/config';

/**
 * BATTLE STATE — two players, one life each, and a turn made of several moves.
 *
 * THE CREATURES DO NOT HAVE HEALTH AND DO NOT DIE. Your pair attacks the RIVAL
 * PLAYER; the rival's pair attacks you. A creature is a weapon with an element
 * and a mana bar, not a target — which is why nothing here reads or writes a
 * creature's hit points.
 *
 * NOBODY HITS FOR A PLAIN MATCH. Gems charge bars; a full bar is what deals
 * damage (`combat.damageOnlyOnSpecial`, resolved in core/match3/combat.ts). So a
 * turn here is about what was charged, not about what was cleared.
 *
 * A TURN IS `combat.movesPerTurn` MOVES, plus one bonus move for clearing a run
 * of `combat.extraMoveMinRun` or more — granted at most `extraMovesPerTurn`
 * times per turn, so a lucky cascade cannot turn into an endless turn.
 *
 * Both lives are the same fixed size (`combat.playerMaxHp`), so a lineup changes
 * the damage you deal, never how much you can take.
 *
 * Pure: no clock, no randomness, no storage. The caller resolves the board move
 * first and hands the outcome in.
 */

export type Rival = {
  readonly id: string;
  readonly name: string;
  /** Drives `damage_by_type` conditions on your creatures' specials. */
  readonly element: Element;
  /** What this creature hits for when ITS bar fills. */
  readonly attack: number;
  /** Gems of its element needed to fire. */
  readonly manaCost: number;
  /** Mana carried between turns, exactly like yours. */
  readonly mana: number;
  /** Locks your powers left on it: see `Combatant` for what each one does. */
  readonly blockedTurns?: number;
  readonly paralyzedTurns?: number;
};

export type BattleStatus = 'active' | 'won' | 'lost';

/** Damage per move, for a number of turns. Zero turns is no poison at all. */
export type StatusTick = {
  readonly perMove: number;
  readonly turns: number;
};

export const NO_TICK: StatusTick = { perMove: 0, turns: 0 };

export type BattleState = {
  readonly playerMaxHp: number;
  readonly playerHp: number;
  readonly opponentMaxHp: number;
  readonly opponentHp: number;
  /** Absorbs incoming damage before your health does. */
  readonly shield: number;
  readonly shieldTurns: number;
  /**
   * The rival's own shield.
   *
   * Without it a `shield` effect on the bot's side did nothing at all, and
   * piercing damage had nothing to pierce in that direction. Nothing in this
   * battle may be a special case for the machine.
   */
  readonly opponentShield: number;
  readonly opponentShieldTurns: number;
  /** Your lineup, carrying its mana between turns. */
  readonly team: readonly Combatant[];
  /** The rival's lineup — it plays the same board you do. */
  readonly rivals: readonly Rival[];
  /**
   * Drakofruta aligned on the board, one SHARED bar per side. Filling it lets
   * that side transform one creature FOR THE REST OF THIS BATTLE — it is not
   * the permanent evolution and it never touches the player's wallet.
   */
  readonly fruits: number;
  readonly rivalFruits: number;
  /** Who already transformed. Ids, because a creature can only do it once. */
  readonly evolvedInBattle: readonly string[];
  readonly rivalEvolvedInBattle: readonly string[];
  /**
   * POWERS THAT LAST.
   *
   * Poison bleeds a side once per MOVE it makes — per move and not per turn on
   * purpose, so the extra moves a big alignment earns are also the moves that
   * cost the most. A move penalty shortens that side's NEXT turn.
   */
  readonly playerPoison: StatusTick;
  readonly rivalPoison: StatusTick;
  readonly playerMovePenalty: number;
  readonly rivalMovePenalty: number;
  /** Turns each side banks NO drakofruta: a transformation denied. */
  readonly playerFruitBlockTurns: number;
  readonly rivalFruitBlockTurns: number;
  readonly turn: number;
  /** Moves you have left in this turn. */
  readonly movesLeft: number;
  /** Whether the bonus move was already granted this turn. */
  readonly extraMoveUsed: boolean;
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
    opponentShield: 0,
    opponentShieldTurns: 0,
    team: params.team,
    rivals: params.rivals,
    fruits: 0,
    rivalFruits: 0,
    evolvedInBattle: [],
    rivalEvolvedInBattle: [],
    playerPoison: NO_TICK,
    rivalPoison: NO_TICK,
    playerMovePenalty: 0,
    rivalMovePenalty: 0,
    playerFruitBlockTurns: 0,
    rivalFruitBlockTurns: 0,
    turn: 0,
    movesLeft: params.config.movesPerTurn,
    extraMoveUsed: false,
    status: 'active',
  };
}

/** What the rival lineup hits for when the bot is switched off entirely. */
export function rivalDamage(rivals: readonly Rival[]): number {
  return rivals.reduce((total, rival) => total + Math.max(0, rival.attack), 0);
}

/**
 * Did this move earn the bonus move?
 *
 * Any alignment of `extraMoveMinRun` or more counts — food included, because the
 * reward is for the SHAPE you built, not for who it charged.
 */
export function grantsExtraMove(outcome: TurnOutcome, config: CombatConfig): boolean {
  return config.extraMovesPerTurn > 0 && outcome.longestCombo >= config.extraMoveMinRun;
}

export type MoveLog = {
  readonly damageToOpponent: number;
  readonly healed: number;
  readonly shieldGained: number;
  readonly specialsFired: readonly string[];
  /** True when this move bought one more move. */
  readonly extraMoveGranted: boolean;
  readonly movesLeft: number;
  /** True when the move used up the turn — the rival plays next. */
  readonly turnOver: boolean;
  /** Drakofruta banked this move, and the bar after it. */
  readonly fruitsGained: number;
  readonly fruits: number;
  /** Health this move cost you to poison, before anything you healed. */
  readonly poisonTaken: number;
  /** True when the bar is full and somebody on your side can still transform. */
  readonly canEvolve: boolean;
};

/** Named for the PLAYER's move: `MoveResult` in core/match3 is the board's. */
export type PlayerMoveResult = {
  readonly state: BattleState;
  readonly log: MoveLog;
};

const noMove = (state: BattleState): PlayerMoveResult => ({
  state,
  log: {
    damageToOpponent: 0,
    healed: 0,
    shieldGained: 0,
    specialsFired: [],
    extraMoveGranted: false,
    movesLeft: state.movesLeft,
    turnOver: false,
    fruitsGained: 0,
    fruits: state.fruits,
    poisonTaken: 0,
    canEvolve: false,
  },
});

/**
 * Applies ONE of your moves: the damage its full bars dealt, the healing and
 * shields they carried, the mana everyone keeps, and what it cost you in moves.
 *
 * Your damage lands FIRST: dropping the rival to zero ends the battle before
 * they can answer, so finishing is worth more than trading.
 */
export function applyPlayerMove(
  state: BattleState,
  outcome: TurnOutcome,
  config: CombatConfig,
): PlayerMoveResult {
  if (state.status !== 'active') return noMove(state);

  /** The rival's shield eats the blockable half; the needle goes through it. */
  const absorbedByOpponent = Math.min(state.opponentShield, outcome.totalDamage);
  const throughShield = outcome.totalDamage - absorbedByOpponent + outcome.totalPierce;
  const damageToOpponent = Math.min(throughShield, state.opponentHp);
  const opponentHp = state.opponentHp - damageToOpponent;
  const opponentDown = opponentHp <= 0;

  const healed = Math.min(outcome.totalHeal, state.playerMaxHp - state.playerHp);
  /** Poison bleeds you for MOVING, before anything you healed can cover it. */
  const poisonTaken = state.playerPoison.turns > 0 ? state.playerPoison.perMove : 0;
  const playerHp = Math.max(0, state.playerHp + healed - poisonTaken);
  const shield = state.shield + outcome.totalShield;
  const shieldTurns = Math.max(
    state.shieldTurns,
    outcome.attacks.reduce((turns, attack) => Math.max(turns, attack.shieldTurns), 0),
  );

  /** Mana carried forward, so the bars survive between turns. */
  const manaById = new Map(outcome.attacks.map((attack) => [attack.creatureId, attack.manaAfter]));
  const team = state.team.map((member) => ({
    ...member,
    mana: manaById.get(member.creatureId) ?? member.mana,
  }));

  /** The bonus move is granted BEFORE this move is charged for. */
  const extraMoveGranted = !state.extraMoveUsed && grantsExtraMove(outcome, config);
  const budget = state.movesLeft + (extraMoveGranted ? config.extraMovesPerTurn : 0);
  const movesLeft = Math.max(0, budget - 1);

  /** Blocked: the fruit clears off the board and nobody banks it. */
  const fruits =
    state.playerFruitBlockTurns > 0 ? state.fruits : state.fruits + outcome.fruitsGained;
  const next: BattleState = {
      ...state,
      playerHp,
      opponentHp: Math.max(0, opponentHp),
      shield,
      shieldTurns,
      opponentShield: state.opponentShield - absorbedByOpponent,
      team,
      fruits,
      movesLeft,
      extraMoveUsed: state.extraMoveUsed || extraMoveGranted,
      status: opponentDown ? 'won' : playerHp <= 0 ? 'lost' : state.status,
  };

  return {
    state: next,
    log: {
      damageToOpponent,
      healed,
      shieldGained: outcome.totalShield,
      specialsFired: outcome.specialsFired,
      extraMoveGranted,
      movesLeft,
      turnOver: opponentDown || movesLeft <= 0,
      fruitsGained: outcome.fruitsGained,
      fruits,
      poisonTaken,
      canEvolve: canEvolveInBattle(next, config),
    },
  };
}

/**
 * IN-BATTLE EVOLUTION — the fruit you align on the board.
 *
 * It is NOT the permanent evolution: it lasts this battle, costs no wallet
 * drakofruta, and leaves no trace on the creature row. Both sides play by these
 * same rules, which is the only reason the board's fruit is worth fighting over.
 */
export function canEvolveInBattle(state: BattleState, config: CombatConfig): boolean {
  if (state.status !== 'active') return false;
  if (state.fruits < config.fruitsToEvolve) return false;
  return state.team.some((member) => !state.evolvedInBattle.includes(member.creatureId));
}

export type EvolveInBattleRefusal = 'not_enough_fruits' | 'not_in_battle' | 'already_evolved';

export type EvolveInBattleResult =
  | { readonly ok: true; readonly state: BattleState }
  | { readonly ok: false; readonly reason: EvolveInBattleRefusal };

/**
 * Spends the shared bar on ONE creature. The stat change itself is the caller's
 * job — it rebuilds the combatant from its evolution path — so this stays the
 * single place that decides WHETHER it may happen.
 */
export function evolveInBattle(
  state: BattleState,
  creatureId: string,
  config: CombatConfig,
): EvolveInBattleResult {
  if (!state.team.some((member) => member.creatureId === creatureId)) {
    return { ok: false, reason: 'not_in_battle' };
  }
  if (state.evolvedInBattle.includes(creatureId)) {
    return { ok: false, reason: 'already_evolved' };
  }
  if (state.fruits < config.fruitsToEvolve) return { ok: false, reason: 'not_enough_fruits' };

  return {
    ok: true,
    state: {
      ...state,
      fruits: state.fruits - config.fruitsToEvolve,
      evolvedInBattle: [...state.evolvedInBattle, creatureId],
      team: state.team.map((member) =>
        member.creatureId === creatureId ? { ...member, isEvolved: true } : member,
      ),
    },
  };
}

/**
 * The bot's turn to transform. It picks its hardest hitter, because a rival
 * that spends the fruit badly is not a rival — and it must play by the same
 * threshold the player does.
 */
export function rivalToEvolve(state: BattleState, config: CombatConfig): string | null {
  if (state.status !== 'active') return null;
  if (state.rivalFruits < config.fruitsToEvolve) return null;

  const candidates = state.rivals.filter(
    (rival) => !state.rivalEvolvedInBattle.includes(rival.id),
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((best, rival) => (rival.attack > best.attack ? rival : best)).id;
}

export function evolveRivalInBattle(
  state: BattleState,
  rivalId: string,
  config: CombatConfig,
): BattleState {
  if (state.rivalFruits < config.fruitsToEvolve) return state;
  if (state.rivalEvolvedInBattle.includes(rivalId)) return state;

  return {
    ...state,
    rivalFruits: state.rivalFruits - config.fruitsToEvolve,
    rivalEvolvedInBattle: [...state.rivalEvolvedInBattle, rivalId],
    rivals: state.rivals.map((rival) =>
      rival.id === rivalId
        ? { ...rival, attack: Math.round(rival.attack * config.evolvedDamageMultiplier) }
        : rival,
    ),
  };
}

export type RivalLog = {
  readonly rivalAttack: number;
  readonly absorbedByShield: number;
  readonly damageToPlayer: number;
  readonly specialsFired: readonly string[];
  /** Health the poison took off the RIVAL for moving. */
  readonly poisonDealt: number;
  readonly extraMoveGranted: boolean;
};

export type RivalResult = {
  readonly state: BattleState;
  readonly log: RivalLog;
};

/**
 * Damage arriving at YOUR side: the shield eats the blockable part before your
 * health does, and the piercing part walks straight past it.
 */
function takeHit(
  state: BattleState,
  incoming: number,
  pierce = 0,
): { playerHp: number; shield: number; absorbed: number; taken: number } {
  const absorbed = Math.min(state.shield, incoming);
  const taken = incoming - absorbed + pierce;
  return {
    playerHp: Math.max(0, state.playerHp - taken),
    shield: state.shield - absorbed,
    absorbed,
    taken,
  };
}

/**
 * Applies one of the BOT's moves, resolved against the same board you play on.
 *
 * It charges its own bars from what it cleared and hits you only when one fills
 * — the same rule your creatures follow. Nothing here is a special case for the
 * machine, which is the only reason the fight reads as fair.
 */
export function applyRivalMove(
  state: BattleState,
  outcome: TurnOutcome,
  config: CombatConfig,
): RivalResult {
  const quiet: RivalLog = {
    rivalAttack: 0,
    absorbedByShield: 0,
    damageToPlayer: 0,
    specialsFired: [],
    poisonDealt: 0,
    extraMoveGranted: false,
  };
  if (state.status !== 'active') return { state, log: quiet };

  /** The rival bleeds for its own moves, exactly as you do for yours. */
  const rivalPoison = state.rivalPoison.turns > 0 ? state.rivalPoison.perMove : 0;
  const opponentHp = Math.max(0, state.opponentHp - rivalPoison);

  const hit = takeHit(state, outcome.totalDamage, outcome.totalPierce);
  const manaById = new Map(outcome.attacks.map((attack) => [attack.creatureId, attack.manaAfter]));
  const rivals = state.rivals.map((rival) => ({
    ...rival,
    mana: manaById.get(rival.id) ?? rival.mana,
  }));

  return {
    state: {
      ...state,
      playerHp: hit.playerHp,
      opponentHp,
      shield: hit.shield,
      /** Its own shield effects: the mirror of yours. */
      opponentShield: state.opponentShield + outcome.totalShield,
      opponentShieldTurns: Math.max(
        state.opponentShieldTurns,
        outcome.attacks.reduce((turns, attack) => Math.max(turns, attack.shieldTurns), 0),
      ),
      rivals,
      /** The board is shared, so the fruit the bot clears is fruit you lost. */
      rivalFruits:
        state.rivalFruitBlockTurns > 0
          ? state.rivalFruits
          : state.rivalFruits + outcome.fruitsGained,
      status: opponentHp <= 0 ? 'won' : hit.playerHp <= 0 ? 'lost' : state.status,
    },
    log: {
      rivalAttack: outcome.totalDamage,
      absorbedByShield: hit.absorbed,
      damageToPlayer: hit.taken,
      specialsFired: outcome.specialsFired,
      poisonDealt: rivalPoison,
      extraMoveGranted: grantsExtraMove(outcome, config),
    },
  };
}

/** The rival lineup swinging for the sum of its attacks, with no bot playing. */
export function applyRivalStrike(state: BattleState): RivalResult {
  if (state.status !== 'active') {
    return {
      state,
      log: {
        rivalAttack: 0,
        absorbedByShield: 0,
        damageToPlayer: 0,
        specialsFired: [],
        poisonDealt: 0,
        extraMoveGranted: false,
      },
    };
  }

  const incoming = rivalDamage(state.rivals);
  const hit = takeHit(state, incoming);
  return {
    state: {
      ...state,
      playerHp: hit.playerHp,
      shield: hit.shield,
      status: hit.playerHp <= 0 ? 'lost' : state.status,
    },
    log: {
      rivalAttack: incoming,
      absorbedByShield: hit.absorbed,
      damageToPlayer: hit.taken,
      specialsFired: [],
      poisonDealt: 0,
      extraMoveGranted: false,
    },
  };
}

/**
 * APPLIES WHAT THE SPECIALS ASKED FOR.
 *
 * One function for both sides: `castBy` says who fired, and everything lands on
 * the other one. Writing it twice — once for the player, once for the bot —
 * is how the two drift apart until the machine is quietly playing a different
 * game, which is the one thing this battle cannot afford.
 */
export function applyPowers(
  state: BattleState,
  powers: TurnPowers,
  castBy: 'player' | 'rival',
): BattleState {
  if (state.status !== 'active') return state;

  const mine = castBy === 'player';

  /** Mana off the other side's creatures, first ones first. */
  let drained = 0;
  const drainFrom = <T extends { mana: number }>(members: readonly T[]): T[] =>
    members.map((member, index) => {
      if (index >= powers.manaDrainTargets || powers.manaDrain <= 0) return member;
      const taken = Math.min(member.mana, powers.manaDrain);
      drained += taken;
      return { ...member, mana: member.mana - taken };
    });

  /** Mana onto the caster's own bars: the boost, plus whatever was stolen. */
  const giveTo = <T extends { mana: number; manaCost: number }>(members: readonly T[]): T[] => {
    let pool = powers.manaStolen ? drained : 0;
    return members.map((member, index) => {
      const boost = index < powers.manaBoostTargets ? powers.manaBoost : 0;
      const share = Math.min(pool, member.manaCost);
      pool -= share;
      const mana = Math.min(member.manaCost, member.mana + boost + share);
      return { ...member, mana };
    });
  };

  const lock = <T extends { blockedTurns?: number; paralyzedTurns?: number }>(
    members: readonly T[],
  ): T[] =>
    members.map((member, index) => ({
      ...member,
      blockedTurns:
        index < powers.blockedTargets
          ? Math.max(member.blockedTurns ?? 0, powers.blockedTurns)
          : (member.blockedTurns ?? 0),
      paralyzedTurns:
        index < powers.paralyzedTargets
          ? Math.max(member.paralyzedTurns ?? 0, powers.paralyzedTurns)
          : (member.paralyzedTurns ?? 0),
    }));

  /** Fruit only moves what the other side actually has. */
  const theirFruits = mine ? state.rivalFruits : state.fruits;
  const stolenFruit = Math.min(powers.fruitsAbsorbed, theirFruits);

  /** Everything that does not depend on WHICH side holds which list. */
  const common = {
    fruits: mine ? state.fruits + stolenFruit : Math.max(0, state.fruits - stolenFruit),
    rivalFruits: mine
      ? Math.max(0, state.rivalFruits - stolenFruit)
      : state.rivalFruits + stolenFruit,
    /** A poison replaces a weaker one rather than stacking on top of it. */
    playerPoison: mine
      ? powers.cleanse
        ? NO_TICK
        : state.playerPoison
      : {
          perMove: Math.max(state.playerPoison.perMove, powers.poisonPerMove),
          turns: Math.max(state.playerPoison.turns, powers.poisonTurns),
        },
    rivalPoison: mine
      ? {
          perMove: Math.max(state.rivalPoison.perMove, powers.poisonPerMove),
          turns: Math.max(state.rivalPoison.turns, powers.poisonTurns),
        }
      : powers.cleanse
        ? NO_TICK
        : state.rivalPoison,
    /** CLEANSE frees the caster, it never touches the other side. */
    playerFruitBlockTurns: mine
      ? powers.cleanse
        ? 0
        : state.playerFruitBlockTurns
      : Math.max(state.playerFruitBlockTurns, powers.fruitBlockTurns),
    rivalFruitBlockTurns: mine
      ? Math.max(state.rivalFruitBlockTurns, powers.fruitBlockTurns)
      : powers.cleanse
        ? 0
        : state.rivalFruitBlockTurns,
    playerMovePenalty: mine
      ? state.playerMovePenalty
      : state.playerMovePenalty + powers.stolenMoves,
    rivalMovePenalty: mine ? state.rivalMovePenalty + powers.stolenMoves : state.rivalMovePenalty,
    /** Only YOUR extra move is spendable here; the bot budgets its own turn. */
    movesLeft: mine ? state.movesLeft + powers.extraMoves : state.movesLeft,
  };

  /**
   * The drain runs BEFORE the gift, because stealing hands over exactly what it
   * took. Written as two branches rather than one clever expression: the two
   * lists have different types, and pretending otherwise is how a rival ends up
   * boosting the player.
   */
  /** Cleanse frees the caster's own creatures from every lock on them. */
  const freed = <T extends { blockedTurns?: number; paralyzedTurns?: number }>(
    members: readonly T[],
  ): T[] =>
    powers.cleanse
      ? members.map((member) => ({ ...member, blockedTurns: 0, paralyzedTurns: 0 }))
      : [...members];

  if (mine) {
    const rivals = lock(drainFrom(state.rivals));
    return { ...state, ...common, rivals, team: freed(giveTo(state.team)) };
  }

  const team = lock(drainFrom(state.team));
  return { ...state, ...common, team, rivals: freed(giveTo(state.rivals)) };
}

/**
 * THE FIELD'S OWN TURN: life given or taken by the ground you are standing on.
 *
 * It lands on both sides at once, which is the point — a wasteland is not an
 * attack by anybody, so nothing here reads a shield or a creature. A field can
 * still END the battle, so the status is decided here too, and a draw resolves
 * as a win for the same reason your damage lands first: finishing beats trading.
 */
export function applyFieldTick(
  state: BattleState,
  tick: { player: number; opponent: number },
): { state: BattleState; log: { playerDelta: number; opponentDelta: number } } {
  if (state.status !== 'active' || (tick.player === 0 && tick.opponent === 0)) {
    return { state, log: { playerDelta: 0, opponentDelta: 0 } };
  }

  const playerHp = Math.max(0, Math.min(state.playerMaxHp, state.playerHp + tick.player));
  const opponentHp = Math.max(0, Math.min(state.opponentMaxHp, state.opponentHp + tick.opponent));

  return {
    state: {
      ...state,
      playerHp,
      opponentHp,
      status: opponentHp <= 0 ? 'won' : playerHp <= 0 ? 'lost' : state.status,
    },
    log: {
      playerDelta: playerHp - state.playerHp,
      opponentDelta: opponentHp - state.opponentHp,
    },
  };
}

/**
 * Closes the turn: the counter advances, the move budget is refilled and the
 * shield ages by one turn — used or not, which is what keeps a shield a timing
 * decision rather than a permanent wall.
 */
export function endTurn(state: BattleState, config: CombatConfig): BattleState {
  if (state.status !== 'active') return state;

  let shield = state.shield;
  let shieldTurns = state.shieldTurns;
  if (shieldTurns > 0) {
    shieldTurns -= 1;
    if (shieldTurns === 0) shield = 0;
  }

  let opponentShield = state.opponentShield;
  let opponentShieldTurns = state.opponentShieldTurns;
  if (opponentShieldTurns > 0) {
    opponentShieldTurns -= 1;
    if (opponentShieldTurns === 0) opponentShield = 0;
  }

  /** Statuses age here, once per turn, and never below zero. */
  const age = (tick: StatusTick): StatusTick => {
    if (tick.turns <= 1) return NO_TICK;
    return { perMove: tick.perMove, turns: tick.turns - 1 };
  };
  const unlock = <T extends { blockedTurns?: number; paralyzedTurns?: number }>(
    members: readonly T[],
  ): T[] =>
    members.map((member) => ({
      ...member,
      blockedTurns: Math.max(0, (member.blockedTurns ?? 0) - 1),
      paralyzedTurns: Math.max(0, (member.paralyzedTurns ?? 0) - 1),
    }));

  /**
   * A stolen move shortens the next turn, but never to nothing: a side that
   * cannot move cannot answer, and a lock with no way out is not a game.
   */
  const movesLeft = Math.max(1, config.movesPerTurn - state.playerMovePenalty);

  return {
    ...state,
    shield,
    shieldTurns,
    opponentShield,
    opponentShieldTurns,
    team: unlock(state.team),
    rivals: unlock(state.rivals),
    playerPoison: age(state.playerPoison),
    rivalPoison: age(state.rivalPoison),
    playerFruitBlockTurns: Math.max(0, state.playerFruitBlockTurns - 1),
    rivalFruitBlockTurns: Math.max(0, state.rivalFruitBlockTurns - 1),
    playerMovePenalty: 0,
    turn: state.turn + 1,
    movesLeft,
    extraMoveUsed: false,
  };
}
