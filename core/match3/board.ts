import { BASE_ELEMENTS } from '../elements';
import { BOARD_TILE_KINDS, type BoardTileKind } from './tiles';

/**
 * THE BOARD — pure geometry.
 *
 * A board is a row-major grid of tile kinds. A cell's position is geometry, not
 * identity: the "UUID everywhere, never array position as identity" rule is
 * about database rows, and a gem is not a row. Nothing here is persisted; the
 * server owns the board between turns and hands it to these functions.
 *
 * Every function is pure and takes `random` explicitly, so a turn is
 * reproducible and a test never flakes. The refill tiles after a cascade come
 * from that same server-side source, which is what stops a client predicting or
 * steering what falls in.
 */

export type Board = {
  readonly width: number;
  readonly height: number;
  /** Row-major, length === width * height. */
  readonly tiles: readonly BoardTileKind[];
};

export type Position = { readonly row: number; readonly col: number };

export function indexOf(board: Board, position: Position): number {
  return position.row * board.width + position.col;
}

export function inBounds(board: Board, position: Position): boolean {
  return (
    position.row >= 0 &&
    position.col >= 0 &&
    position.row < board.height &&
    position.col < board.width
  );
}

export function tileAt(board: Board, position: Position): BoardTileKind | undefined {
  if (!inBounds(board, position)) return undefined;
  return board.tiles[indexOf(board, position)];
}

/** Same as tileAt but for positions already known to be inside the board. */
export function tileAtOrThrow(board: Board, position: Position): BoardTileKind {
  const tile = tileAt(board, position);
  if (tile === undefined) {
    throw new Error(`Position out of bounds: ${position.row},${position.col}`);
  }
  return tile;
}

export function areAdjacent(a: Position, b: Position): boolean {
  const rowGap = Math.abs(a.row - b.row);
  const colGap = Math.abs(a.col - b.col);
  return rowGap + colGap === 1;
}

export function withSwap(board: Board, a: Position, b: Position): Board {
  const tiles = [...board.tiles];
  const indexA = indexOf(board, a);
  const indexB = indexOf(board, b);
  const tileA = tiles[indexA];
  const tileB = tiles[indexB];
  if (tileA === undefined || tileB === undefined) {
    throw new Error('Cannot swap a position outside the board');
  }
  tiles[indexA] = tileB;
  tiles[indexB] = tileA;
  return { ...board, tiles };
}

function pick<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
}

/**
 * Would placing `kind` here finish a run, counting only the cells already filled
 * to the left and above? That is enough during generation, because cells are
 * filled left to right, top to bottom.
 */
function completesRun(
  tiles: readonly (BoardTileKind | undefined)[],
  width: number,
  row: number,
  col: number,
  kind: BoardTileKind,
  minLength: number,
): boolean {
  let left = 0;
  for (let step = 1; step < minLength; step += 1) {
    if (col - step < 0) break;
    if (tiles[row * width + (col - step)] !== kind) break;
    left += 1;
  }
  if (left >= minLength - 1) return true;

  let up = 0;
  for (let step = 1; step < minLength; step += 1) {
    if (row - step < 0) break;
    if (tiles[(row - step) * width + col] !== kind) break;
    up += 1;
  }
  return up >= minLength - 1;
}

export type CreateBoardOptions = {
  width: number;
  height: number;
  minMatchLength: number;
  /** Defaults to the four base elements plus food. */
  kinds?: readonly BoardTileKind[];
};

/**
 * Builds a board with NO alignment already made.
 *
 * A random fill would hand the player free cascades they did not earn — roughly
 * 96/N² of them on an 8x8 — so each cell is chosen from the kinds that do not
 * complete a run with what is already placed.
 */
export function createBoard(options: CreateBoardOptions, random: () => number): Board {
  const kinds = options.kinds ?? BOARD_TILE_KINDS;
  if (kinds.length < 3) throw new Error('A board needs at least three tile kinds');

  const tiles: (BoardTileKind | undefined)[] = new Array<BoardTileKind | undefined>(
    options.width * options.height,
  ).fill(undefined);

  for (let row = 0; row < options.height; row += 1) {
    for (let col = 0; col < options.width; col += 1) {
      const allowed = kinds.filter(
        (kind) => !completesRun(tiles, options.width, row, col, kind, options.minMatchLength),
      );
      /** With three or more kinds `allowed` is never empty, but never trust that blindly. */
      tiles[row * options.width + col] = pick(allowed.length > 0 ? allowed : kinds, random);
    }
  }

  return {
    width: options.width,
    height: options.height,
    tiles: tiles.map((tile, index) => {
      if (tile === undefined) throw new Error(`Cell ${index} was never filled`);
      return tile;
    }),
  };
}

/** Letters used by parseBoard / formatBoard, for readable tests and logs. */
export const TILE_LETTERS = {
  f: 'fire',
  w: 'water',
  p: 'plant',
  s: 'psychic',
  o: 'food',
  d: 'drakofruta',
} as const satisfies Record<string, BoardTileKind>;

const LETTER_OF: Record<BoardTileKind, string> = {
  fire: 'f',
  water: 'w',
  plant: 'p',
  psychic: 's',
  food: 'o',
  drakofruta: 'd',
};

/**
 * Builds a board from a letter grid. Whitespace is ignored, so a test can lay
 * the board out visually and read it back.
 */
export function parseBoard(source: string): Board {
  const rows = source
    .split('\n')
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length > 0);

  const firstRow = rows[0];
  if (firstRow === undefined) throw new Error('An empty string is not a board');
  const width = firstRow.length;

  const tiles: BoardTileKind[] = [];
  for (const row of rows) {
    if (row.length !== width) throw new Error(`Ragged board: expected ${width} columns`);
    for (const letter of row) {
      const kind = (TILE_LETTERS as Record<string, BoardTileKind | undefined>)[letter];
      if (kind === undefined) throw new Error(`Unknown tile letter: "${letter}"`);
      tiles.push(kind);
    }
  }

  return { width, height: rows.length, tiles };
}

export function formatBoard(board: Board): string {
  const lines: string[] = [];
  for (let row = 0; row < board.height; row += 1) {
    let line = '';
    for (let col = 0; col < board.width; col += 1) {
      line += LETTER_OF[tileAtOrThrow(board, { row, col })];
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** The tile kinds a board actually contains — used to reshuffle in place. */
export function tileCounts(board: Board): Record<BoardTileKind, number> {
  const counts: Record<BoardTileKind, number> = {
    fire: 0,
    water: 0,
    plant: 0,
    psychic: 0,
    food: 0,
    drakofruta: 0,
  };
  for (const tile of board.tiles) counts[tile] += 1;
  return counts;
}

/** Base elements present on the board, in board order. Useful for the UI legend. */
export function elementsOnBoard(board: Board): readonly string[] {
  return BASE_ELEMENTS.filter((element) => board.tiles.includes(element));
}
