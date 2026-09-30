import { describe, expect, it } from 'vitest';
import { chooseBotMove, findRuns, inBounds, parseBoard, resolveMove, withSwap } from '@/core/match3';

/**
 * The bot plays the SAME board the player does, so the only thing that makes it
 * fair is that it obeys the same rules: adjacent swaps, inside the board, and no
 * knowledge of refills that have not fallen yet.
 */

/** Two swaps available: fire at the top, water in the middle. Nothing else aligns. */
const board = parseBoard('ffps\nwpfs\nwwpf\npsww');

const always = (value: number) => () => value;

/** A scripted source, so a decision that reads `random` twice stays predictable. */
function script(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

const options = { minMatchLength: 3, skill: 1 };

describe('chooseBotMove', () => {
  it('the fixture board has no run of its own', () => {
    expect(findRuns(board, 3)).toHaveLength(0);
  });

  it('takes the alignment of ITS OWN element when several are available', () => {
    const water = chooseBotMove(board, { ...options, preferElements: ['water'] }, always(0));
    const fire = chooseBotMove(board, { ...options, preferElements: ['fire'] }, always(0));

    expect(water).not.toBeNull();
    expect(fire).not.toBeNull();
    if (!water || !fire) return;

    /** Its own gems charge its bars, so it goes for those first. */
    expect(findRuns(withSwap(board, water.from, water.to), 3)[0]?.kind).toBe('water');
    expect(findRuns(withSwap(board, fire.from, fire.to), 3)[0]?.kind).toBe('fire');
  });

  it('only ever picks two touching cells inside the board', () => {
    for (const skill of [0, 0.5, 1]) {
      const move = chooseBotMove(board, { ...options, skill }, script([0.9, 0.1, 0.6]));
      expect(move).not.toBeNull();
      if (!move) continue;
      expect(inBounds(board, move.from)).toBe(true);
      expect(inBounds(board, move.to)).toBe(true);
      const gap = Math.abs(move.from.row - move.to.row) + Math.abs(move.from.col - move.to.col);
      expect(gap).toBe(1);
    }
  });

  it('picks a move the engine actually accepts', () => {
    const move = chooseBotMove(board, { ...options, preferElements: ['fire'] }, always(0));
    expect(move).not.toBeNull();
    if (!move) return;

    const result = resolveMove(board, move.from, move.to, { minMatchLength: 3 }, always(0.5));
    expect(result.ok).toBe(true);
  });

  it('a low skill still returns a legal move, just not the best one', () => {
    const careless = chooseBotMove(board, { ...options, skill: 0 }, script([0.99, 0]));
    expect(careless).not.toBeNull();
    if (!careless) return;
    expect(careless.blind).toBe(false);
    expect(findRuns(withSwap(board, careless.from, careless.to), 3).length).toBeGreaterThan(0);
  });
});

describe('chooseBotMove — a board with nothing to align', () => {
  /** A genuine deadlock: no swap on this board lines three up. */
  const dead = parseBoard('fwpf\nwpfw\npfwp\nfwpf');

  it('spends the move shuffling when free swaps are allowed', () => {
    const move = chooseBotMove(
      dead,
      { minMatchLength: 3, skill: 1, allowNonMatching: true },
      always(0.5),
    );
    expect(move).not.toBeNull();
    if (!move) return;
    expect(move.blind).toBe(true);
    const gap = Math.abs(move.from.row - move.to.row) + Math.abs(move.from.col - move.to.col);
    expect(gap).toBe(1);
  });

  it('passes rather than inventing a move when free swaps are off', () => {
    expect(chooseBotMove(dead, { minMatchLength: 3, skill: 1 }, always(0.5))).toBeNull();
  });
});
