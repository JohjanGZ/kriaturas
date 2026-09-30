import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  type BattleField,
  type BattleMode,
  type BattleState,
  type Board,
  type CascadeStep,
  type Combatant,
  type Rival,
  type TurnOutcome,
  afterMove,
  afterTurn,
  applyAdjustment,
  applyFieldTick,
  applyPlayerMove,
  applyPowers,
  applyRivalMove,
  applyRivalStrike,
  armField,
  canEvolveInBattle,
  chooseBotMove,
  convertTiles,
  createPlayableBoard,
  effectiveAdjustment,
  endTurn,
  evolveInBattle,
  evolveRivalInBattle,
  hasValidMove,
  resolveMove,
  resolveTurn,
  rivalToEvolve,
  rollField,
  startingMana,
  tileBag,
  tuneCombat,
  turnTick,
} from "@/core";
import { parseEffectList } from "@/core/effects/schema";
import {
  type BaseElement,
  canFight,
  firstDuplicateElement,
  isBaseElement,
  pickDistinctElements,
  resolveElement,
  superiorElementFor,
} from "@/core/elements";
import { advanceObjective } from "@/core/objectives";
import {
  type StoredBoard,
  type StoredField,
  type StoredRival,
  battleFieldSchema,
  storedBoardSchema,
  storedRivalListSchema,
} from "@/core/schemas/battle";
import {
  type CombatConfig,
  type PlayConfig,
  parseConfig,
} from "@/core/schemas/config";
import { canPlay } from "@/core/stamina";
import type { StaminaConfig } from "@/core/schemas/config";
import { violates } from "@/lib/errors";
import { getDb } from "../client";
import {
  battleCreatures,
  battles,
  creatures,
  evolutionPaths,
  gameConfigs,
  games,
  objectiveProgress,
  objectives,
  players,
  species,
} from "../schema";
import { adjustmentFor, loadSeasonBalance } from "./season";

/**
 * Battle orchestration: the only place that turns a pair of coordinates into a
 * new database state.
 *
 * Everything the player could lie about is computed here from rows: the board,
 * the mana, the damage, the health, the refill tiles. The action layer above
 * only validates shapes and checks who is asking.
 */

export type LoadedConfig = {
  combat: CombatConfig;
  play: PlayConfig;
  stamina: StaminaConfig;
  gameId: string;
};

export async function loadGameConfig(
  slug = "kriaturas",
): Promise<LoadedConfig> {
  const db = await getDb();
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.slug, slug))
    .limit(1);
  if (!game)
    throw new Error(`No existe el juego "${slug}". Ejecuta npm run db:seed`);

  const rows = await db
    .select()
    .from(gameConfigs)
    .where(eq(gameConfigs.gameId, game.id));
  const value = (key: string): unknown =>
    rows.find((row) => row.key === key)?.value;

  return {
    gameId: game.id,
    combat: parseConfig("combat", value("combat")),
    play: parseConfig("play", value("play")),
    stamina: parseConfig("stamina", value("stamina")),
  };
}

/**
 * WHICH PATH A CREATURE TRANSFORMS ALONG.
 *
 * An ordinary creature takes the path pointing at its OWN element (fire -> fire:
 * same colours, better numbers). An EXCELLENT one takes the path pointing at the
 * superior element (fire -> light), which the seed writes with better bonuses.
 *
 * Read in TypeScript rather than joined in SQL on purpose: the target depends on
 * `superiorElementFor`, a domain rule that lives in `/core` and must not be
 * duplicated as a join condition that could quietly drift from it.
 */
async function transformationPaths(
  db: Awaited<ReturnType<typeof getDb>>,
  members: readonly {
    speciesId: string;
    element: string;
    isExcellent: boolean;
  }[],
): Promise<{
  bonusOf: (member: {
    speciesId: string;
    element: string;
    isExcellent: boolean;
  }) => number;
  elementOf: (member: {
    speciesId: string;
    element: string;
    isExcellent: boolean;
  }) => string | null;
  effectsOf: (member: {
    speciesId: string;
    element: string;
    isExcellent: boolean;
  }) => unknown;
}> {
  const speciesIds = [...new Set(members.map((member) => member.speciesId))];
  const rows =
    speciesIds.length === 0
      ? []
      : await db
          .select()
          .from(evolutionPaths)
          .where(inArray(evolutionPaths.speciesId, speciesIds));

  const pick = (member: {
    speciesId: string;
    element: string;
    isExcellent: boolean;
  }) => {
    const wanted = member.isExcellent
      ? superiorElementFor(member.element as BaseElement)
      : member.element;
    const forSpecies = rows.filter((row) => row.speciesId === member.speciesId);
    return (
      forSpecies.find((row) => row.targetElement === wanted) ??
      forSpecies.find((row) => row.isDefault) ??
      null
    );
  };

  return {
    bonusOf: (member) => pick(member)?.attackBonus ?? 0,
    elementOf: (member) => pick(member)?.targetElement ?? null,
    effectsOf: (member) => pick(member)?.effects ?? [],
  };
}

export type BattleView = {
  id: string;
  status: "active" | "won" | "lost" | "abandoned";
  board: StoredBoard;
  rivals: StoredRival[];
  playerHp: number;
  playerMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  shield: number;
  /** The bot's own shield, so the HUD can explain a blow that landed on nothing. */
  opponentShield: number;
  /** The field this battle is on, or null in the ordinary mode. */
  field: StoredField | null;
  turn: number;
  /** Drakofruta aligned this battle, and what a transformation costs. */
  fruits: number;
  rivalFruits: number;
  fruitsToEvolve: number;
  /** True when the bar is full and someone on your side can still transform. */
  canEvolve: boolean;
  /** Moves left in this turn, and the full budget a turn starts with. */
  movesLeft: number;
  movesPerTurn: number;
  /** Whether the bonus move for a big alignment was already taken this turn. */
  extraMoveUsed: boolean;
  team: {
    creatureId: string;
    name: string;
    element: BaseElement;
    /** What it LOOKS like once transformed. The trigger is still `element`. */
    evolvedElement: string | null;
    /** Transformed by the board's fruit, for this battle only. */
    evolvedInBattle: boolean;
    /** The rare mark: it transforms into the SUPERIOR element instead. */
    isExcellent: boolean;
    attack: number;
    mana: number;
    manaCost: number;
  }[];
};

export async function getActiveBattle(
  playerId: string,
): Promise<BattleView | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(battles)
    .where(and(eq(battles.playerId, playerId), eq(battles.status, "active")))
    .limit(1);
  if (!row) return null;
  return toView(row.id);
}

export async function getBattle(battleId: string): Promise<BattleView | null> {
  return toView(battleId);
}

/**
 * What the play screen must show: the battle in progress, or a FINISHED one the
 * player has not acknowledged yet.
 *
 * A won battle stops being active the instant the last gem clears, so without
 * this the screen would flip straight to the team picker and the player would
 * never learn whether they won. The result is a row, not a toast: it survives a
 * reload, a closed tab and a slow connection, and it goes away only when the
 * player says so.
 */
export async function getBattleToShow(
  playerId: string,
): Promise<BattleView | null> {
  const db = await getDb();

  const active = await getActiveBattle(playerId);
  if (active) return active;

  const [finished] = await db
    .select()
    .from(battles)
    .where(
      and(
        eq(battles.playerId, playerId),
        inArray(battles.status, ["won", "lost"]),
        isNull(battles.dismissedAt),
      ),
    )
    .orderBy(desc(battles.endedAt))
    .limit(1);

  return finished ? toView(finished.id) : null;
}

/** The player closed the result screen. Only ever their own battle. */
export async function dismissBattle(
  battleId: string,
  playerId: string,
  now: Date,
): Promise<void> {
  const db = await getDb();
  await db
    .update(battles)
    .set({ dismissedAt: now })
    .where(and(eq(battles.id, battleId), eq(battles.playerId, playerId)));
}

async function toView(battleId: string): Promise<BattleView | null> {
  const db = await getDb();
  const config = await loadGameConfig();
  const [row] = await db
    .select()
    .from(battles)
    .where(eq(battles.id, battleId))
    .limit(1);
  if (!row) return null;

  const team = await db
    .select({
      creatureId: battleCreatures.creatureId,
      mana: battleCreatures.mana,
      manaCost: battleCreatures.manaCost,
      slot: battleCreatures.slot,
      evolvedInBattle: battleCreatures.evolvedInBattle,
      nickname: creatures.nickname,
      isExcellent: creatures.isExcellent,
      speciesId: creatures.speciesId,
      speciesName: species.name,
      /**
       * THE ELEMENT IT FIGHTS WITH: its own if a stone gave it one, its
       * species' otherwise. Coalesced in SQL because it is the same rule
       * everywhere and a battle may only hold creatures that HAVE one —
       * `startBattle` refuses the white ones, so this is never null here.
       */
      element: sql<BaseElement>`coalesce(${creatures.element}, ${species.baseElement})`,
      attack: species.baseAttack,
    })
    .from(battleCreatures)
    .innerJoin(creatures, eq(creatures.id, battleCreatures.creatureId))
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(battleCreatures.battleId, battleId))
    .orderBy(battleCreatures.slot);

  const transform = await transformationPaths(db, team);
  const balance = await loadSeasonBalance();

  /** The view shows the rules the FIELD imposes, not the printed ones. */
  const field = row.field ? battleFieldSchema.parse(row.field) : null;
  const combat = tuneCombat(config.combat, field);

  return {
    id: row.id,
    status: row.status,
    field,
    /** Validated on read: the column is only as good as its last writer. */
    board: storedBoardSchema.parse(row.board),
    rivals: storedRivalListSchema.parse(row.rivals),
    playerHp: row.playerHp,
    playerMaxHp: row.playerMaxHp,
    opponentHp: row.opponentHp,
    opponentMaxHp: row.opponentMaxHp,
    shield: row.shield,
    opponentShield: row.opponentShield,
    turn: row.turn,
    fruits: row.fruits,
    rivalFruits: row.rivalFruits,
    fruitsToEvolve: combat.fruitsToEvolve,
    canEvolve:
      row.status === "active" &&
      row.fruits >= combat.fruitsToEvolve &&
      team.some((member) => !member.evolvedInBattle),
    movesLeft: row.movesLeft,
    movesPerTurn: combat.movesPerTurn,
    extraMoveUsed: row.extraMoveUsed,
    team: team.map((member) => ({
      creatureId: member.creatureId,
      name: member.nickname ?? member.speciesName,
      element: member.element as BaseElement,
      evolvedElement: member.evolvedInBattle
        ? transform.elementOf(member)
        : null,
      evolvedInBattle: member.evolvedInBattle,
      isExcellent: member.isExcellent,
      attack:
        applyAdjustment(
          { attack: member.attack, manaCost: member.manaCost },
          effectiveAdjustment(adjustmentFor(balance, member.speciesId), {
            excellent: member.isExcellent,
          }),
        ).attack + (member.evolvedInBattle ? transform.bonusOf(member) : 0),
      mana: member.mana,
      manaCost: member.manaCost,
    })),
  };
}

export type StartBattleFailure =
  | "no_creatures"
  | "not_your_creature"
  | "battle_already_active"
  | "not_enough_stamina"
  | "creature_has_no_element"
  | "duplicate_element"
  | "no_enemies_available";

export type StartBattleResult =
  | { ok: true; battleId: string }
  | { ok: false; reason: StartBattleFailure; detail?: string };

/**
 * Starts a battle: spends stamina on every creature that fights, rolls a board
 * and a wave, and writes it all in ONE transaction.
 *
 * Stamina is per creature — bringing a tired creature is refused. The anchor is
 * pushed forward with the server clock; no timestamp comes from the caller.
 */
export async function startBattle(
  playerId: string,
  creatureIds: readonly string[],
  now: Date,
  mode: BattleMode = "normal",
): Promise<StartBattleResult> {
  const db = await getDb();
  const config = await loadGameConfig();

  /**
   * THE FIELD IS ROLLED HERE, server-side, and copied into the row.
   *
   * The client asks for a mode and nothing else: which field it got is not
   * something a browser may choose, re-roll or even find out before the row
   * exists. From here on `combat` is the tuned config and nothing downstream
   * needs to know a field is involved.
   */
  const field = mode === "campos" ? rollField(Math.random) : null;
  const combat = tuneCombat(config.combat, field);
  /**
   * The running season's adjustments. They are read HERE and copied into the
   * battle rows, so a balance change mid-battle cannot move the numbers under a
   * fight that is already going.
   */
  const balance = await loadSeasonBalance();

  if (creatureIds.length === 0) return { ok: false, reason: "no_creatures" };

  const roster = await db
    .select({
      id: creatures.id,
      playerId: creatures.playerId,
      lastFed: creatures.lastFed,
      speciesId: creatures.speciesId,
      isExcellent: creatures.isExcellent,
      manaCost: species.manaCost,
      speciesElement: species.baseElement,
      awakenedElement: creatures.element,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(inArray(creatures.id, [...creatureIds]));

  if (roster.length !== creatureIds.length) {
    return { ok: false, reason: "not_your_creature" };
  }
  if (roster.some((row) => row.playerId !== playerId)) {
    return { ok: false, reason: "not_your_creature" };
  }

  /**
   * A WHITE CREATURE CANNOT FIGHT, and this is the only place that has to say
   * so.
   *
   * No gem on the board triggers it, so it would stand there for the whole
   * battle charging nothing — a slot spent on a creature that cannot act. It is
   * refused here, before any stamina is spent, which is also why every query
   * downstream may treat a battle's creatures as having an element.
   */
  if (
    roster.some((row) => !canFight(row.speciesElement, row.awakenedElement))
  ) {
    return { ok: false, reason: "creature_has_no_element" };
  }

  /**
   * ONE ELEMENT PER TEAM, enforced HERE and not only in the picker.
   *
   * A gem charges every creature of its element at once, so a pair sharing one
   * element fills both bars off the same match — double value per gem, and the
   * "which bar do I feed" decision gone. The browser draws the rule; this is
   * what makes it true, because the client sends creature ids and a crafted
   * request would otherwise walk straight past the disabled buttons.
   */
  const repeated = firstDuplicateElement(
    roster.map((row) =>
      resolveElement(row.speciesElement, row.awakenedElement),
    ),
  );
  if (repeated) {
    return {
      ok: false,
      reason: "duplicate_element",
      detail: `Dos kriaturas de ${repeated}: una gema cargaría las dos barras a la vez`,
    };
  }

  /** Every creature must be rested enough, before anything is written. */
  const spends = roster.map((row) => ({
    row,
    spend: canPlay(row.lastFed, now, config.stamina, config.play),
  }));
  const tired = spends.find((entry) => !entry.spend.ok);
  if (tired && !tired.spend.ok) {
    return {
      ok: false,
      reason: "not_enough_stamina",
      detail: `Necesita ${tired.spend.required} de stamina y tiene ${tired.spend.staminaBefore}`,
    };
  }

  /**
   * The enemy wave: published species that are not on the team — and that HAVE
   * an element.
   *
   * A white species cannot be a rival for the same reason it cannot be on your
   * team: no gem on the board would ever charge it. It would also not survive
   * `storedRivalListSchema`, whose `element` is not nullable, so leaving it in
   * the pool turned starting a battle into a coin flip that depended on which
   * two species the query happened to return first.
   */
  const teamSpeciesIds = new Set(roster.map((row) => row.speciesId));
  const pool = (
    await db.select().from(species).where(eq(species.isPublished, true))
  ).filter((row) => row.baseElement !== null && !teamSpeciesIds.has(row.id));
  if (pool.length === 0) return { ok: false, reason: "no_enemies_available" };

  /**
   * The rival lineup: two creatures, both on screen. They have no health —
   * damage goes to the rival PLAYER — so only their element and their hit
   * matter here. It plays the board too, so each carries a bar like yours and
   * only hits when that bar fills; its mana cost comes from its own species,
   * which is what makes one rival pair pressure you faster than another.
   *
   * ONE ELEMENT EACH, and picked at RANDOM.
   *
   * The same rule your team obeys, applied where a lineup is BUILT rather than
   * chosen. A rival pair sharing an element charges both bars off one gem and
   * fires twice as often — the rule working against the player instead of for
   * them, and invisible, because there is no form to grey out. Taking the first
   * two of the pool also meant every battle faced the same two species.
   */
  const rivals = pickDistinctElements(
    pool,
    (row) => row.baseElement,
    2,
    Math.random,
  ).map((row) => {
    const tuned = applyAdjustment(
      { attack: row.baseAttack, manaCost: row.manaCost },
      adjustmentFor(balance, row.id),
    );
    const rivalManaCost = Math.max(
      1,
      Math.round((tuned.manaCost * combat.rivalManaCostPercent) / 100),
    );
    return {
      id: row.slug,
      name: row.name,
      element: row.baseElement,
      /**
       * The FULL species attack: a rival carries no effects, so its special is
       * bare damage. Halving it on top made the rival's big moment land like a
       * tap, and a fight with no threat is not a fight.
       */
      attack: Math.max(1, tuned.attack),
      /** Cheaper than the species price: a rival has no effects to make up for it. */
      manaCost: rivalManaCost,
      mana: startingMana(rivalManaCost, combat),
    };
  });

  /**
   * The opening board is dealt from the WEIGHTED bag, like every refill after
   * it. Dealing it flat made the first board a different game from the rest of
   * the battle — drakofruta on a sixth of the cells instead of a rare find —
   * and it is the bag that carries the field's own weighting.
   */
  const kinds = tileBag(combat.tileWeights);
  const board = createPlayableBoard(
    {
      width: combat.boardWidth,
      height: combat.boardHeight,
      minMatchLength: combat.minMatchLength,
      kinds,
    },
    Math.random,
  );

  /** Mines are laid once the board exists, because they sit on its cells. */
  const armed = field ? armField(board, field, Math.random) : null;

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(battles)
        .values({
          playerId,
          gameId: config.gameId,
          board: storedBoardSchema.parse(board),
          rivals: storedRivalListSchema.parse(rivals),
          field: armed ? battleFieldSchema.parse(armed) : null,
          playerMaxHp: combat.playerMaxHp,
          playerHp: combat.playerMaxHp,
          opponentMaxHp: combat.playerMaxHp,
          opponentHp: combat.playerMaxHp,
          movesLeft: combat.movesPerTurn,
          extraMoveUsed: false,
        })
        .returning();
      if (!created) throw new Error("No se pudo crear la partida");

      for (const [slot, entry] of spends.entries()) {
        if (!entry.spend.ok)
          throw new Error("stamina check changed mid-transaction");
        await tx
          .update(creatures)
          .set({ lastFed: entry.spend.lastFed })
          .where(eq(creatures.id, entry.row.id));

        /** The season's mana cost is copied in, so the bar cannot move mid-fight. */
        const tuned = applyAdjustment(
          { attack: 0, manaCost: entry.row.manaCost },
          effectiveAdjustment(adjustmentFor(balance, entry.row.speciesId), {
            excellent: entry.row.isExcellent,
          }),
        );

        await tx.insert(battleCreatures).values({
          battleId: created.id,
          creatureId: entry.row.id,
          slot,
          mana: startingMana(tuned.manaCost, combat),
          manaCost: tuned.manaCost,
        });
      }

      await advanceObjectives(
        tx,
        playerId,
        creatureIds,
        { matches_played: 1 },
        now,
      );

      return { ok: true as const, battleId: created.id };
    });
  } catch (error) {
    /** The unique index is what actually enforces one battle at a time. */
    if (violates(error, "battles_one_active_per_player")) {
      return { ok: false, reason: "battle_already_active" };
    }
    throw error;
  }
}

export type PlayMoveFailure =
  | "battle_not_found"
  | "not_your_battle"
  | "battle_finished"
  | "not_adjacent"
  | "out_of_bounds"
  | "no_match";

/**
 * One frame of the animation the browser replays.
 *
 * The engine already computes these while resolving the turn; sending them is
 * what lets the board SHOW gems clearing and falling instead of jumping to the
 * final state. It is still a replay of what the server decided — the client
 * cannot alter a single tile of it.
 */
export type AnimationStep = {
  /** Board indices removed in this step. */
  cleared: number[];
  /** The board as it stands after gravity and refill. */
  tiles: string[];
};

/**
 * What one creature did in a move, so the browser can PACE its bar: fill it
 * with the gems that charged it, and empty it at the instant it fires.
 */
export type AttackView = {
  /** Creature id for your lineup, rival id for the bot's. */
  id: string;
  manaAfter: number;
  manaCost: number;
  charged: boolean;
  damage: number;
};

const attackViews = (outcome: TurnOutcome): AttackView[] =>
  outcome.attacks.map((attack) => ({
    id: attack.creatureId,
    manaAfter: attack.manaAfter,
    manaCost: attack.manaCost,
    charged: attack.charged,
    damage: attack.totalDamage,
  }));

/** One move the BOT made, so the browser can show it playing. */
export type RivalMoveView = {
  from: { row: number; col: number };
  to: { row: number; col: number };
  swapped: string[];
  steps: AnimationStep[];
  damageToPlayer: number;
  specialsFired: string[];
  attacks: AttackView[];
};

type TileGrid = { readonly width: number; readonly tiles: readonly string[] };

/** The board with one swap applied — what the animation starts from. */
function withSwappedTiles(
  board: TileGrid,
  from: { row: number; col: number },
  to: { row: number; col: number },
): string[] {
  const tiles = [...board.tiles];
  const fromIndex = from.row * board.width + from.col;
  const toIndex = to.row * board.width + to.col;
  const fromTile = tiles[fromIndex];
  const toTile = tiles[toIndex];
  if (fromTile !== undefined && toTile !== undefined) {
    tiles[fromIndex] = toTile;
    tiles[toIndex] = fromTile;
  }
  return tiles;
}

/**
 * Turns the engine's cascade steps into animation frames.
 *
 * The cleared indices are read from the board each step STARTED on, so the
 * first frame belongs to the swapped board and each later one to the previous
 * step's result. Used for your moves and for the bot's, identically.
 */
function framesFor(steps: readonly CascadeStep[]): AnimationStep[] {
  return steps.map((step) => {
    const cleared: number[] = [];
    for (const run of step.runs) {
      for (const position of run.positions) {
        cleared.push(position.row * step.boardAfter.width + position.col);
      }
    }
    return {
      cleared: [...new Set(cleared)],
      tiles: [...step.boardAfter.tiles],
    };
  });
}

export type PlayMoveResult =
  | {
      ok: true;
      view: BattleView;
      /** The swapped board BEFORE anything cleared, so the swap can be shown. */
      swapped: string[];
      steps: AnimationStep[];
      /** The bot's moves, in order, replayed after yours. Empty until your turn ends. */
      rivalMoves: RivalMoveView[];
      log: {
        damageToOpponent: number;
        damageToPlayer: number;
        absorbedByShield: number;
        healed: number;
        specialsFired: string[];
        rivalSpecialsFired: string[];
        /** Per creature: what its bar did and what it fired. */
        attacks: AttackView[];
        /** True when this move earned the bonus move for a big alignment. */
        extraMoveGranted: boolean;
        movesLeft: number;
        /** True when the move ended your turn and the bot played. */
        turnOver: boolean;
        /** The shared fruit bar: what this move added, and where it stands. */
        fruitsGained: number;
        fruits: number;
        rivalFruits: number;
        /** True when you may now transform one of your creatures. */
        canEvolve: boolean;
        /** The rival's name when the bot spent ITS fruit this turn. */
        rivalEvolved: string | null;
        /** True when the board was dead and had to be rebuilt. */
        reshuffled: boolean;
        /** The field, with its mines where they now stand. */
        field: StoredField | null;
        /** Cells a mine took with it this turn — they charged nobody. */
        detonated: number[];
        /** How the field stirred the board when the turn ended. */
        stirred: "shuffled" | "gale" | null;
        /** Life the ground gave you (or took) this turn. */
        fieldHealed: number;
        /** Board cells a power repainted, and into what. */
        convertedCells: number[];
        convertedTo: string | null;
        /** `shuffle_board` fired: the grid the player was reading is gone. */
        boardShuffled: boolean;
        /** Health the poison took off each side this turn. */
        poisonTaken: number;
        poisonDealt: number;
        gemsByElement: Record<BaseElement, number>;
        foodGained: number;
        coinsGained: number;
        cascades: number;
        status: "active" | "won" | "lost" | "abandoned";
      };
    }
  | { ok: false; reason: PlayMoveFailure };

/**
 * Resolves one move. The client sends four numbers; everything else is read
 * from rows, computed here, and written back in one transaction.
 */
export async function playMove(
  battleId: string,
  playerId: string,
  from: { row: number; col: number },
  to: { row: number; col: number },
  now: Date,
): Promise<PlayMoveResult> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [row] = await db
    .select()
    .from(battles)
    .where(eq(battles.id, battleId))
    .limit(1);
  if (!row) return { ok: false, reason: "battle_not_found" };
  if (row.playerId !== playerId)
    return { ok: false, reason: "not_your_battle" };
  if (row.status !== "active") return { ok: false, reason: "battle_finished" };

  const view = await toView(battleId);
  if (!view) return { ok: false, reason: "battle_not_found" };

  /**
   * THE FIELD BENDS THE RULES BEFORE ANYTHING ELSE READS THEM.
   *
   * `tuneCombat` hands back an ordinary CombatConfig, so the bag, the move
   * budget, the engine and the bot all obey the field without knowing one
   * exists. That is why five of the ten fields needed no code at all: they are
   * this config with different numbers.
   */
  let field: BattleField | null = row.field
    ? battleFieldSchema.parse(row.field)
    : null;
  const combat = tuneCombat(config.combat, field);

  /** Drakofruta is the rare tile: the bag is what makes it rare. */
  const kinds = tileBag(combat.tileWeights);

  const move = resolveMove(
    view.board,
    from,
    to,
    {
      kinds,
      minMatchLength: combat.minMatchLength,
      maxCascades: combat.maxCascades,
      /** A swap that aligns nothing is a legal move that spends the turn. */
      allowNonMatching: combat.allowFreeSwaps,
    },
    Math.random,
  );
  if (!move.ok) return { ok: false, reason: move.reason };

  /** The board with the swap applied, before anything was cleared. */
  const swappedTiles = withSwappedTiles(view.board, from, to);

  /** Rebuild the domain state from rows, so the engine never trusts the client. */
  const teamRows = await db
    .select({
      creatureId: battleCreatures.creatureId,
      mana: battleCreatures.mana,
      manaCost: battleCreatures.manaCost,
      evolvedInBattle: battleCreatures.evolvedInBattle,
      blockedTurns: battleCreatures.blockedTurns,
      paralyzedTurns: battleCreatures.paralyzedTurns,
      isExcellent: creatures.isExcellent,
      speciesId: creatures.speciesId,
      /**
       * THE ELEMENT IT FIGHTS WITH: its own if a stone gave it one, its
       * species' otherwise. Coalesced in SQL because it is the same rule
       * everywhere and a battle may only hold creatures that HAVE one —
       * `startBattle` refuses the white ones, so this is never null here.
       */
      element: sql<BaseElement>`coalesce(${creatures.element}, ${species.baseElement})`,
      attack: species.baseAttack,
      effects: species.effects,
    })
    .from(battleCreatures)
    .innerJoin(creatures, eq(creatures.id, battleCreatures.creatureId))
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(battleCreatures.battleId, battleId))
    .orderBy(battleCreatures.slot);

  const transform = await transformationPaths(db, teamRows);
  const balance = await loadSeasonBalance();

  const team: Combatant[] = teamRows.map((member) => {
    /**
     * Transformed by the board's fruit, and along WHICH path depends on the
     * rare mark: an excellent creature takes the superior element and the
     * better bonuses, an ordinary one its own element.
     */
    const evolved = member.evolvedInBattle;
    const bonus = transform.bonusOf(member);
    const pathEffects = transform.effectsOf(member);

    /** The season adjusts the printed attack; the species row is untouched. */
    const tuned = applyAdjustment(
      { attack: member.attack, manaCost: member.manaCost },
      effectiveAdjustment(adjustmentFor(balance, member.speciesId), {
        excellent: member.isExcellent,
      }),
    );

    return {
      creatureId: member.creatureId,
      baseElement: member.element as BaseElement,
      baseAttack: tuned.attack,
      pathAttackBonus: evolved ? bonus : 0,
      isEvolved: evolved,
      effects: [
        ...parseEffectList(member.effects),
        ...(evolved ? parseEffectList(pathEffects) : []),
      ],
      manaCost: member.manaCost,
      mana: member.mana,
      blockedTurns: member.blockedTurns,
      paralyzedTurns: member.paralyzedTurns,
    };
  });

  const rivals: Rival[] = view.rivals.map((rival) => ({ ...rival }));
  let state: BattleState = {
    playerMaxHp: row.playerMaxHp,
    playerHp: row.playerHp,
    opponentMaxHp: row.opponentMaxHp,
    opponentHp: row.opponentHp,
    shield: row.shield,
    shieldTurns: row.shieldTurns,
    opponentShield: row.opponentShield,
    opponentShieldTurns: row.opponentShieldTurns,
    team,
    rivals,
    /** Both fruit bars, and who already spent one. */
    fruits: row.fruits,
    rivalFruits: row.rivalFruits,
    /** Powers that outlive a move: poison ticking and shortened turns. */
    playerPoison: {
      perMove: row.playerPoisonPerMove,
      turns: row.playerPoisonTurns,
    },
    rivalPoison: {
      perMove: row.rivalPoisonPerMove,
      turns: row.rivalPoisonTurns,
    },
    playerMovePenalty: row.playerMovePenalty,
    rivalMovePenalty: row.rivalMovePenalty,
    playerFruitBlockTurns: row.playerFruitBlockTurns,
    rivalFruitBlockTurns: row.rivalFruitBlockTurns,
    evolvedInBattle: teamRows
      .filter((member) => member.evolvedInBattle)
      .map((member) => member.creatureId),
    rivalEvolvedInBattle: view.rivals
      .filter((rival) => rival.evolvedInBattle)
      .map((rival) => rival.id),
    turn: row.turn,
    movesLeft: row.movesLeft,
    extraMoveUsed: row.extraMoveUsed,
    status: "active",
  };

  /** Conditions like `damage_by_type` read the front rival's element. */
  const outcome = resolveTurn({
    move,
    team,
    enemyElements: rivals.map((entry) => entry.element),
    battle: {
      selfHealthPercent: Math.round((state.playerHp / state.playerMaxHp) * 100),
      enemyHealthPercent: Math.round(
        (state.opponentHp / state.opponentMaxHp) * 100,
      ),
      fruits: state.fruits,
      turn: state.turn + 1,
    },
    config: combat,
  });
  const played = applyPlayerMove(state, outcome, combat);
  state = applyPowers(played.state, outcome.powers, "player");

  /** The two powers that edit the board. Both resolved here, never in the browser. */
  let board: Board = move.board;
  let convertedCells: number[] = [];
  if (outcome.powers.shuffleBoard) {
    board = createPlayableBoard(
      {
        width: combat.boardWidth,
        height: combat.boardHeight,
        minMatchLength: combat.minMatchLength,
        kinds,
      },
      Math.random,
    );
  }
  if (outcome.powers.convertedTiles > 0 && outcome.powers.convertElement) {
    const painted = convertTiles(
      board,
      outcome.powers.convertElement,
      outcome.powers.convertedTiles,
      combat.minMatchLength,
      Math.random,
    );
    board = painted.board;
    convertedCells = painted.changed;
  }

  /**
   * A MOVE PASSED, so every fuse burns down a notch.
   *
   * What a mine takes with it charges nobody: `afterMove` clears the square and
   * lets the board settle in silence, so an explosion is a thing that happens TO
   * you rather than a special you were handed.
   */
  const detonated: number[] = [];
  const burn = (current: Board): Board => {
    const tick = afterMove(current, field, combat, kinds, Math.random);
    field = tick.field;
    detonated.push(...tick.detonated);
    return tick.board;
  };
  board = burn(board);

  /**
   * THE BOT PLAYS THE SAME BOARD, and only once your moves are spent.
   *
   * It gets the same move budget and the same bonus-move rule you do, and it
   * charges its bars from what it clears — so it hits you only when a bar
   * fills, exactly like your creatures. Nothing here is a special case for the
   * machine, which is the only reason the fight can read as fair. Its moves are
   * resolved with the server's `random`, so the refills it gets are no more
   * predictable than yours.
   */
  /** What the ground did this turn, so the browser can say why things moved. */
  let stirred: "shuffled" | "gale" | null = null;
  let fieldHealth = { playerDelta: 0, opponentDelta: 0 };

  const rivalMoves: RivalMoveView[] = [];
  /** Set when the bot transformed one of its creatures this turn. */
  let rivalEvolved: string | null = null;
  let rivalPoisonDealt = 0;
  let rivalAttack = 0;
  let absorbedByShield = 0;
  let damageToPlayer = 0;
  const rivalSpecials: string[] = [];

  if (played.log.turnOver && state.status === "active") {
    if (combat.botEnabled) {
      /** A move you stole comes off the bot's turn — never below one. */
      let budget = Math.max(1, combat.movesPerTurn - state.rivalMovePenalty);
      let bonusTaken = false;
      state = { ...state, rivalMovePenalty: 0 };

      while (budget > 0 && state.status === "active") {
        /** Rebuilt every move, so the bot's bars carry within its own turn. */
        const botTeam: Combatant[] = state.rivals
          .filter((rival) => isBaseElement(rival.element))
          .map((rival) => ({
            creatureId: rival.id,
            baseElement: rival.element as BaseElement,
            baseAttack: rival.attack,
            pathAttackBonus: 0,
            isEvolved: false,
            effects: [],
            manaCost: rival.manaCost,
            mana: rival.mana,
          }));

        const pick = chooseBotMove(
          board,
          {
            minMatchLength: combat.minMatchLength,
            preferElements: botTeam.map((member) => member.baseElement),
            skill: combat.botSkill,
            allowNonMatching: combat.allowFreeSwaps,
          },
          Math.random,
        );
        if (!pick) break;

        const botMove = resolveMove(
          board,
          pick.from,
          pick.to,
          {
            minMatchLength: combat.minMatchLength,
            maxCascades: combat.maxCascades,
            allowNonMatching: true,
          },
          Math.random,
        );
        if (!botMove.ok) break;

        const botSwapped = withSwappedTiles(board, pick.from, pick.to);
        const botOutcome = resolveTurn({
          move: botMove,
          team: botTeam,
          enemyElements: team.map((entry) => entry.baseElement),
          /** Mirrored: the bot's "self" is the opponent side of the row. */
          battle: {
            selfHealthPercent: Math.round(
              (state.opponentHp / state.opponentMaxHp) * 100,
            ),
            enemyHealthPercent: Math.round(
              (state.playerHp / state.playerMaxHp) * 100,
            ),
            fruits: state.rivalFruits,
            turn: state.turn + 1,
          },
          config: combat,
        });
        const answered = applyRivalMove(state, botOutcome, combat);
        state = applyPowers(answered.state, botOutcome.powers, "rival");

        /** The bot paints the board too, with its own element. */
        let botBoard: Board = botMove.board;
        if (
          botOutcome.powers.convertedTiles > 0 &&
          botOutcome.powers.convertElement
        ) {
          botBoard = convertTiles(
            botBoard,
            botOutcome.powers.convertElement,
            botOutcome.powers.convertedTiles,
            combat.minMatchLength,
            Math.random,
          ).board;
        }

        rivalMoves.push({
          from: pick.from,
          to: pick.to,
          swapped: botSwapped,
          steps: framesFor(botMove.steps),
          damageToPlayer: answered.log.damageToPlayer,
          specialsFired: [...answered.log.specialsFired],
          attacks: attackViews(botOutcome),
        });
        rivalAttack += answered.log.rivalAttack;
        absorbedByShield += answered.log.absorbedByShield;
        damageToPlayer += answered.log.damageToPlayer;
        rivalSpecials.push(...answered.log.specialsFired);
        rivalPoisonDealt += answered.log.poisonDealt;

        /** The mine does not care whose move it was. */
        board = burn(botBoard);
        budget -= 1 - botOutcome.powers.extraMoves;
        if (!bonusTaken && answered.log.extraMoveGranted) {
          budget += combat.extraMovesPerTurn;
          bonusTaken = true;
        }
      }

      /**
       * Its bar filled too: the fruit the bot cleared is fruit you did not, and
       * it spends it by the same rule you do — one creature, this battle only.
       */
      const transforms = rivalToEvolve(state, combat);
      if (transforms) {
        state = evolveRivalInBattle(state, transforms, combat);
        rivalEvolved =
          state.rivals.find((rival) => rival.id === transforms)?.name ?? null;
      }
    } else {
      /** The bot switched off: the lineup just swings for the sum of its attacks. */
      const answered = applyRivalStrike(state);
      state = answered.state;
      rivalAttack = answered.log.rivalAttack;
      absorbedByShield = answered.log.absorbedByShield;
      damageToPlayer = answered.log.damageToPlayer;
    }

    state = endTurn(state, combat);

    /**
     * THE FIELD'S TURN. It stirs the board and it ticks both lives — and it can
     * finish the battle, which is why the status comes back out of it.
     */
    const stir = afterTurn(board, field, combat, kinds, Math.random);
    board = stir.board;
    stirred = stir.stirred;

    const ticked = applyFieldTick(state, turnTick(field));
    state = ticked.state;
    fieldHealth = ticked.log;
  }

  void rivalAttack;

  /**
   * A BOARD WITH NO LEGAL MOVE IS A DEAD END.
   *
   * `createPlayableBoard` guarantees one when the battle starts, but a cascade
   * can refill into a grid where nothing lines up: from there only free swaps
   * remain, nobody charges anything, and the battle cannot progress. So the
   * board is checked after the whole turn — yours and the bot's — and rebuilt
   * when it is dead. The player is told, because the board visibly changes.
   */
  let reshuffled = false;
  if (
    state.status === "active" &&
    !hasValidMove(board, combat.minMatchLength)
  ) {
    board = createPlayableBoard(
      {
        width: combat.boardWidth,
        height: combat.boardHeight,
        minMatchLength: combat.minMatchLength,
        kinds,
      },
      Math.random,
    );
    reshuffled = true;
  }

  const finished = state.status !== "active";

  await db.transaction(async (tx) => {
    await tx
      .update(battles)
      .set({
        /** The board AFTER the bot played, since that is what you will face. */
        board: storedBoardSchema.parse(board),
        rivals: storedRivalListSchema.parse(
          state.rivals.map((rival) => ({
            ...rival,
            evolvedInBattle: state.rivalEvolvedInBattle.includes(rival.id),
            blockedTurns: rival.blockedTurns ?? 0,
            paralyzedTurns: rival.paralyzedTurns ?? 0,
          })),
        ),
        /** The mines moved: their fuses are battle state like any other. */
        field: field ? battleFieldSchema.parse(field) : null,
        fruits: state.fruits,
        rivalFruits: state.rivalFruits,
        playerPoisonPerMove: state.playerPoison.perMove,
        playerPoisonTurns: state.playerPoison.turns,
        rivalPoisonPerMove: state.rivalPoison.perMove,
        rivalPoisonTurns: state.rivalPoison.turns,
        playerMovePenalty: state.playerMovePenalty,
        rivalMovePenalty: state.rivalMovePenalty,
        playerFruitBlockTurns: state.playerFruitBlockTurns,
        rivalFruitBlockTurns: state.rivalFruitBlockTurns,
        playerHp: state.playerHp,
        opponentHp: state.opponentHp,
        shield: state.shield,
        shieldTurns: state.shieldTurns,
        opponentShield: state.opponentShield,
        opponentShieldTurns: state.opponentShieldTurns,
        turn: state.turn,
        movesLeft: state.movesLeft,
        extraMoveUsed: state.extraMoveUsed,
        status: state.status,
        ...(finished ? { endedAt: now } : {}),
      })
      .where(eq(battles.id, battleId));

    for (const member of state.team) {
      await tx
        .update(battleCreatures)
        .set({
          mana: member.mana,
          evolvedInBattle: state.evolvedInBattle.includes(member.creatureId),
          blockedTurns: member.blockedTurns ?? 0,
          paralyzedTurns: member.paralyzedTurns ?? 0,
        })
        .where(
          and(
            eq(battleCreatures.battleId, battleId),
            eq(battleCreatures.creatureId, member.creatureId),
          ),
        );
    }

    const creatureIds = team.map((member) => member.creatureId);
    await advanceObjectives(
      tx,
      playerId,
      creatureIds,
      {
        damage_dealt: played.log.damageToOpponent,
        enemies_defeated: state.status === "won" ? 1 : 0,
        max_combo: outcome.longestCombo,
        matches_won: state.status === "won" ? 1 : 0,
        element_gems_cleared_fire: outcome.gemsByElement.fire,
        element_gems_cleared_water: outcome.gemsByElement.water,
        element_gems_cleared_plant: outcome.gemsByElement.plant,
        element_gems_cleared_psychic: outcome.gemsByElement.psychic,
      },
      now,
    );

    /**
     * Food comes off the board; coins come from CLEARING THE WAVE, written here
     * inside the same transaction that resolved the move, so a reward can never
     * be claimed twice. The board's drakofruta pays no wallet: it was already
     * spent on the battle it was found in.
     */
    const won = state.status === "won";
    if (outcome.foodGained > 0 || won) {
      const [player] = await tx
        .select()
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);
      if (player) {
        await tx
          .update(players)
          .set({
            food: player.food + outcome.foodGained,
            coins: player.coins + (won ? config.play.coinsPerWin : 0),
          })
          .where(eq(players.id, playerId));
      }
    }
  });

  const refreshed = await toView(battleId);
  if (!refreshed) return { ok: false, reason: "battle_not_found" };

  return {
    ok: true,
    view: refreshed,
    swapped: swappedTiles,
    steps: framesFor(move.steps),
    rivalMoves,
    log: {
      damageToOpponent: played.log.damageToOpponent,
      damageToPlayer,
      absorbedByShield,
      healed: played.log.healed,
      specialsFired: [...played.log.specialsFired],
      rivalSpecialsFired: rivalSpecials,
      attacks: attackViews(outcome),
      extraMoveGranted: played.log.extraMoveGranted,
      movesLeft: state.movesLeft,
      turnOver: played.log.turnOver,
      fruitsGained: outcome.fruitsGained,
      fruits: state.fruits,
      rivalFruits: state.rivalFruits,
      canEvolve: canEvolveInBattle(state, combat),
      rivalEvolved,
      reshuffled,
      /** The field, and what it did this turn. */
      field: field ? battleFieldSchema.parse(field) : null,
      detonated,
      stirred,
      fieldHealed: fieldHealth.playerDelta,
      convertedCells,
      convertedTo: outcome.powers.convertElement,
      boardShuffled: outcome.powers.shuffleBoard,
      poisonTaken: played.log.poisonTaken,
      poisonDealt: rivalPoisonDealt,
      gemsByElement: outcome.gemsByElement,
      foodGained: outcome.foodGained,
      coinsGained: state.status === "won" ? config.play.coinsPerWin : 0,
      cascades: outcome.cascades,
      status: state.status,
    },
  };
}

export type EvolveInBattleFailure =
  | "battle_not_found"
  | "not_your_battle"
  | "battle_finished"
  | "not_enough_fruits"
  | "not_in_battle"
  | "already_evolved";

export type EvolveInBattleOutcome =
  | { ok: true; view: BattleView; name: string; element: string | null }
  | { ok: false; reason: EvolveInBattleFailure };

/**
 * Spends the shared fruit bar on ONE of your creatures, for this battle only.
 *
 * The creature row is never touched: this is not the permanent evolution, and
 * nothing here reads or writes `players.drakofruta`. The client sends a creature
 * id and nothing else; the threshold, the spend and the eligibility are all
 * decided by `core/battle`.
 */
export async function evolveCreatureInBattle(
  battleId: string,
  playerId: string,
  creatureId: string,
): Promise<EvolveInBattleOutcome> {
  const db = await getDb();
  const config = await loadGameConfig();

  const [row] = await db
    .select()
    .from(battles)
    .where(eq(battles.id, battleId))
    .limit(1);
  if (!row) return { ok: false, reason: "battle_not_found" };
  if (row.playerId !== playerId)
    return { ok: false, reason: "not_your_battle" };
  if (row.status !== "active") return { ok: false, reason: "battle_finished" };

  const view = await toView(battleId);
  if (!view) return { ok: false, reason: "battle_not_found" };

  /** Only the fields the decision needs; the rest of the battle is untouched. */
  const state: BattleState = {
    playerMaxHp: view.playerMaxHp,
    playerHp: view.playerHp,
    opponentMaxHp: view.opponentMaxHp,
    opponentHp: view.opponentHp,
    shield: view.shield,
    shieldTurns: row.shieldTurns,
    opponentShield: row.opponentShield,
    opponentShieldTurns: row.opponentShieldTurns,
    team: view.team.map((member) => ({
      creatureId: member.creatureId,
      baseElement: member.element,
      baseAttack: member.attack,
      pathAttackBonus: 0,
      isEvolved: member.evolvedInBattle,
      effects: [],
      manaCost: member.manaCost,
      mana: member.mana,
    })),
    rivals: view.rivals.map((rival) => ({ ...rival })),
    fruits: view.fruits,
    rivalFruits: view.rivalFruits,
    playerPoison: {
      perMove: row.playerPoisonPerMove,
      turns: row.playerPoisonTurns,
    },
    rivalPoison: {
      perMove: row.rivalPoisonPerMove,
      turns: row.rivalPoisonTurns,
    },
    playerMovePenalty: row.playerMovePenalty,
    rivalMovePenalty: row.rivalMovePenalty,
    playerFruitBlockTurns: row.playerFruitBlockTurns,
    rivalFruitBlockTurns: row.rivalFruitBlockTurns,
    evolvedInBattle: view.team
      .filter((member) => member.evolvedInBattle)
      .map((member) => member.creatureId),
    rivalEvolvedInBattle: view.rivals
      .filter((rival) => rival.evolvedInBattle)
      .map((rival) => rival.id),
    turn: view.turn,
    movesLeft: view.movesLeft,
    extraMoveUsed: view.extraMoveUsed,
    status: "active",
  };

  const verdict = evolveInBattle(state, creatureId, config.combat);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  await db.transaction(async (tx) => {
    await tx
      .update(battles)
      .set({ fruits: verdict.state.fruits })
      .where(eq(battles.id, battleId));

    await tx
      .update(battleCreatures)
      .set({ evolvedInBattle: true })
      .where(
        and(
          eq(battleCreatures.battleId, battleId),
          eq(battleCreatures.creatureId, creatureId),
        ),
      );
  });

  const refreshed = await toView(battleId);
  if (!refreshed) return { ok: false, reason: "battle_not_found" };

  const member = refreshed.team.find(
    (entry) => entry.creatureId === creatureId,
  );
  return {
    ok: true,
    view: refreshed,
    name: member?.name ?? "Tu kriatura",
    element: member?.evolvedElement ?? null,
  };
}

export async function abandonBattle(
  battleId: string,
  playerId: string,
  now: Date,
): Promise<void> {
  const db = await getDb();
  /** Abandoning IS the acknowledgement, so it never shows a result screen. */
  await db
    .update(battles)
    .set({ status: "abandoned", endedAt: now, dismissedAt: now })
    .where(and(eq(battles.id, battleId), eq(battles.playerId, playerId)));
}

type Deltas = Partial<Record<string, number>>;

/**
 * Advances objective progress from a resolved turn.
 *
 * Progress is only ever written here, from numbers the server computed. No
 * input schema anywhere accepts a progress value, so there is nothing for a
 * client to inflate.
 */
async function advanceObjectives(
  tx: Awaited<ReturnType<typeof getDb>>,
  playerId: string,
  creatureIds: readonly string[],
  deltas: Deltas,
  now: Date,
): Promise<void> {
  const catalog = await tx.select().from(objectives);
  if (catalog.length === 0) return;

  for (const objective of catalog) {
    const key =
      objective.metric === "element_gems_cleared"
        ? `element_gems_cleared_${(objective.params as { element?: string }).element ?? ""}`
        : objective.metric;
    const amount = deltas[key];
    if (amount === undefined || amount === 0) continue;

    const targets =
      objective.scope === "creature"
        ? creatureIds.map((id) => id)
        : [null as string | null];

    for (const creatureId of targets) {
      const existing = await tx
        .select()
        .from(objectiveProgress)
        .where(
          and(
            eq(objectiveProgress.objectiveId, objective.id),
            creatureId === null
              ? eq(objectiveProgress.playerId, playerId)
              : eq(objectiveProgress.creatureId, creatureId),
          ),
        )
        .limit(1);

      const current = existing[0];
      const update = advanceObjective(
        {
          id: objective.id,
          metric: objective.metric,
          targetValue: objective.targetValue,
        },
        {
          currentValue: current?.currentValue ?? 0,
          completedAt: current?.completedAt ?? null,
        },
        amount,
        now,
      );
      if (!update.changed) continue;

      if (current) {
        await tx
          .update(objectiveProgress)
          .set({
            currentValue: update.currentValue,
            completedAt: update.completedAt,
          })
          .where(eq(objectiveProgress.id, current.id));
      } else {
        await tx.insert(objectiveProgress).values({
          objectiveId: objective.id,
          playerId,
          creatureId,
          currentValue: update.currentValue,
          completedAt: update.completedAt,
        });
      }
    }
  }
}
