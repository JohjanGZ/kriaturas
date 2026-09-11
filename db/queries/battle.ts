import { and, eq, inArray } from 'drizzle-orm';
import {
  type Combatant,
  type Rival,
  applyTurn,
  createPlayableBoard,
  resolveMove,
  resolveTurn,
} from '@/core';
import { parseEffectList } from '@/core/effects/schema';
import type { BaseElement } from '@/core/elements';
import { advanceObjective } from '@/core/objectives';
import {
  type StoredBoard,
  type StoredRival,
  storedBoardSchema,
  storedRivalListSchema,
} from '@/core/schemas/battle';
import {
  type CombatConfig,
  type EvolutionConfig,
  type PlayConfig,
  parseConfig,
} from '@/core/schemas/config';
import { canPlay } from '@/core/stamina';
import type { StaminaConfig } from '@/core/schemas/config';
import { violates } from '@/lib/errors';
import { getDb } from '../client';
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
} from '../schema';

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
  evolution: EvolutionConfig;
  gameId: string;
};

export async function loadGameConfig(slug = 'kriaturas'): Promise<LoadedConfig> {
  const db = await getDb();
  const [game] = await db.select().from(games).where(eq(games.slug, slug)).limit(1);
  if (!game) throw new Error(`No existe el juego "${slug}". Ejecuta npm run db:seed`);

  const rows = await db.select().from(gameConfigs).where(eq(gameConfigs.gameId, game.id));
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value;

  return {
    gameId: game.id,
    combat: parseConfig('combat', value('combat')),
    play: parseConfig('play', value('play')),
    stamina: parseConfig('stamina', value('stamina')),
    evolution: parseConfig('evolution', value('evolution')),
  };
}

export type BattleView = {
  id: string;
  status: 'active' | 'won' | 'lost' | 'abandoned';
  board: StoredBoard;
  rivals: StoredRival[];
  playerHp: number;
  playerMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  shield: number;
  turn: number;
  team: {
    creatureId: string;
    name: string;
    element: BaseElement;
    attack: number;
    mana: number;
    manaCost: number;
    isEvolved: boolean;
  }[];
};

export async function getActiveBattle(playerId: string): Promise<BattleView | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(battles)
    .where(and(eq(battles.playerId, playerId), eq(battles.status, 'active')))
    .limit(1);
  if (!row) return null;
  return toView(row.id);
}

export async function getBattle(battleId: string): Promise<BattleView | null> {
  return toView(battleId);
}

async function toView(battleId: string): Promise<BattleView | null> {
  const db = await getDb();
  const [row] = await db.select().from(battles).where(eq(battles.id, battleId)).limit(1);
  if (!row) return null;

  const team = await db
    .select({
      creatureId: battleCreatures.creatureId,
      mana: battleCreatures.mana,
      manaCost: battleCreatures.manaCost,
      slot: battleCreatures.slot,
      nickname: creatures.nickname,
      isEvolved: creatures.isEvolved,
      speciesName: species.name,
      element: species.baseElement,
      attack: species.baseAttack,
      pathBonus: evolutionPaths.attackBonus,
    })
    .from(battleCreatures)
    .innerJoin(creatures, eq(creatures.id, battleCreatures.creatureId))
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .leftJoin(evolutionPaths, eq(evolutionPaths.id, creatures.evolutionPathId))
    .where(eq(battleCreatures.battleId, battleId))
    .orderBy(battleCreatures.slot);

  return {
    id: row.id,
    status: row.status,
    /** Validated on read: the column is only as good as its last writer. */
    board: storedBoardSchema.parse(row.board),
    rivals: storedRivalListSchema.parse(row.rivals),
    playerHp: row.playerHp,
    playerMaxHp: row.playerMaxHp,
    opponentHp: row.opponentHp,
    opponentMaxHp: row.opponentMaxHp,
    shield: row.shield,
    turn: row.turn,
    team: team.map((member) => ({
      creatureId: member.creatureId,
      name: member.nickname ?? member.speciesName,
      element: member.element as BaseElement,
      attack:
        member.attack + (member.isEvolved ? (member.pathBonus ?? 0) : 0),
      mana: member.mana,
      manaCost: member.manaCost,
      isEvolved: member.isEvolved,
    })),
  };
}

export type StartBattleFailure =
  | 'no_creatures'
  | 'not_your_creature'
  | 'battle_already_active'
  | 'not_enough_stamina'
  | 'no_enemies_available';

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
): Promise<StartBattleResult> {
  const db = await getDb();
  const config = await loadGameConfig();

  if (creatureIds.length === 0) return { ok: false, reason: 'no_creatures' };

  const roster = await db
    .select({
      id: creatures.id,
      playerId: creatures.playerId,
      lastFed: creatures.lastFed,
      speciesId: creatures.speciesId,
      manaCost: species.manaCost,
      element: species.baseElement,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(inArray(creatures.id, [...creatureIds]));

  if (roster.length !== creatureIds.length) {
    return { ok: false, reason: 'not_your_creature' };
  }
  if (roster.some((row) => row.playerId !== playerId)) {
    return { ok: false, reason: 'not_your_creature' };
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
      reason: 'not_enough_stamina',
      detail: `Necesita ${tired.spend.required} de stamina y tiene ${tired.spend.staminaBefore}`,
    };
  }

  /** The enemy wave: published species that are not on the team. */
  const teamSpeciesIds = new Set(roster.map((row) => row.speciesId));
  const pool = (await db.select().from(species).where(eq(species.isPublished, true))).filter(
    (row) => !teamSpeciesIds.has(row.id),
  );
  if (pool.length === 0) return { ok: false, reason: 'no_enemies_available' };

  /**
   * The rival lineup: two creatures, both on screen. They have no health —
   * damage goes to the rival PLAYER — so only their element and their hit
   * matter here.
   */
  const rivals = pool.slice(0, 2).map((row) => ({
    id: row.slug,
    name: row.name,
    element: row.baseElement,
    attack: Math.max(1, Math.round(row.baseAttack / 3)),
  }));

  const board = createPlayableBoard(
    {
      width: config.combat.boardWidth,
      height: config.combat.boardHeight,
      minMatchLength: config.combat.minMatchLength,
    },
    Math.random,
  );

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(battles)
        .values({
          playerId,
          gameId: config.gameId,
          board: storedBoardSchema.parse(board),
          rivals: storedRivalListSchema.parse(rivals),
          playerMaxHp: config.combat.playerMaxHp,
          playerHp: config.combat.playerMaxHp,
          opponentMaxHp: config.combat.playerMaxHp,
          opponentHp: config.combat.playerMaxHp,
        })
        .returning();
      if (!created) throw new Error('No se pudo crear la partida');

      for (const [slot, entry] of spends.entries()) {
        if (!entry.spend.ok) throw new Error('stamina check changed mid-transaction');
        await tx
          .update(creatures)
          .set({ lastFed: entry.spend.lastFed })
          .where(eq(creatures.id, entry.row.id));

        await tx.insert(battleCreatures).values({
          battleId: created.id,
          creatureId: entry.row.id,
          slot,
          mana: 0,
          manaCost: entry.row.manaCost,
        });
      }

      await advanceObjectives(tx, playerId, creatureIds, { matches_played: 1 }, now);

      return { ok: true as const, battleId: created.id };
    });
  } catch (error) {
    /** The unique index is what actually enforces one battle at a time. */
    if (violates(error, 'battles_one_active_per_player')) {
      return { ok: false, reason: 'battle_already_active' };
    }
    throw error;
  }
}

export type PlayMoveFailure =
  | 'battle_not_found'
  | 'not_your_battle'
  | 'battle_finished'
  | 'not_adjacent'
  | 'out_of_bounds'
  | 'no_match';

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

export type PlayMoveResult =
  | {
      ok: true;
      view: BattleView;
      /** The swapped board BEFORE anything cleared, so the swap can be shown. */
      swapped: string[];
      steps: AnimationStep[];
      log: {
        damageToOpponent: number;
        damageToPlayer: number;
        absorbedByShield: number;
        healed: number;
        specialsFired: string[];
        gemsByElement: Record<BaseElement, number>;
        foodGained: number;
        drakofrutaGained: number;
        coinsGained: number;
        cascades: number;
        status: 'active' | 'won' | 'lost' | 'abandoned';
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

  const [row] = await db.select().from(battles).where(eq(battles.id, battleId)).limit(1);
  if (!row) return { ok: false, reason: 'battle_not_found' };
  if (row.playerId !== playerId) return { ok: false, reason: 'not_your_battle' };
  if (row.status !== 'active') return { ok: false, reason: 'battle_finished' };

  const view = await toView(battleId);
  if (!view) return { ok: false, reason: 'battle_not_found' };

  const move = resolveMove(
    view.board,
    from,
    to,
    {
      minMatchLength: config.combat.minMatchLength,
      maxCascades: config.combat.maxCascades,
      /** A swap that aligns nothing is a legal move that spends the turn. */
      allowNonMatching: config.combat.allowFreeSwaps,
    },
    Math.random,
  );
  if (!move.ok) return { ok: false, reason: move.reason };

  /** The board with the swap applied, before anything was cleared. */
  const swappedTiles = [...view.board.tiles];
  const fromIndex = from.row * view.board.width + from.col;
  const toIndex = to.row * view.board.width + to.col;
  const fromTile = swappedTiles[fromIndex];
  const toTile = swappedTiles[toIndex];
  if (fromTile !== undefined && toTile !== undefined) {
    swappedTiles[fromIndex] = toTile;
    swappedTiles[toIndex] = fromTile;
  }

  /** Rebuild the domain state from rows, so the engine never trusts the client. */
  const teamRows = await db
    .select({
      creatureId: battleCreatures.creatureId,
      mana: battleCreatures.mana,
      manaCost: battleCreatures.manaCost,
      isEvolved: creatures.isEvolved,
      element: species.baseElement,
      attack: species.baseAttack,
      effects: species.effects,
      pathBonus: evolutionPaths.attackBonus,
      pathEffects: evolutionPaths.effects,
    })
    .from(battleCreatures)
    .innerJoin(creatures, eq(creatures.id, battleCreatures.creatureId))
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .leftJoin(evolutionPaths, eq(evolutionPaths.id, creatures.evolutionPathId))
    .where(eq(battleCreatures.battleId, battleId))
    .orderBy(battleCreatures.slot);

  const team: Combatant[] = teamRows.map((member) => ({
    creatureId: member.creatureId,
    baseElement: member.element as BaseElement,
    baseAttack: member.attack,
    pathAttackBonus: member.isEvolved ? (member.pathBonus ?? 0) : 0,
    isEvolved: member.isEvolved,
    effects: [
      ...parseEffectList(member.effects),
      ...(member.isEvolved ? parseEffectList(member.pathEffects ?? []) : []),
    ],
    manaCost: member.manaCost,
    mana: member.mana,
  }));

  const rivals: Rival[] = view.rivals.map((rival) => ({ ...rival }));
  const state = {
    playerMaxHp: row.playerMaxHp,
    playerHp: row.playerHp,
    opponentMaxHp: row.opponentMaxHp,
    opponentHp: row.opponentHp,
    shield: row.shield,
    shieldTurns: row.shieldTurns,
    team,
    rivals,
    turn: row.turn,
    status: 'active' as const,
  };

  /** Conditions like `damage_by_type` read the front rival's element. */
  const outcome = resolveTurn({
    move,
    team,
    enemyElement: rivals[0]?.element ?? 'water',
    config: config.combat,
  });
  const applied = applyTurn(state, outcome);

  const finished = applied.state.status !== 'active';

  await db.transaction(async (tx) => {
    await tx
      .update(battles)
      .set({
        board: storedBoardSchema.parse(move.board),
        playerHp: applied.state.playerHp,
        opponentHp: applied.state.opponentHp,
        shield: applied.state.shield,
        shieldTurns: applied.state.shieldTurns,
        turn: applied.state.turn,
        status: applied.state.status,
        ...(finished ? { endedAt: now } : {}),
      })
      .where(eq(battles.id, battleId));

    for (const member of applied.state.team) {
      await tx
        .update(battleCreatures)
        .set({ mana: member.mana })
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
        damage_dealt: applied.log.damageToOpponent,
        enemies_defeated: applied.state.status === 'won' ? 1 : 0,
        max_combo: outcome.longestCombo,
        matches_won: applied.state.status === 'won' ? 1 : 0,
        element_gems_cleared_fire: outcome.gemsByElement.fire,
        element_gems_cleared_water: outcome.gemsByElement.water,
        element_gems_cleared_plant: outcome.gemsByElement.plant,
        element_gems_cleared_psychic: outcome.gemsByElement.psychic,
      },
      now,
    );

    /**
     * Food comes off the board; drakofruta and coins come from CLEARING THE
     * WAVE. Both are written here, inside the same transaction that resolved
     * the move, so a reward can never be claimed twice.
     */
    const won = applied.state.status === 'won';
    if (outcome.foodGained > 0 || won) {
      const [player] = await tx.select().from(players).where(eq(players.id, playerId)).limit(1);
      if (player) {
        await tx
          .update(players)
          .set({
            food: player.food + outcome.foodGained,
            drakofruta: player.drakofruta + (won ? config.play.drakofrutaPerWin : 0),
            coins: player.coins + (won ? config.play.coinsPerWin : 0),
          })
          .where(eq(players.id, playerId));
      }
    }
  });

  const refreshed = await toView(battleId);
  if (!refreshed) return { ok: false, reason: 'battle_not_found' };

  /**
   * `move.steps` carries the board after each clear; the cleared indices are
   * derived from the board the step started on, so the first frame uses the
   * swapped board and each later one uses the previous step's result.
   */
  let previousTiles: readonly string[] = swappedTiles;
  const steps: AnimationStep[] = move.steps.map((step) => {
    const before = previousTiles;
    const after = step.boardAfter.tiles;
    const cleared: number[] = [];
    for (const run of step.runs) {
      for (const position of run.positions) {
        cleared.push(position.row * step.boardAfter.width + position.col);
      }
    }
    previousTiles = after;
    void before;
    return { cleared: [...new Set(cleared)], tiles: [...after] };
  });

  return {
    ok: true,
    view: refreshed,
    swapped: swappedTiles,
    steps,
    log: {
      damageToOpponent: applied.log.damageToOpponent,
      damageToPlayer: applied.log.damageToPlayer,
      absorbedByShield: applied.log.absorbedByShield,
      healed: applied.log.healed,
      specialsFired: [...applied.log.specialsFired],
      gemsByElement: outcome.gemsByElement,
      foodGained: outcome.foodGained,
      drakofrutaGained: applied.state.status === 'won' ? config.play.drakofrutaPerWin : 0,
      coinsGained: applied.state.status === 'won' ? config.play.coinsPerWin : 0,
      cascades: outcome.cascades,
      status: applied.state.status,
    },
  };
}

export async function abandonBattle(battleId: string, playerId: string, now: Date): Promise<void> {
  const db = await getDb();
  await db
    .update(battles)
    .set({ status: 'abandoned', endedAt: now })
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
      objective.metric === 'element_gems_cleared'
        ? `element_gems_cleared_${(objective.params as { element?: string }).element ?? ''}`
        : objective.metric;
    const amount = deltas[key];
    if (amount === undefined || amount === 0) continue;

    const targets =
      objective.scope === 'creature' ? creatureIds.map((id) => id) : [null as string | null];

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
        { id: objective.id, metric: objective.metric, targetValue: objective.targetValue },
        { currentValue: current?.currentValue ?? 0, completedAt: current?.completedAt ?? null },
        amount,
        now,
      );
      if (!update.changed) continue;

      if (current) {
        await tx
          .update(objectiveProgress)
          .set({ currentValue: update.currentValue, completedAt: update.completedAt })
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
