import { BASE_ELEMENTS, type BaseElement } from '../elements';
import type { Board } from '../match3/board';
import {
  applyGravity,
  clearedIndices,
  createPlayableBoard,
  findRuns,
  hasValidMove,
} from '../match3/matching';
import { type BoardTileKind, tileBag } from '../match3/tiles';
import type { CombatConfig } from '../schemas/config';

/**
 * CAMPOS — the battlefield itself as an opponent.
 *
 * A field is rolled at the start of a battle and lasts the whole fight. It
 * changes the RULES OF THE BOARD, never the creatures: the same pair plays
 * differently on a minefield than in a drought, which is what makes "which
 * field did I get" worth reading before the first move.
 *
 * Unlike creature effects, a field is NOT freely composed data. The set is
 * small, fixed and bespoke — a whirlwind is not a number, it is a rule — so the
 * verb lives in code here and only the TUNING is data. Composing fields the way
 * effects compose would buy nothing: nobody is ever going to author a hundred of
 * them, and each one that exists has to be legible in one sentence.
 *
 * Pure, like the rest of /core: `random` comes in as an argument, nothing reads
 * a clock, and the caller owns the board.
 */

/**
 * The two ways to start a fight. The mode is the ONLY thing the client picks:
 * which field comes up is rolled on the server and is not offered as a choice,
 * because a field you can pick is a field you can farm.
 */
export const BATTLE_MODES = ['normal', 'campos'] as const;
export type BattleMode = (typeof BATTLE_MODES)[number];

export const FIELD_KINDS = [
  'remolino',
  'minado',
  'volcan',
  'sequia',
  'vergel',
  'santuario',
  'paramo',
  'duelo',
  'resonancia',
  'vendaval',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** A mine is a CELL, not a tile. Tiles fall through it; it stays where it is. */
export type Bomb = { readonly at: number; readonly fuse: number };

export type BattleField = {
  readonly kind: FieldKind;
  /** Only the volcano uses it: which element floods the board. */
  readonly element: BaseElement | null;
  readonly bombs: readonly Bomb[];
};

/**
 * Every number a field moves, in one place.
 *
 * They are constants rather than config rows on purpose, for now: a field is
 * tuned against the other nine, so changing one in isolation from a database
 * row is how a mode stops being balanced against itself.
 */
export const FIELD_TUNING = {
  /** How many copies the volcano's element gets, and the orchard's fruit. */
  floodMultiplier: 3,
  bombCount: 2,
  bombFuse: 5,
  /** 1 means the eight neighbours: a 3x3 hole. */
  bombRadius: 1,
  sanctuaryHeal: 4,
  wastelandDamage: 4,
  duelManaMultiplier: 2,
  resonanceBonusMultiplier: 3,
} as const;

const pickIndex = (length: number, random: () => number): number =>
  Math.min(length - 1, Math.max(0, Math.floor(random() * length)));

/** The field for a battle in this mode. Rolled by the SERVER, like everything. */
export function rollField(random: () => number): BattleField {
  const kind = FIELD_KINDS[pickIndex(FIELD_KINDS.length, random)] ?? 'remolino';
  const element =
    kind === 'volcan' ? (BASE_ELEMENTS[pickIndex(BASE_ELEMENTS.length, random)] ?? 'fire') : null;
  return { kind, element, bombs: [] };
}

/**
 * The field's effect on the RULES, expressed as a tuned config.
 *
 * Five of the ten fields need nothing else: they are the ordinary battle with
 * different numbers, so they cost no engine code at all and cannot introduce a
 * bug of their own. Everything downstream — the tile bag, the move budget, the
 * bot — reads this tuned config and is none the wiser.
 */
export function tuneCombat(config: CombatConfig, field: BattleField | null): CombatConfig {
  if (!field) return config;

  switch (field.kind) {
    case 'volcan': {
      const element = field.element ?? 'fire';
      return {
        ...config,
        tileWeights: {
          ...config.tileWeights,
          [element]: config.tileWeights[element] * FIELD_TUNING.floodMultiplier,
        },
      };
    }
    /** No fruit falls at all: nobody transforms, whatever they align. */
    case 'sequia':
      return { ...config, tileWeights: { ...config.tileWeights, drakofruta: 0 } };
    case 'vergel':
      return {
        ...config,
        tileWeights: {
          ...config.tileWeights,
          drakofruta: config.tileWeights.drakofruta * FIELD_TUNING.floodMultiplier,
        },
      };
    /** One move a turn, but every gem is worth double: precision over volume. */
    case 'duelo':
      return {
        ...config,
        movesPerTurn: 1,
        manaPerGem: config.manaPerGem * FIELD_TUNING.duelManaMultiplier,
        manaBonusPerExtraGem: config.manaBonusPerExtraGem * FIELD_TUNING.duelManaMultiplier,
      };
    /** Only the gems PAST the minimum pay more, so a five is worth building. */
    case 'resonancia':
      return {
        ...config,
        manaBonusPerExtraGem:
          config.manaBonusPerExtraGem * FIELD_TUNING.resonanceBonusMultiplier,
      };
    default:
      return config;
  }
}

/** The tile kinds this field deals, already weighted. */
export function fieldKinds(config: CombatConfig, field: BattleField | null): BoardTileKind[] {
  return tileBag(tuneCombat(config, field).tileWeights);
}

/** Life the field gives or takes at the end of every turn, per side. */
export function turnTick(field: BattleField | null): { player: number; opponent: number } {
  if (field?.kind === 'santuario') {
    return { player: FIELD_TUNING.sanctuaryHeal, opponent: FIELD_TUNING.sanctuaryHeal };
  }
  if (field?.kind === 'paramo') {
    return { player: -FIELD_TUNING.wastelandDamage, opponent: -FIELD_TUNING.wastelandDamage };
  }
  return { player: 0, opponent: 0 };
}

/**
 * Clears whatever the board happens to hold and lets it fall, WITHOUT counting
 * any of it.
 *
 * This is what makes an explosion an explosion rather than a free special: the
 * gems it removes charge nobody, pay no fruit and deal no damage. The same
 * applies to the chain the refill sets off — the board settles in silence,
 * bounded by the cascade cap so a pathological refill cannot spin here.
 */
export function settleQuietly(
  board: Board,
  config: CombatConfig,
  kinds: readonly BoardTileKind[],
  random: () => number,
): { board: Board; swallowed: number } {
  let current = board;
  let swallowed = 0;

  for (let step = 0; step < config.maxCascades; step += 1) {
    const runs = findRuns(current, config.minMatchLength);
    if (runs.length === 0) break;
    const cleared = clearedIndices(current, runs);
    swallowed += cleared.size;
    current = applyGravity(current, cleared, random, kinds);
  }

  return { board: current, swallowed };
}

/** The cells a mine takes with it: the square around it, clipped to the board. */
export function blastRadius(board: Board, at: number, radius: number): number[] {
  const row = Math.floor(at / board.width);
  const col = at % board.width;
  const cells: number[] = [];

  for (let r = row - radius; r <= row + radius; r += 1) {
    for (let c = col - radius; c <= col + radius; c += 1) {
      if (r < 0 || c < 0 || r >= board.height || c >= board.width) continue;
      cells.push(r * board.width + c);
    }
  }
  return cells;
}

function armBomb(board: Board, taken: readonly number[], random: () => number): number {
  const cells = board.width * board.height;
  for (let tries = 0; tries < cells * 2; tries += 1) {
    const at = pickIndex(cells, random);
    if (!taken.includes(at)) return at;
  }
  return pickIndex(cells, random);
}

/** Lays the first mines. Called once, when the battle starts. */
export function armField(board: Board, field: BattleField, random: () => number): BattleField {
  if (field.kind !== 'minado') return field;

  const bombs: Bomb[] = [];
  for (let i = 0; i < FIELD_TUNING.bombCount; i += 1) {
    bombs.push({
      at: armBomb(board, bombs.map((bomb) => bomb.at), random),
      fuse: FIELD_TUNING.bombFuse,
    });
  }
  return { ...field, bombs };
}

export type FieldMoveResult = {
  readonly board: Board;
  readonly field: BattleField | null;
  /** The cells the blast took, so the browser can show them going up. */
  readonly detonated: readonly number[];
};

/**
 * ONE MOVE PASSED. Every fuse burns down a notch — the player's moves and the
 * bot's alike, because the mine does not care whose turn it is.
 *
 * A mine that reaches zero takes the square around it, the board settles in
 * silence, and a NEW mine is armed somewhere else: the field keeps threatening
 * for the whole battle instead of being disarmed by waiting.
 */
export function afterMove(
  board: Board,
  field: BattleField | null,
  config: CombatConfig,
  kinds: readonly BoardTileKind[],
  random: () => number,
): FieldMoveResult {
  if (!field || field.kind !== 'minado' || field.bombs.length === 0) {
    return { board, field, detonated: [] };
  }

  const burnt = field.bombs.map((bomb) => ({ ...bomb, fuse: bomb.fuse - 1 }));
  const blown = burnt.filter((bomb) => bomb.fuse <= 0);
  if (blown.length === 0) return { board, field: { ...field, bombs: burnt }, detonated: [] };

  const detonated = new Set<number>();
  for (const bomb of blown) {
    for (const cell of blastRadius(board, bomb.at, FIELD_TUNING.bombRadius)) detonated.add(cell);
  }

  const emptied = applyGravity(board, detonated, random, kinds);
  const settled = settleQuietly(emptied, config, kinds, random);

  /** Re-armed away from the survivors, so the same corner is not mined twice. */
  const survivors = burnt.filter((bomb) => bomb.fuse > 0);
  const rearmed: Bomb[] = [...survivors];
  for (let i = 0; i < blown.length; i += 1) {
    rearmed.push({
      at: armBomb(settled.board, rearmed.map((bomb) => bomb.at), random),
      fuse: FIELD_TUNING.bombFuse,
    });
  }

  return {
    board: settled.board,
    field: { ...field, bombs: rearmed },
    detonated: [...detonated],
  };
}

export type FieldTurnResult = {
  readonly board: Board;
  /** What the player must be TOLD happened, or the board changed for no reason. */
  readonly stirred: 'shuffled' | 'gale' | null;
};

/** Every tile keeps its kind and loses its place. */
function shuffleTiles(board: Board, random: () => number): Board {
  const tiles = [...board.tiles];
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = tiles[i];
    const b = tiles[j];
    if (a === undefined || b === undefined) continue;
    tiles[i] = b;
    tiles[j] = a;
  }
  return { ...board, tiles };
}

/** One column rolls down by one, and the bottom tile comes back around the top. */
function rotateColumn(board: Board, col: number): Board {
  const tiles = [...board.tiles];
  const bottom = tiles[(board.height - 1) * board.width + col];
  if (bottom === undefined) return board;
  for (let row = board.height - 1; row > 0; row -= 1) {
    const above = tiles[(row - 1) * board.width + col];
    if (above !== undefined) tiles[row * board.width + col] = above;
  }
  tiles[col] = bottom;
  return { ...board, tiles };
}

/**
 * THE TURN IS OVER and the field takes its own turn.
 *
 * Whatever it does, the board it hands back must still be PLAYABLE: no
 * alignment already made (which would pay somebody for the weather) and at
 * least one legal move (a field that can deadlock the game is a bug, not a
 * difficulty). Both are re-checked here rather than trusted.
 */
export function afterTurn(
  board: Board,
  field: BattleField | null,
  config: CombatConfig,
  kinds: readonly BoardTileKind[],
  random: () => number,
): FieldTurnResult {
  if (!field) return { board, stirred: null };
  if (field.kind !== 'remolino' && field.kind !== 'vendaval') return { board, stirred: null };

  const stirred = field.kind === 'remolino' ? 'shuffled' : 'gale';

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const moved =
      field.kind === 'remolino'
        ? shuffleTiles(board, random)
        : rotateColumn(board, pickIndex(board.width, random));

    /** A stir that lines something up would pay somebody for the weather. */
    if (findRuns(moved, config.minMatchLength).length > 0) continue;
    if (!hasValidMove(moved, config.minMatchLength)) continue;
    return { board: moved, stirred };
  }

  /** Twelve tries and nothing settled: a fresh board beats a dead one. */
  return {
    board: createPlayableBoard(
      {
        width: board.width,
        height: board.height,
        minMatchLength: config.minMatchLength,
        kinds,
      },
      random,
    ),
    stirred,
  };
}
