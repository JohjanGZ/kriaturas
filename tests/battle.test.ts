import { describe, expect, it } from 'vitest';
import { type Rival, applyTurn, rivalDamage, startBattle } from '@/core/battle';
import type { Combatant, TurnOutcome } from '@/core/match3';
import type { CombatConfig } from '@/core/schemas/config';

const config: CombatConfig = {
  evolvedDamageMultiplier: 1.5,
  minMatchLength: 3,
  boardWidth: 7,
  boardHeight: 5,
  maxCascades: 20,
  playerMaxHp: 100,
  allowFreeSwaps: true,
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
  gemsByElement: { fire: 0, water: 0, plant: 0, psychic: 0 },
  longestCombo: 0,
  cascades: 0,
  ...over,
});

const battle = (over: { team?: Combatant[]; rivals?: Rival[] } = {}) =>
  startBattle({
    team: over.team ?? [member()],
    rivals: over.rivals ?? [rival()],
    config,
  });

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

  it('refuses a battle with no rival creatures', () => {
    expect(() => startBattle({ team: [member()], rivals: [], config })).toThrow(/at least one/);
  });
});

describe('rivalDamage', () => {
  it('adds up the whole rival lineup', () => {
    expect(rivalDamage([rival({ attack: 6 }), rival({ id: 'r2', attack: 4 })])).toBe(10);
  });

  it('ignores a negative attack instead of healing the player', () => {
    expect(rivalDamage([rival({ attack: -50 })])).toBe(0);
  });
});

describe('applyTurn — damage goes to the PLAYERS', () => {
  it('hits the rival player, and the rival lineup hits back', () => {
    const state = battle({ rivals: [rival({ attack: 6 }), rival({ id: 'r2', attack: 4 })] });
    const { state: next, log } = applyTurn(state, outcome({ totalDamage: 20 }));

    expect(log.damageToOpponent).toBe(20);
    expect(next.opponentHp).toBe(80);
    expect(log.rivalAttack).toBe(10); // both rivals answer
    expect(next.playerHp).toBe(90);
    expect(next.status).toBe('active');
  });

  it('never damages a creature — they have no health at all', () => {
    const state = battle();
    const next = applyTurn(state, outcome({ totalDamage: 40 })).state;
    for (const foe of next.rivals) {
      expect(foe).not.toHaveProperty('hp');
    }
    expect(next.opponentHp).toBe(60);
  });

  it('wins when the rival player is emptied, and takes no counterattack that turn', () => {
    const state = battle({ rivals: [rival({ attack: 40 })] });
    const { state: next, log } = applyTurn(state, outcome({ totalDamage: 250 }));

    expect(log.damageToOpponent).toBe(100); // never more than they had
    expect(next.opponentHp).toBe(0);
    expect(log.rivalAttack).toBe(0);
    expect(next.playerHp).toBe(100);
    expect(next.status).toBe('won');
  });

  it('loses when your own health runs out, and never goes below zero', () => {
    const state = battle({ rivals: [rival({ attack: 250 })] });
    const { state: next } = applyTurn(state, outcome({ totalDamage: 1 }));
    expect(next.playerHp).toBe(0);
    expect(next.status).toBe('lost');
  });

  it('ignores further turns once the battle is over', () => {
    const won = applyTurn(battle(), outcome({ totalDamage: 100 })).state;
    expect(won.status).toBe('won');

    const after = applyTurn(won, outcome({ totalDamage: 999 }));
    expect(after.state.opponentHp).toBe(won.opponentHp);
    expect(after.state.turn).toBe(won.turn);
  });
});

describe('applyTurn — heal and shield', () => {
  it('heals but never above the fixed maximum', () => {
    const state = battle({ rivals: [rival({ attack: 40 })] });
    const hurt = applyTurn(state, outcome({ totalDamage: 1 })).state;
    expect(hurt.playerHp).toBe(60);

    const healed = applyTurn(hurt, outcome({ totalDamage: 1, totalHeal: 9999 }));
    expect(healed.log.healed).toBe(40); // only what was missing
    expect(healed.state.playerHp).toBe(60); // healed to full, then hit again
  });

  it('a shield absorbs the blow before health does', () => {
    const state = battle({ rivals: [rival({ attack: 12 })] });
    const { state: next, log } = applyTurn(
      state,
      outcome({
        totalDamage: 1,
        totalShield: 20,
        attacks: [{ shieldTurns: 2 } as never],
      }),
    );

    expect(log.absorbedByShield).toBe(12);
    expect(log.damageToPlayer).toBe(0);
    expect(next.playerHp).toBe(100);
    expect(next.shield).toBe(8);
  });

  it('the shield expires after its turns, used or not', () => {
    const state = battle({ rivals: [rival({ attack: 1 })] });
    const shielded = applyTurn(
      state,
      outcome({ totalShield: 50, attacks: [{ shieldTurns: 1 } as never] }),
    ).state;
    expect(shielded.shield).toBe(0);
  });
});

describe('applyTurn — mana', () => {
  it('carries each creature mana into the next turn', () => {
    const state = battle({
      team: [member({ creatureId: 'c1' }), member({ creatureId: 'c2', baseElement: 'water' })],
    });

    const next = applyTurn(
      state,
      outcome({ totalDamage: 5, attacks: [{ creatureId: 'c1', manaAfter: 4 } as never] }),
    ).state;

    expect(next.team.find((m) => m.creatureId === 'c1')?.mana).toBe(4);
    // c2 was not on the board this turn, so its bar is untouched.
    expect(next.team.find((m) => m.creatureId === 'c2')?.mana).toBe(0);
  });
});
