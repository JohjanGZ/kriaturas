import { type Board, type Position, inBounds } from './board';
import { resolveMove } from './matching';
import type { BaseElement } from '../elements';

/**
 * THE RIVAL'S HAND — how the bot picks a swap.
 *
 * The bot plays the SAME board you do, right after your turn. That is the point
 * of it: the gems you leave behind are the gems it gets, so a move is no longer
 * only "what do I clear" but "what am I handing over".
 *
 * Pure, like the rest of the engine: no clock, no storage, and `random` comes in
 * as an argument, so a battle replays identically from a seed and a test never
 * flakes. It only PICKS a move — resolving it is the caller's job, with the real
 * random, so refills stay server-side and unpredictable.
 */

export type BotMove = {
  readonly from: Position;
  readonly to: Position;
  /** What the bot thought this move was worth. */
  readonly score: number;
  /** True when nothing aligned and it shuffled two tiles to spend the move. */
  readonly blind: boolean;
};

export type BotOptions = {
  minMatchLength: number;
  /**
   * The elements the rival lineup charges on. Those gems are worth more to it,
   * which is what makes a rival of another element feel different to play
   * against instead of a generic tile-clearer.
   */
  preferElements?: readonly BaseElement[];
  /**
   * 0 takes any legal move, 1 always takes the best one it found. Difficulty is
   * tuning, so the caller reads it from a config row.
   */
  skill: number;
  /** May it spend the move on a swap that aligns nothing, when nothing else is left? */
  allowNonMatching?: boolean;
};

/**
 * A fixed source for SCORING ONLY.
 *
 * Candidates are probed with `maxCascades: 0`, so only the clear the swap itself
 * makes is scored and no refill can influence the choice. Using the real random
 * here would burn the server's stream on moves that are never played, and would
 * let the bot "see" tiles that have not fallen yet.
 */
const probeRandom = (): number => 0.5;

/** Every adjacent pair on the board, left to right and top to bottom. */
function* candidates(board: Board): Generator<readonly [Position, Position]> {
  for (let row = 0; row < board.height; row += 1) {
    for (let col = 0; col < board.width; col += 1) {
      const here = { row, col };
      for (const there of [
        { row, col: col + 1 },
        { row: row + 1, col },
      ]) {
        if (inBounds(board, there)) yield [here, there];
      }
    }
  }
}

/**
 * Picks the bot's swap.
 *
 * Scoring is deliberately shallow — one clear deep, no cascade lookahead. A bot
 * that searched deeper would out-plan a human on a board neither of them can
 * predict (the refills are random), which reads as cheating rather than as
 * difficulty. `skill` decides how often it takes its own best answer.
 */
export function chooseBotMove(
  board: Board,
  options: BotOptions,
  random: () => number,
): BotMove | null {
  const preferred = new Set<string>(options.preferElements ?? []);
  const scored: BotMove[] = [];
  const everything: (readonly [Position, Position])[] = [];

  for (const [from, to] of candidates(board)) {
    everything.push([from, to]);

    const probe = resolveMove(
      board,
      from,
      to,
      { minMatchLength: options.minMatchLength, maxCascades: 0 },
      probeRandom,
    );
    if (!probe.ok) continue;

    let score = 0;
    let ownRun = 0;
    for (const [kind, count] of Object.entries(probe.cleared)) {
      if (count === 0) continue;
      /** Its own elements charge its bars; the rest are only board cleanup. */
      if (preferred.has(kind)) {
        score += count * 3;
        ownRun = Math.max(ownRun, probe.longestRun[kind as keyof typeof probe.longestRun]);
      } else if (kind === 'food') score += count * 0.25;
      else score += count;
    }
    /** A run past the minimum is what earns the extra move, so it is worth chasing. */
    if (ownRun > options.minMatchLength) score += 4;

    scored.push({ from, to, score, blind: false });
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best === undefined) return null;
    if (random() < options.skill) return best;
    const fallback = scored[Math.min(scored.length - 1, Math.floor(random() * scored.length))];
    return fallback ?? best;
  }

  /**
   * A dead board: nothing aligns. The bot spends its move shuffling, exactly
   * like a player using a free swap, rather than getting a turn for nothing.
   */
  if (!options.allowNonMatching || everything.length === 0) return null;
  const pair = everything[Math.min(everything.length - 1, Math.floor(random() * everything.length))];
  if (!pair) return null;
  return { from: pair[0], to: pair[1], score: 0, blind: true };
}
