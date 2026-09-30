import { BASE_ELEMENTS, type BaseElement } from '../elements';
import type { CombatConfig } from '../schemas/config';

/**
 * BOARD TILES — the primitives only. No board generation, no matching, no
 * gameplay yet.
 *
 * The board holds the four BASE elements plus one NEUTRAL tile: food.
 *
 * Why five and not four: with N tile kinds, a random 8x8 fill produces roughly
 * 96/N^2 accidental alignments. Four kinds gives ~6 free matches per fill, which
 * turns the board into constant unearned cascades. Five gives ~3.8, which is the
 * playable range.
 *
 * Food is a RESOURCE, not an element: matching it grants food and triggers no
 * creature. So "the board only ever uses the four base elements" still holds for
 * everything that attacks.
 *
 * Drakofruta IS a board kind, and the rarest one. Matching it charges the
 * IN-BATTLE evolution — a creature that transforms for the rest of the fight —
 * and it never touches the player's drakofruta wallet. That is what keeps it off
 * the old objection: a tile you can farm must not pay a permanent currency, so
 * this one pays a temporary power instead.
 */

export const NEUTRAL_TILE_KINDS = ['food', 'drakofruta'] as const;
export const BOARD_TILE_KINDS = [...BASE_ELEMENTS, ...NEUTRAL_TILE_KINDS] as const;

export type NeutralTileKind = (typeof NEUTRAL_TILE_KINDS)[number];
export type BoardTileKind = (typeof BOARD_TILE_KINDS)[number];

/**
 * How often each kind is dealt, as a bag of copies drawn uniformly.
 *
 * Six kinds spread evenly would make every alignment rarer AND hand out
 * drakofruta like gravel. Weighting keeps the elements frequent enough to play
 * with and the fruit scarce enough that lining three up is an event.
 */
export function tileBag(weights: Readonly<Record<BoardTileKind, number>>): BoardTileKind[] {
  const bag: BoardTileKind[] = [];
  for (const kind of BOARD_TILE_KINDS) {
    const copies = Math.max(0, Math.trunc(weights[kind]));
    for (let i = 0; i < copies; i += 1) bag.push(kind);
  }
  if (bag.length === 0) throw new Error('Every tile weight is zero: nothing could be dealt');
  return bag;
}

export function isElementTile(tile: BoardTileKind): tile is BaseElement {
  return (BASE_ELEMENTS as readonly string[]).includes(tile);
}

/**
 * The attack power of a creature for a triggered match.
 *
 * An evolved creature triggers on the SAME base element and only hits harder:
 * its path stat bonus plus the configured multiplier.
 */
export function attackPowerFor(
  params: {
    speciesBaseAttack: number;
    pathAttackBonus: number;
    isEvolved: boolean;
  },
  config: CombatConfig,
): number {
  if (!params.isEvolved) return params.speciesBaseAttack;
  const evolved = params.speciesBaseAttack + params.pathAttackBonus;
  return Math.floor(evolved * config.evolvedDamageMultiplier);
}

/**
 * Damage from one alignment. Longer alignments scale linearly from the minimum
 * match length, so a 3-match is the baseline and a 5-match is worth three times
 * as much. Kept deliberately simple until the match-3 checkpoint.
 */
export function damageForMatch(
  params: { power: number; matchLength: number },
  config: CombatConfig,
): number {
  if (params.matchLength < config.minMatchLength) return 0;
  const overflow = params.matchLength - config.minMatchLength;
  return params.power * (1 + overflow);
}
