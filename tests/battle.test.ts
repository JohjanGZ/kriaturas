import { describe, expect, it } from 'vitest';
import {
  type Rival,
  applyPlayerMove,
  applyRivalMove,
  applyRivalStrike,
  endTurn,
  grantsExtraMove,
  rivalDamage,
  startBattle,
} from '@/core/battle';
import { NO_POWERS, type Combatant, type TurnOutcome } from '@/core/match3';
import type { CombatConfig } from '@/core/schemas/config';

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
  manaCost: 6,
  mana: 0,
  ...over,
});

const rival = (over: Partial<Rival> = {}): Rival => ({
  id: 'r1',
  name: 'Sombra',
  element: 'water',
  attack: 6,
  manaCost: 6,
  mana: 0,
  ...over,
});

/** A hand-made turn outcome, so battle rules are tested without the board. */
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

const battle = (over: { team?: Combatant[]; rivals?: Rival[] } = {}) =>
  startBattle({
    team: over.team ?? [member()],
    rivals: over.rivals ?? [rival()],
    config,
  });

/** One player move, for tests that do not care about the move budget. */
const play = (state: ReturnType<typeof battle>, over: Partial<TurnOutcome> = {}) =>
  applyPlayerMove(state, outcome(over), config);

describe('startBattle', () => {
  it('gives both players the same fixed health', () => {
    const state = battle();
    expect(state.playerMaxHp).toBe(100);
    expect(state.opponentMaxHp).toBe(100);
    expect(state.playerHp).toBe(state.opponentHp);
  });

  it('does not depend on the lineup', () => {
    const weak = battle({ team: [member({ baseAttack: 1 })] });
    const strong = battle({
      team: [member({ baseAttack: 999 }), member({ creatureId: 'c2', baseAttack: 999 })],
    });
    expect(weak.playerMaxHp).toBe(strong.playerMaxHp);
    expect(weak.opponentMaxHp).toBe(strong.opponentMaxHp);
  });

  it('opens the turn with the configured move budget', () => {
    const state = battle();
    expect(state.movesLeft).toBe(2);
    expect(state.extraMoveUsed).toBe(false);
  });

  it('refuses a battle with no rival creatures', () => {
    expect(() => startBattle({ team: [member()], rivals: [], config })).toThrow(/at least one/);
  });
});

describe('the move budget', () => {
  it('spends one move per play and ends the turn when they run out', () => {
    const first = play(battle());
    expect(first.log.movesLeft).toBe(1);
    expect(first.log.turnOver).toBe(false);

    const second = play(first.state);
    expect(second.log.movesLeft).toBe(0);
    expect(second.log.turnOver).toBe(true);
  });

  it('a run of four or more buys one extra move', () => {
    const { state, log } = play(battle(), { longestCombo: 4 });
    expect(log.extraMoveGranted).toBe(true);
    expect(log.movesLeft).toBe(2); // 2 - 1 + 1
    expect(state.extraMoveUsed).toBe(true);
  });

  it('grants the bonus ONCE per turn, however many big runs you make', () => {
    const first = play(battle(), { longestCombo: 5 });
    const second = applyPlayerMove(first.state, outcome({ longestCombo: 5 }), config);
    expect(second.log.extraMoveGranted).toBe(false);
    expect(second.log.movesLeft).toBe(1);
  });

  it('a run shorter than the threshold buys nothing', () => {
    expect(grantsExtraMove(outcome({ longestCombo: 3 }), config)).toBe(false);
    expect(grantsExtraMove(outcome({ longestCombo: 4 }), config)).toBe(true);
  });

  it('endTurn refills the budget and clears the bonus flag', () => {
    const spent = play(play(battle()).state).state;
    const next = endTurn(spent, config);
    expect(next.movesLeft).toBe(2);
    expect(next.extraMoveUsed).toBe(false);
    expect(next.turn).toBe(spent.turn + 1);
  });
});

describe('damage goes to the PLAYERS', () => {
  it('hits the rival player and never a creature', () => {
    const { state, log } = play(battle(), { totalDamage: 20 });
    expect(log.damageToOpponent).toBe(20);
    expect(state.opponentHp).toBe(80);
    for (const foe of state.rivals) expect(foe).not.toHaveProperty('hp');
  });

  it('wins when the rival player is emptied, and the turn ends there', () => {
    const { state, log } = play(battle(), { totalDamage: 250 });
    expect(log.damageToOpponent).toBe(100); // never more than they had
    expect(state.opponentHp).toBe(0);
    expect(state.status).toBe('won');
    expect(log.turnOver).toBe(true);
  });

  it('the bot only hurts you when ITS bar filled', () => {
    const state = play(play(battle()).state).state;

    const quiet = applyRivalMove(state, outcome({ totalDamage: 0 }), config);
    expect(quiet.log.damageToPlayer).toBe(0);
    expect(quiet.state.playerHp).toBe(100);

    const special = applyRivalMove(state, outcome({ totalDamage: 30 }), config);
    expect(special.log.damageToPlayer).toBe(30);
    expect(special.state.playerHp).toBe(70);
  });

  it('loses when your own health runs out, and never goes below zero', () => {
    const state = play(play(battle()).state).state;
    const hit = applyRivalMove(state, outcome({ totalDamage: 250 }), config);
    expect(hit.state.playerHp).toBe(0);
    expect(hit.state.status).toBe('lost');
  });

  it('carries the bot mana between its moves', () => {
    const state = battle({ rivals: [rival({ id: 'r1' }), rival({ id: 'r2' })] });
    const next = applyRivalMove(
      state,
      outcome({ attacks: [{ creatureId: 'r1', manaAfter: 4 } as never] }),
      config,
    ).state;

    expect(next.rivals.find((r) => r.id === 'r1')?.mana).toBe(4);
    expect(next.rivals.find((r) => r.id === 'r2')?.mana).toBe(0);
  });

  it('ignores further moves once the battle is over', () => {
    const won = play(battle(), { totalDamage: 100 }).state;
    expect(won.status).toBe('won');

    const after = applyPlayerMove(won, outcome({ totalDamage: 999 }), config);
    expect(after.state.opponentHp).toBe(won.opponentHp);
    expect(after.state.movesLeft).toBe(won.movesLeft);
  });
});

describe('the rival lineup with the bot switched off', () => {
  it('adds up the whole lineup', () => {
    expect(rivalDamage([rival({ attack: 6 }), rival({ id: 'r2', attack: 4 })])).toBe(10);
  });

  it('ignores a negative attack instead of healing the player', () => {
    expect(rivalDamage([rival({ attack: -50 })])).toBe(0);
  });

  it('swings for the sum of its attacks', () => {
    const state = battle({ rivals: [rival({ attack: 6 }), rival({ id: 'r2', attack: 4 })] });
    const { state: next, log } = applyRivalStrike(state);
    expect(log.rivalAttack).toBe(10);
    expect(next.playerHp).toBe(90);
  });
});

describe('heal and shield', () => {
  it('heals but never above the fixed maximum', () => {
    const hurt = applyRivalMove(battle(), outcome({ totalDamage: 40 }), config).state;
    expect(hurt.playerHp).toBe(60);

    const healed = applyPlayerMove(hurt, outcome({ totalHeal: 9999 }), config);
    expect(healed.log.healed).toBe(40); // only what was missing
    expect(healed.state.playerHp).toBe(100);
  });

  it('a shield absorbs the blow before health does', () => {
    const shielded = applyPlayerMove(
      battle(),
      outcome({ totalShield: 20, attacks: [{ shieldTurns: 2 } as never] }),
      config,
    ).state;

    const { state: next, log } = applyRivalMove(shielded, outcome({ totalDamage: 12 }), config);
    expect(log.absorbedByShield).toBe(12);
    expect(log.damageToPlayer).toBe(0);
    expect(next.playerHp).toBe(100);
    expect(next.shield).toBe(8);
  });

  it('the shield expires after its turns, used or not', () => {
    const shielded = applyPlayerMove(
      battle(),
      outcome({ totalShield: 50, attacks: [{ shieldTurns: 1 } as never] }),
      config,
    ).state;
    expect(endTurn(shielded, config).shield).toBe(0);
  });
});

describe('mana', () => {
  it('carries each creature mana into the next turn', () => {
    const state = battle({
      team: [member({ creatureId: 'c1' }), member({ creatureId: 'c2', baseElement: 'water' })],
    });

    const next = play(state, {
      totalDamage: 5,
      attacks: [{ creatureId: 'c1', manaAfter: 4 } as never],
    }).state;

    expect(next.team.find((m) => m.creatureId === 'c1')?.mana).toBe(4);
    // c2 was not on the board this turn, so its bar is untouched.
    expect(next.team.find((m) => m.creatureId === 'c2')?.mana).toBe(0);
  });
});
