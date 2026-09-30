import { describe, expect, it } from 'vitest';
import {
  FIELD_KINDS,
  FIELD_TUNING,
  type BattleField,
  afterMove,
  afterTurn,
  armField,
  blastRadius,
  createPlayableBoard,
  findRuns,
  hasValidMove,
  parseBoard,
  rollField,
  settleQuietly,
  tileBag,
  tuneCombat,
  turnTick,
} from '@/core';
import type { CombatConfig } from '@/core/schemas/config';

const combat: CombatConfig = {
  evolvedDamageMultiplier: 1.5,
  minMatchLength: 3,
  boardWidth: 7,
  boardHeight: 5,
  maxCascades: 20,
  playerMaxHp: 120,
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

const field = (over: Partial<BattleField> = {}): BattleField => ({
  kind: 'remolino',
  element: null,
  bombs: [],
  ...over,
});

/** A settled 7x5 board with no alignment on it, for the stirring tests. */
const kinds = tileBag(combat.tileWeights);
const board = () =>
  createPlayableBoard(
    {
      width: combat.boardWidth,
      height: combat.boardHeight,
      minMatchLength: combat.minMatchLength,
      kinds,
    },
    fixedRandom(),
  );

/** Deterministic enough to be repeatable, varied enough to shuffle. */
function fixedRandom(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('rolling a field', () => {
  it('only ever rolls a kind that exists', () => {
    const random = fixedRandom(3);
    for (let i = 0; i < 200; i += 1) {
      expect(FIELD_KINDS).toContain(rollField(random).kind);
    }
  });

  it('gives the volcano an element and nobody else one', () => {
    const random = fixedRandom(11);
    for (let i = 0; i < 200; i += 1) {
      const rolled = rollField(random);
      if (rolled.kind === 'volcan') expect(rolled.element).not.toBeNull();
      else expect(rolled.element).toBeNull();
    }
  });
});

describe('the five fields that are only numbers', () => {
  it('floods the volcano with its own element and leaves the rest alone', () => {
    const tuned = tuneCombat(combat, field({ kind: 'volcan', element: 'water' }));
    expect(tuned.tileWeights.water).toBe(combat.tileWeights.water * FIELD_TUNING.floodMultiplier);
    expect(tuned.tileWeights.fire).toBe(combat.tileWeights.fire);
  });

  it('DRIES THE FRUIT UP entirely: a drought deals none at all', () => {
    const tuned = tuneCombat(combat, field({ kind: 'sequia' }));
    expect(tuned.tileWeights.drakofruta).toBe(0);
    /** And the bag really holds none, which is what the board is dealt from. */
    expect(tileBag(tuned.tileWeights)).not.toContain('drakofruta');
    /** The elements survive: a drought is not an empty board. */
    expect(tileBag(tuned.tileWeights)).toContain('fire');
  });

  it('pays the orchard triple fruit', () => {
    const tuned = tuneCombat(combat, field({ kind: 'vergel' }));
    expect(tuned.tileWeights.drakofruta).toBe(
      combat.tileWeights.drakofruta * FIELD_TUNING.floodMultiplier,
    );
  });

  it('gives the duel ONE move and doubles what a gem is worth', () => {
    const tuned = tuneCombat(combat, field({ kind: 'duelo' }));
    expect(tuned.movesPerTurn).toBe(1);
    expect(tuned.manaPerGem).toBe(combat.manaPerGem * 2);
    expect(tuned.manaBonusPerExtraGem).toBe(combat.manaBonusPerExtraGem * 2);
  });

  it('pays resonance only for the gems PAST the minimum', () => {
    const tuned = tuneCombat(combat, field({ kind: 'resonancia' }));
    expect(tuned.manaPerGem).toBe(combat.manaPerGem);
    expect(tuned.manaBonusPerExtraGem).toBeGreaterThan(combat.manaBonusPerExtraGem);
  });

  it('leaves the ordinary battle untouched when there is no field', () => {
    expect(tuneCombat(combat, null)).toEqual(combat);
  });
});

describe('the fields that tick life', () => {
  it('heals both sides in the sanctuary and hurts both in the wasteland', () => {
    expect(turnTick(field({ kind: 'santuario' }))).toEqual({
      player: FIELD_TUNING.sanctuaryHeal,
      opponent: FIELD_TUNING.sanctuaryHeal,
    });
    const wasteland = turnTick(field({ kind: 'paramo' }));
    expect(wasteland.player).toBeLessThan(0);
    expect(wasteland.opponent).toBe(wasteland.player);
  });

  it('does nothing on every other field, and on none at all', () => {
    expect(turnTick(field({ kind: 'remolino' }))).toEqual({ player: 0, opponent: 0 });
    expect(turnTick(null)).toEqual({ player: 0, opponent: 0 });
  });
});

describe('the minefield', () => {
  it('arms its mines only on the minefield', () => {
    const armed = armField(board(), field({ kind: 'minado' }), fixedRandom(5));
    expect(armed.bombs).toHaveLength(FIELD_TUNING.bombCount);
    expect(armed.bombs.every((bomb) => bomb.fuse === FIELD_TUNING.bombFuse)).toBe(true);

    expect(armField(board(), field({ kind: 'vergel' }), fixedRandom(5)).bombs).toEqual([]);
  });

  it('burns one notch per MOVE, whoever made it', () => {
    const armed = armField(board(), field({ kind: 'minado' }), fixedRandom(5));
    const after = afterMove(board(), armed, combat, kinds, fixedRandom(9));
    expect(after.field?.bombs.every((bomb) => bomb.fuse === FIELD_TUNING.bombFuse - 1)).toBe(true);
    expect(after.detonated).toEqual([]);
  });

  it('takes the square around it when the fuse runs out, and re-arms elsewhere', () => {
    const start = board();
    const armed: BattleField = field({ kind: 'minado', bombs: [{ at: 16, fuse: 1 }] });

    const blown = afterMove(start, armed, combat, kinds, fixedRandom(21));

    /** A 3x3 in the middle of a 7x5 board: nine cells, none clipped. */
    expect(blown.detonated).toHaveLength(9);
    expect(new Set(blown.detonated)).toEqual(new Set(blastRadius(start, 16, 1)));
    /** The field stays dangerous: a new mine replaces the one that went off. */
    expect(blown.field?.bombs).toHaveLength(1);
    expect(blown.field?.bombs[0]?.fuse).toBe(FIELD_TUNING.bombFuse);
  });

  it('clips the blast at the edge instead of wrapping around', () => {
    const start = board();
    /** Cell 0 is the top-left corner: only four cells exist around it. */
    expect(blastRadius(start, 0, 1)).toHaveLength(4);
    expect(blastRadius(start, 0, 1)).toEqual([0, 1, 7, 8]);
  });

  it('leaves the board SETTLED after an explosion, so nobody is paid for it', () => {
    const blown = afterMove(
      board(),
      field({ kind: 'minado', bombs: [{ at: 16, fuse: 1 }] }),
      combat,
      kinds,
      fixedRandom(33),
    );
    expect(findRuns(blown.board, combat.minMatchLength)).toEqual([]);
  });

  it('does nothing at all on a field that has no mines', () => {
    const start = board();
    const quiet = afterMove(start, field({ kind: 'santuario' }), combat, kinds, fixedRandom(4));
    expect(quiet.board).toEqual(start);
    expect(quiet.detonated).toEqual([]);
  });
});

describe('settling in silence', () => {
  it('swallows an alignment that was already there, and reports how much', () => {
    /** Three fire in the bottom row, placed by hand. */
    const loaded = parseBoard('wpsw\nsowp\npwso');
    const settled = settleQuietly(
      { ...loaded, tiles: [...loaded.tiles.slice(0, 8), 'fire', 'fire', 'fire', 'water'] },
      combat,
      kinds,
      fixedRandom(2),
    );
    expect(settled.swallowed).toBeGreaterThanOrEqual(3);
    expect(findRuns(settled.board, combat.minMatchLength)).toEqual([]);
  });
});

describe('the fields that stir the board between turns', () => {
  it('moves every tile in the whirlwind and still hands back a playable board', () => {
    const start = board();
    const stirred = afterTurn(start, field({ kind: 'remolino' }), combat, kinds, fixedRandom(13));

    expect(stirred.stirred).toBe('shuffled');
    expect(stirred.board.tiles).not.toEqual(start.tiles);
    /** The two things a field may never do: pay for nothing, or deadlock. */
    expect(findRuns(stirred.board, combat.minMatchLength)).toEqual([]);
    expect(hasValidMove(stirred.board, combat.minMatchLength)).toBe(true);
  });

  it('rolls one column in the gale, not the whole board', () => {
    const start = board();
    const blown = afterTurn(start, field({ kind: 'vendaval' }), combat, kinds, fixedRandom(17));

    expect(blown.stirred).toBe('gale');
    expect(findRuns(blown.board, combat.minMatchLength)).toEqual([]);
    expect(hasValidMove(blown.board, combat.minMatchLength)).toBe(true);

    const movedColumns = new Set<number>();
    blown.board.tiles.forEach((tile, index) => {
      if (tile !== start.tiles[index]) movedColumns.add(index % start.width);
    });
    /** A single column moved — or none did, if the roll landed on itself. */
    expect(movedColumns.size).toBeLessThanOrEqual(1);
  });

  it('leaves the board alone on a field that does not stir it', () => {
    const start = board();
    for (const kind of ['minado', 'volcan', 'santuario', 'duelo'] as const) {
      const still = afterTurn(start, field({ kind }), combat, kinds, fixedRandom(6));
      expect(still.board).toEqual(start);
      expect(still.stirred).toBeNull();
    }
    expect(afterTurn(start, null, combat, kinds, fixedRandom(6)).board).toEqual(start);
  });
});

/**
 * THE DRAW IS A ROW NOW. A field that turns out to be unfun is switched off
 * from the panel, and one that is merely strong just comes up less — both
 * without a deploy. These pin that the weighting is real and that turning
 * everything off cannot break the game.
 */
describe('rollField with a catalogue behind it', () => {
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  };

  it('never rolls a field that is not offered', () => {
    const random = seeded(4);
    const offered = [
      { kind: 'duelo' as const, weight: 1 },
      { kind: 'sequia' as const, weight: 1 },
    ];
    for (let i = 0; i < 200; i += 1) {
      expect(['duelo', 'sequia']).toContain(rollField(random, offered).kind);
    }
  });

  it('respects the weights: ten to one shows up as roughly ten to one', () => {
    const random = seeded(11);
    let duelo = 0;
    let sequia = 0;
    for (let i = 0; i < 2000; i += 1) {
      const rolled = rollField(random, [
        { kind: 'duelo', weight: 10 },
        { kind: 'sequia', weight: 1 },
      ]);
      if (rolled.kind === 'duelo') duelo += 1;
      if (rolled.kind === 'sequia') sequia += 1;
    }
    expect(duelo).toBeGreaterThan(sequia * 5);
  });

  it('a weight of zero is the same as not being offered', () => {
    const random = seeded(7);
    for (let i = 0; i < 100; i += 1) {
      const rolled = rollField(random, [
        { kind: 'duelo', weight: 0 },
        { kind: 'vergel', weight: 3 },
      ]);
      expect(rolled.kind).toBe('vergel');
    }
  });

  it('EVERY field switched off falls back instead of throwing', () => {
    /** An empty catalogue is a panel mistake, not a reason to refuse a battle. */
    const rolled = rollField(seeded(2), []);
    expect(FIELD_KINDS).toContain(rolled.kind);
  });

  it('still rolls all ten when no catalogue is given', () => {
    const random = seeded(3);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) seen.add(rollField(random).kind);
    expect(seen.size).toBeGreaterThan(6);
  });
});
