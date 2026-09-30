import { describe, expect, it } from 'vitest';
import {
  NO_TICK,
  type BattleState,
  type Rival,
  applyPlayerMove,
  applyPowers,
  applyRivalMove,
  endTurn,
  startBattle,
} from '@/core/battle';
import {
  NO_POWERS,
  type Combatant,
  type TurnOutcome,
  type TurnPowers,
  convertTiles,
  findRuns,
  parseBoard,
  resolveMove,
  resolveTurn,
} from '@/core/match3';
import type { CombatConfig } from '@/core/schemas/config';

/**
 * THE POWERS.
 *
 * Each one is a promise to the player — "this takes their mana", "this bleeds
 * them for moving" — and a promise that is only in a comment is a promise
 * nobody keeps. These tests are that promise written down.
 */

const config: CombatConfig = {
  evolvedDamageMultiplier: 1.5,
  minMatchLength: 3,
  boardWidth: 7,
  boardHeight: 5,
  maxCascades: 20,
  playerMaxHp: 100,
  allowFreeSwaps: true,
  damageOnlyOnSpecial: true,
  manaPerGem: 1,
  manaBonusPerExtraGem: 2,
  botEnabled: true,
  botSkill: 0.75,
  movesPerTurn: 2,
  extraMoveMinRun: 4,
  extraMovesPerTurn: 1,
  startingManaPercent: 40,
  rivalManaCostPercent: 70,
  fruitsToEvolve: 6,
  tileWeights: { fire: 4, water: 4, plant: 4, psychic: 4, food: 3, drakofruta: 2 },
};

const member = (over: Partial<Combatant> = {}): Combatant => ({
  creatureId: 'c1',
  baseElement: 'fire',
  baseAttack: 10,
  pathAttackBonus: 0,
  isEvolved: false,
  effects: [],
  manaCost: 10,
  mana: 0,
  ...over,
});

const rival = (over: Partial<Rival> = {}): Rival => ({
  id: 'r1',
  name: 'Sombra',
  element: 'water',
  attack: 8,
  manaCost: 10,
  mana: 0,
  ...over,
});

const outcome = (over: Partial<TurnOutcome> = {}): TurnOutcome => ({
  attacks: [],
  totalDamage: 0,
  totalHeal: 0,
  totalShield: 0,
  specialsFired: [],
  foodGained: 0,
  fruitsGained: 0,
  totalPierce: 0,
  gemsByElement: { fire: 0, water: 0, plant: 0, psychic: 0 },
  longestCombo: 0,
  cascades: 0,
  powers: NO_POWERS,
  ...over,
});

const powers = (over: Partial<TurnPowers> = {}): TurnPowers => ({ ...NO_POWERS, ...over });

const battle = (over: { team?: Combatant[]; rivals?: Rival[] } = {}): BattleState =>
  startBattle({
    team: over.team ?? [member(), member({ creatureId: 'c2', baseElement: 'water' })],
    rivals: over.rivals ?? [rival(), rival({ id: 'r2', name: 'Eco' })],
    config,
  });

describe('mana drain', () => {
  it('takes mana off as many enemies as the power reaches', () => {
    const state = battle({
      rivals: [rival({ mana: 8 }), rival({ id: 'r2', mana: 8 })],
    });

    const one = applyPowers(state, powers({ manaDrain: 5, manaDrainTargets: 1 }), 'player');
    expect(one.rivals.map((r) => r.mana)).toEqual([3, 8]);

    const both = applyPowers(state, powers({ manaDrain: 5, manaDrainTargets: 2 }), 'player');
    expect(both.rivals.map((r) => r.mana)).toEqual([3, 3]);
  });

  it('never takes more than the bar holds', () => {
    const state = battle({ rivals: [rival({ mana: 2 })] });
    const drained = applyPowers(state, powers({ manaDrain: 9, manaDrainTargets: 1 }), 'player');
    expect(drained.rivals[0]?.mana).toBe(0);
  });

  it('STEALING hands the same mana to your own bars', () => {
    const state = battle({
      team: [member({ mana: 0, manaCost: 10 })],
      rivals: [rival({ mana: 6 })],
    });

    const stolen = applyPowers(
      state,
      powers({ manaDrain: 6, manaDrainTargets: 1, manaStolen: true }),
      'player',
    );
    expect(stolen.rivals[0]?.mana).toBe(0);
    expect(stolen.team[0]?.mana).toBe(6);
  });

  it('burning it leaves your own bars alone', () => {
    const state = battle({ team: [member({ mana: 1 })], rivals: [rival({ mana: 6 })] });
    const burnt = applyPowers(state, powers({ manaDrain: 6, manaDrainTargets: 1 }), 'player');
    expect(burnt.team[0]?.mana).toBe(1);
  });

  it('works the same way when the BOT casts it', () => {
    const state = battle({ team: [member({ mana: 7 })], rivals: [rival({ mana: 0 })] });
    const drained = applyPowers(
      state,
      powers({ manaDrain: 4, manaDrainTargets: 1, manaStolen: true }),
      'rival',
    );
    expect(drained.team[0]?.mana).toBe(3);
    expect(drained.rivals[0]?.mana).toBe(4);
  });
});

describe('mana boost', () => {
  it('fills your own bars and never past their cost', () => {
    const state = battle({
      team: [member({ mana: 8, manaCost: 10 }), member({ creatureId: 'c2', mana: 0 })],
    });
    const boosted = applyPowers(state, powers({ manaBoost: 5, manaBoostTargets: 2 }), 'player');
    expect(boosted.team.map((m) => m.mana)).toEqual([10, 5]);
  });
});

describe('absorbing fruit', () => {
  it('moves it from their bar to yours', () => {
    const state = { ...battle(), fruits: 1, rivalFruits: 4 };
    const taken = applyPowers(state, powers({ fruitsAbsorbed: 3 }), 'player');
    expect(taken.fruits).toBe(4);
    expect(taken.rivalFruits).toBe(1);
  });

  it('cannot take fruit they do not have', () => {
    const state = { ...battle(), fruits: 0, rivalFruits: 1 };
    const taken = applyPowers(state, powers({ fruitsAbsorbed: 5 }), 'player');
    expect(taken.fruits).toBe(1);
    expect(taken.rivalFruits).toBe(0);
  });
});

describe('the turn itself', () => {
  it('an extra move is spendable right now', () => {
    const state = battle();
    expect(applyPowers(state, powers({ extraMoves: 1 }), 'player').movesLeft).toBe(3);
  });

  it('a stolen move shortens the rival NEXT turn, not this one', () => {
    const state = applyPowers(battle(), powers({ stolenMoves: 1 }), 'player');
    expect(state.rivalMovePenalty).toBe(1);
    expect(state.movesLeft).toBe(2);
  });

  it('a turn never starts with nothing to do', () => {
    /** Two moves stolen from a two-move turn would be a lock, not a play. */
    const robbed = { ...battle(), playerMovePenalty: 5 };
    expect(endTurn(robbed, config).movesLeft).toBe(1);
  });

  it('the penalty is spent, not kept', () => {
    const robbed = { ...battle(), playerMovePenalty: 1 };
    expect(endTurn(robbed, config).playerMovePenalty).toBe(0);
  });
});

describe('poison', () => {
  it('bleeds the poisoned side once per MOVE it makes', () => {
    const poisoned = applyPowers(battle(), powers({ poisonPerMove: 3, poisonTurns: 2 }), 'rival');
    expect(poisoned.playerPoison).toEqual({ perMove: 3, turns: 2 });

    const moved = applyPlayerMove(poisoned, outcome(), config);
    expect(moved.log.poisonTaken).toBe(3);
    expect(moved.state.playerHp).toBe(97);

    /** And again on the next move: the cost is per move, not per turn. */
    const again = applyPlayerMove(moved.state, outcome(), config);
    expect(again.state.playerHp).toBe(94);
  });

  it('bleeds the RIVAL when you are the one who cast it', () => {
    const poisoned = applyPowers(battle(), powers({ poisonPerMove: 4, poisonTurns: 1 }), 'player');
    const answered = applyRivalMove(poisoned, outcome(), config);
    expect(answered.log.poisonDealt).toBe(4);
    expect(answered.state.opponentHp).toBe(96);
  });

  it('runs out, and does not stack into something stronger', () => {
    const once = applyPowers(battle(), powers({ poisonPerMove: 3, poisonTurns: 1 }), 'rival');
    const twice = applyPowers(once, powers({ poisonPerMove: 2, poisonTurns: 1 }), 'rival');
    /** The stronger tick survives; two poisons are not five. */
    expect(twice.playerPoison.perMove).toBe(3);

    expect(endTurn(twice, config).playerPoison).toEqual(NO_TICK);
  });

  it('can finish a battle on its own', () => {
    const dying = {
      ...battle(),
      playerHp: 2,
      playerPoison: { perMove: 5, turns: 3 },
    };
    const moved = applyPlayerMove(dying, outcome(), config);
    expect(moved.state.playerHp).toBe(0);
    expect(moved.state.status).toBe('lost');
  });
});

describe('locks', () => {
  const fireMatch = () => {
    const result = resolveMove(
      parseBoard('pff\nfww\nwpp'),
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { minMatchLength: 3, maxCascades: 0 },
      () => 0.7,
    );
    if (!result.ok) throw new Error('fixture move was refused');
    return result;
  };

  it('BLOCKED: it fires, and the blow is caught', () => {
    const blocked = resolveTurn({
      move: fireMatch(),
      team: [member({ mana: 9, manaCost: 10, blockedTurns: 1, effects: [
        { type: 'damage', target: 'enemy', value: 30 },
      ] })],
      enemyElements: ['water'],
      config,
    });

    expect(blocked.attacks[0]?.charged).toBe(true);
    expect(blocked.totalDamage).toBe(0);
  });

  it('PARALYZED: the bar does not move at all', () => {
    const stuck = resolveTurn({
      move: fireMatch(),
      team: [member({ mana: 9, manaCost: 10, paralyzedTurns: 1 })],
      enemyElements: ['water'],
      config,
    });

    expect(stuck.attacks[0]?.manaGained).toBe(0);
    expect(stuck.attacks[0]?.manaAfter).toBe(9);
    expect(stuck.attacks[0]?.charged).toBe(false);
  });

  it('lands on as many enemies as the power reaches, and wears off', () => {
    const locked = applyPowers(
      battle(),
      powers({ blockedTargets: 1, blockedTurns: 1, paralyzedTargets: 2, paralyzedTurns: 2 }),
      'player',
    );
    expect(locked.rivals.map((r) => r.blockedTurns)).toEqual([1, 0]);
    expect(locked.rivals.map((r) => r.paralyzedTurns)).toEqual([2, 2]);

    const later = endTurn(locked, config);
    expect(later.rivals.map((r) => r.blockedTurns)).toEqual([0, 0]);
    expect(later.rivals.map((r) => r.paralyzedTurns)).toEqual([1, 1]);
  });
});

describe('painting the board', () => {
  const board = parseBoard('fwpf\nwpfw\npfwp\nfwpf');

  it('turns tiles into the asked-for kind', () => {
    const painted = convertTiles(board, 'fire', 3, 3, () => 0.31);
    const fires = painted.board.tiles.filter((tile) => tile === 'fire').length;
    expect(fires).toBeGreaterThan(board.tiles.filter((tile) => tile === 'fire').length);
  });

  it('NEVER leaves an alignment the player did not make', () => {
    /** A pre-matched board resolves runs nobody played on the next move. */
    for (let seed = 1; seed <= 30; seed += 1) {
      let value = seed;
      const random = () => {
        value = (value * 1664525 + 1013904223) % 4294967296;
        return value / 4294967296;
      };
      const painted = convertTiles(board, 'fire', 6, 3, random);
      expect(findRuns(painted.board, 3)).toHaveLength(0);
    }
  });

  it('reports which cells changed, so the browser can show them', () => {
    const painted = convertTiles(board, 'psychic', 2, 3, () => 0.51);
    for (const index of painted.changed) {
      expect(painted.board.tiles[index]).toBe('psychic');
    }
  });
});

describe('piercing damage', () => {
  it('walks past a shield that would have eaten a normal blow', () => {
    const shielded = { ...battle(), shield: 30 };

    const normal = applyRivalMove(shielded, outcome({ totalDamage: 20 }), config);
    expect(normal.log.damageToPlayer).toBe(0);
    expect(normal.state.playerHp).toBe(100);

    const pierced = applyRivalMove(shielded, outcome({ totalPierce: 20 }), config);
    expect(pierced.log.damageToPlayer).toBe(20);
    expect(pierced.state.playerHp).toBe(80);
    /** And it does not spend the shield either: it simply ignored it. */
    expect(pierced.state.shield).toBe(30);
  });

  it('goes through the RIVAL shield too, in the other direction', () => {
    const turtled = { ...battle(), opponentShield: 25 };

    const normal = applyPlayerMove(turtled, outcome({ totalDamage: 20 }), config);
    expect(normal.log.damageToOpponent).toBe(0);
    expect(normal.state.opponentShield).toBe(5);

    const pierced = applyPlayerMove(turtled, outcome({ totalPierce: 20 }), config);
    expect(pierced.log.damageToOpponent).toBe(20);
    expect(pierced.state.opponentShield).toBe(25);
  });

  it('survives a BLOCK, while the rest of the attack is caught', () => {
    const blocked = resolveTurn({
      move: (() => {
        const result = resolveMove(
          parseBoard('pff\nfww\nwpp'),
          { row: 0, col: 0 },
          { row: 1, col: 0 },
          { minMatchLength: 3, maxCascades: 0 },
          () => 0.7,
        );
        if (!result.ok) throw new Error('fixture move was refused');
        return result;
      })(),
      team: [
        member({
          mana: 9,
          manaCost: 10,
          blockedTurns: 1,
          effects: [
            { type: 'damage', target: 'enemy', value: 25 },
            { type: 'damage_by_type', target: 'enemy', value: 40, condition: { enemy_element: 'water' } },
          ],
        }),
      ],
      enemyElements: ['water'],
      config,
    });

    /** The blockable half is caught; the needle lands. */
    expect(blocked.totalDamage).toBe(0);
    expect(blocked.totalPierce).toBe(25);
  });

  it('the bot can hold a shield of its own', () => {
    const defended = applyRivalMove(battle(), outcome({ totalShield: 18 }), config);
    expect(defended.state.opponentShield).toBe(18);
  });
});
