import { describe, expect, it } from 'vitest';
import { EVOLVED_ELEMENTS } from '@/core/elements';
import {
  BOARD_TILE_KINDS,
  type Board,
  areAdjacent,
  createBoard,
  createPlayableBoard,
  findRuns,
  findValidMove,
  formatBoard,
  hasValidMove,
  parseBoard,
  tileAt,
  tileCounts,
  withSwap,
} from '@/core/match3';

/**
 * Boards are written as letter grids so a test reads like the thing it asserts:
 *   f fire · w water · p plant · s psychic · o food
 */

/** A deterministic stand-in for a random source: cycles a fixed sequence. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value ?? 0;
  };
}

/** Small deterministic PRNG, so "random" boards are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('parseBoard / formatBoard', () => {
  it('round-trips a grid', () => {
    const source = 'fwp\nwpf\npfw';
    expect(formatBoard(parseBoard(source))).toBe(source);
  });

  it('ignores layout whitespace', () => {
    const board = parseBoard(`
      f w p
      w p f
      p f w
    `);
    expect(board.width).toBe(3);
    expect(board.height).toBe(3);
    expect(tileAt(board, { row: 0, col: 2 })).toBe('plant');
  });

  it('rejects a ragged grid and an unknown letter', () => {
    expect(() => parseBoard('fwp\nfw')).toThrow(/Ragged/);
    expect(() => parseBoard('fwz')).toThrow(/Unknown tile letter/);
  });
});

describe('geometry', () => {
  const board = parseBoard('fwp\nwpf\npfw');

  it('knows which cells touch', () => {
    expect(areAdjacent({ row: 0, col: 0 }, { row: 0, col: 1 })).toBe(true);
    expect(areAdjacent({ row: 0, col: 0 }, { row: 1, col: 0 })).toBe(true);
    expect(areAdjacent({ row: 0, col: 0 }, { row: 1, col: 1 })).toBe(false);
    expect(areAdjacent({ row: 0, col: 0 }, { row: 0, col: 0 })).toBe(false);
  });

  it('returns undefined outside the board instead of wrapping around', () => {
    expect(tileAt(board, { row: 0, col: 3 })).toBeUndefined();
    expect(tileAt(board, { row: -1, col: 0 })).toBeUndefined();
    expect(tileAt(board, { row: 3, col: 0 })).toBeUndefined();
  });

  it('swaps without mutating the original board', () => {
    const swapped = withSwap(board, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(formatBoard(swapped)).toBe('wfp\nwpf\npfw');
    expect(formatBoard(board)).toBe('fwp\nwpf\npfw');
  });
});

describe('findRuns', () => {
  it('finds a horizontal run of three', () => {
    const runs = findRuns(parseBoard('fffw\nwpwp\npwpw'), 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).toBe('fire');
    expect(runs[0]?.orientation).toBe('row');
    expect(runs[0]?.positions).toHaveLength(3);
  });

  it('finds a vertical run of three', () => {
    const runs = findRuns(parseBoard('fwp\nfpw\nfwp'), 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.orientation).toBe('column');
  });

  it('reports a run of five as one run, not three overlapping ones', () => {
    const runs = findRuns(parseBoard('fffff\nwpwpw\npwpwp'), 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.positions).toHaveLength(5);
  });

  it('ignores a run shorter than the minimum', () => {
    expect(findRuns(parseBoard('ffwp\nwpwp\npwpw'), 3)).toHaveLength(0);
  });

  it('respects a raised minimum length', () => {
    const board = parseBoard('fffw\nwpwp\npwpw');
    expect(findRuns(board, 3)).toHaveLength(1);
    expect(findRuns(board, 4)).toHaveLength(0);
  });

  it('reports both arms of an L shape', () => {
    // fire fills the top row and the left column: two runs sharing one corner.
    const runs = findRuns(parseBoard('fffw\nfpwp\nfwpw'), 3);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.orientation).sort()).toEqual(['column', 'row']);
  });
});

describe('createBoard', () => {
  const options = { width: 8, height: 8, minMatchLength: 3 };

  it('never starts with an alignment already made', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const board = createBoard(options, seeded(seed));
      expect(findRuns(board, 3)).toHaveLength(0);
    }
  });

  it('only uses the five board tiles — no evolved element, no drakofruta', () => {
    const board = createBoard(options, seeded(7));
    for (const tile of board.tiles) {
      expect(BOARD_TILE_KINDS).toContain(tile);
    }
    for (const evolved of EVOLVED_ELEMENTS) {
      expect(board.tiles).not.toContain(evolved);
    }
    expect(board.tiles).not.toContain('drakofruta');
  });

  it('fills every cell', () => {
    const board = createBoard(options, seeded(3));
    expect(board.tiles).toHaveLength(64);
    const counts = tileCounts(board);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(64);
  });

  it('is reproducible for the same random source', () => {
    const a = createBoard(options, seeded(99));
    const b = createBoard(options, seeded(99));
    expect(formatBoard(a)).toBe(formatBoard(b));
  });

  it('differs for a different random source', () => {
    const a = createBoard(options, seeded(1));
    const b = createBoard(options, seeded(2));
    expect(formatBoard(a)).not.toBe(formatBoard(b));
  });

  it('survives a degenerate random source that always returns 0', () => {
    // Always picking the first allowed kind must still not build a run.
    const board = createBoard(options, sequence([0]));
    expect(findRuns(board, 3)).toHaveLength(0);
  });

  it('refuses to build a board with fewer than three kinds', () => {
    expect(() => createBoard({ ...options, kinds: ['fire', 'water'] }, seeded(1))).toThrow(
      /at least three/,
    );
  });
});

describe('hasValidMove', () => {
  it('sees a swap that would make a run', () => {
    // Swapping the plant at 1,0 with the fire at 1,1 completes a fire column.
    const board: Board = parseBoard('fwp\npfw\nfwp');
    expect(hasValidMove(board, 3)).toBe(true);
  });

  it('reports a genuinely dead board as dead', () => {
    /**
     * tile[row][col] = kinds[(row + col) % 3]: every diagonal is one colour and
     * no swap can line three up. A checkerboard is NOT a deadlock — it is full
     * of legal moves — which is why that made a bad fixture.
     */
    const board = parseBoard('fwpf\nwpfw\npfwp\nfwpf');
    expect(findRuns(board, 3)).toHaveLength(0);
    expect(hasValidMove(board, 3)).toBe(false);
  });

  it('the suggested move really does make a run — it is the hint button', () => {
    const board = createPlayableBoard({ width: 8, height: 8, minMatchLength: 3 }, seeded(11));
    const suggestion = findValidMove(board, 3);
    expect(suggestion).not.toBeNull();
    if (!suggestion) return;
    expect(findRuns(withSwap(board, suggestion[0], suggestion[1]), 3).length).toBeGreaterThan(0);
  });

  it('returns null on a dead board', () => {
    expect(findValidMove(parseBoard('fwpf\nwpfw\npfwp\nfwpf'), 3)).toBeNull();
  });

  it('does not mistake a checkerboard for a deadlock', () => {
    expect(hasValidMove(parseBoard('fwfw\nwfwf\nfwfw\nwfwf'), 3)).toBe(true);
  });

  it('createPlayableBoard always yields a board with a legal move and no free runs', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const board = createPlayableBoard({ width: 8, height: 8, minMatchLength: 3 }, seeded(seed));
      expect(findRuns(board, 3)).toHaveLength(0);
      expect(hasValidMove(board, 3)).toBe(true);
    }
  });
});
