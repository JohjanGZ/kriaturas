import {
  type Board,
  type Position,
  areAdjacent,
  createBoard,
  inBounds,
  indexOf,
  tileAtOrThrow,
  withSwap,
} from './board';
import { BOARD_TILE_KINDS, type BoardTileKind } from './tiles';

/**
 * MATCHING, GRAVITY AND CASCADES.
 *
 * The whole turn resolves here, server-side, from a single swap. The client
 * sends two positions and nothing else — not the matches it thinks it made, not
 * the damage, not the tiles it expects to fall. Those are all computed here.
 */

export type Run = {
  readonly kind: BoardTileKind;
  readonly orientation: 'row' | 'column';
  readonly positions: readonly Position[];
};

const emptyTally = (): Record<BoardTileKind, number> => ({
  fire: 0,
  water: 0,
  plant: 0,
  psychic: 0,
  food: 0,
});

/** Every horizontal and vertical run of at least `minLength` equal tiles. */
export function findRuns(board: Board, minLength: number): Run[] {
  const runs: Run[] = [];

  const collect = (
    orientation: 'row' | 'column',
    outerCount: number,
    innerCount: number,
    positionOf: (outer: number, inner: number) => Position,
  ): void => {
    for (let outer = 0; outer < outerCount; outer += 1) {
      let start = 0;
      while (start < innerCount) {
        const kind = tileAtOrThrow(board, positionOf(outer, start));
        let end = start + 1;
        while (end < innerCount && tileAtOrThrow(board, positionOf(outer, end)) === kind) {
          end += 1;
        }
        if (end - start >= minLength) {
          const positions: Position[] = [];
          for (let inner = start; inner < end; inner += 1) {
            positions.push(positionOf(outer, inner));
          }
          runs.push({ kind, orientation, positions });
        }
        start = end;
      }
    }
  };

  collect('row', board.height, board.width, (row, col) => ({ row, col }));
  collect('column', board.width, board.height, (col, row) => ({ row, col }));

  return runs;
}

/**
 * The distinct cells cleared by a set of runs.
 *
 * An L or T shape belongs to two runs at once; the shared cell must be counted
 * once, or the reward for a lucky shape would be silently inflated.
 */
export function clearedIndices(board: Board, runs: readonly Run[]): Set<number> {
  const cleared = new Set<number>();
  for (const run of runs) {
    for (const position of run.positions) cleared.add(indexOf(board, position));
  }
  return cleared;
}

/**
 * Drops surviving tiles into the gaps and refills the top from `random`.
 * Refill tiles are generated here, on the server, never sent by the client.
 */
export function applyGravity(
  board: Board,
  cleared: ReadonlySet<number>,
  random: () => number,
  kinds: readonly BoardTileKind[] = BOARD_TILE_KINDS,
): Board {
  const tiles = [...board.tiles];

  for (let col = 0; col < board.width; col += 1) {
    const survivors: BoardTileKind[] = [];
    for (let row = board.height - 1; row >= 0; row -= 1) {
      const index = row * board.width + col;
      if (cleared.has(index)) continue;
      const tile = tiles[index];
      if (tile !== undefined) survivors.push(tile);
    }

    let write = board.height - 1;
    for (const tile of survivors) {
      tiles[write * board.width + col] = tile;
      write -= 1;
    }
    while (write >= 0) {
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))];
      if (kind === undefined) throw new Error('Cannot refill from an empty kind list');
      tiles[write * board.width + col] = kind;
      write -= 1;
    }
  }

  return { ...board, tiles };
}

export type CascadeStep = {
  readonly runs: readonly Run[];
  readonly clearedCount: number;
  readonly boardAfter: Board;
};

export type MoveRefusal = 'out_of_bounds' | 'not_adjacent' | 'no_match';

export type MoveResult =
  | { readonly ok: false; readonly reason: MoveRefusal; readonly board: Board }
  | {
      readonly ok: true;
      readonly board: Board;
      readonly steps: readonly CascadeStep[];
      /** Distinct tiles cleared over the whole turn, per kind. */
      readonly cleared: Readonly<Record<BoardTileKind, number>>;
      /** Longest single run per kind — what a combo condition is tested against. */
      readonly longestRun: Readonly<Record<BoardTileKind, number>>;
      /** Follow-up clears after the first one. A plain match is 0. */
      readonly cascades: number;
      /**
       * False when the cascade cap stopped the loop with runs still on the
       * board. The caller must not assume a settled board: it should resolve
       * again or reshuffle rather than hand a pre-matched board to the player.
       */
      readonly settled: boolean;
    };

export type ResolveOptions = {
  minMatchLength: number;
  /** Safety net: a refill can in principle keep matching forever. */
  maxCascades?: number;
  kinds?: readonly BoardTileKind[];
  /**
   * Accept a swap that lines nothing up. The turn is spent and nothing clears,
   * so repositioning is a real choice: you give up an attack (and take the
   * rival's answer) to set up a better alignment later.
   */
  allowNonMatching?: boolean;
};

/**
 * Resolves one player move: swap, then clear and refill until the board settles.
 *
 * A swap that makes no run is REFUSED by default and the original board comes
 * back untouched. With `allowNonMatching` it is ACCEPTED instead: the pieces
 * stay exchanged and the turn is spent. Either way the decision is made here,
 * on the server, never in the browser.
 */
export function resolveMove(
  board: Board,
  a: Position,
  b: Position,
  options: ResolveOptions,
  random: () => number,
): MoveResult {
  if (!inBounds(board, a) || !inBounds(board, b)) {
    return { ok: false, reason: 'out_of_bounds', board };
  }
  if (!areAdjacent(a, b)) {
    return { ok: false, reason: 'not_adjacent', board };
  }

  const swapped = withSwap(board, a, b);
  let runs = findRuns(swapped, options.minMatchLength);
  if (runs.length === 0) {
    if (!options.allowNonMatching) return { ok: false, reason: 'no_match', board };

    /** A free swap: the board keeps the exchange, and nothing clears or falls. */
    return {
      ok: true,
      board: swapped,
      steps: [],
      cleared: emptyTally(),
      longestRun: emptyTally(),
      cascades: 0,
      settled: true,
    };
  }

  const kinds = options.kinds ?? BOARD_TILE_KINDS;
  const maxCascades = options.maxCascades ?? 20;
  const cleared = emptyTally();
  const longestRun = emptyTally();
  const steps: CascadeStep[] = [];

  let current = swapped;
  let iterations = 0;

  while (runs.length > 0 && iterations <= maxCascades) {
    const indices = clearedIndices(current, runs);

    for (const run of runs) {
      longestRun[run.kind] = Math.max(longestRun[run.kind], run.positions.length);
    }
    for (const index of indices) {
      const tile = current.tiles[index];
      if (tile !== undefined) cleared[tile] += 1;
    }

    current = applyGravity(current, indices, random, kinds);
    steps.push({ runs, clearedCount: indices.size, boardAfter: current });

    runs = findRuns(current, options.minMatchLength);
    iterations += 1;
  }

  return {
    ok: true,
    board: current,
    steps,
    cleared,
    longestRun,
    cascades: Math.max(0, steps.length - 1),
    settled: runs.length === 0,
  };
}

/**
 * The first swap that would make a run, scanning left to right, top to bottom.
 * Doubles as the hint button and as the deadlock check.
 */
export function findValidMove(
  board: Board,
  minLength: number,
): readonly [Position, Position] | null {
  for (let row = 0; row < board.height; row += 1) {
    for (let col = 0; col < board.width; col += 1) {
      const here = { row, col };
      for (const there of [
        { row, col: col + 1 },
        { row: row + 1, col },
      ]) {
        if (!inBounds(board, there)) continue;
        if (findRuns(withSwap(board, here, there), minLength).length > 0) return [here, there];
      }
    }
  }
  return null;
}

/** Is there any swap left that would make a run? */
export function hasValidMove(board: Board, minLength: number): boolean {
  return findValidMove(board, minLength) !== null;
}

/**
 * Builds a fresh board with no free alignments AND at least one legal move.
 *
 * Both properties matter: the first stops unearned cascades, the second stops a
 * dead board. Generation is cheap, so retrying is simpler and safer than trying
 * to repair one.
 */
export function createPlayableBoard(
  options: { width: number; height: number; minMatchLength: number; kinds?: readonly BoardTileKind[] },
  random: () => number,
  maxAttempts = 50,
): Board {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const board = createBoard(options, random);
    if (hasValidMove(board, options.minMatchLength)) return board;
  }
  throw new Error('Could not generate a board with a legal move');
}
