'use server';

import { revalidatePath } from 'next/cache';
import {
  abandonBattleSchema,
  dismissBattleSchema,
  evolveInBattleSchema,
  playMoveSchema,
  startBattleSchema,
} from '@/core/schemas/battle';
import {
  abandonBattle,
  dismissBattle,
  evolveCreatureInBattle,
  playMove,
  startBattle,
} from '@/db/queries/battle';
import { getCurrentPlayer } from '@/lib/auth';

/**
 * Player actions for a battle.
 *
 * The client may send FOUR NUMBERS and a battle id. Not a board, not a mana
 * value, not damage, not a timestamp. The schemas are strict, so anything else
 * is a validation error rather than a field that gets quietly dropped.
 *
 * `now` is taken here, from the server clock, and passed down. Nothing reads a
 * time the browser supplied.
 */

export type BattleActionState = {
  ok: boolean;
  message?: string;
  /** The board right after the swap, before anything cleared. */
  swapped?: string[];
  /** One frame per clear: what vanished, and the board once it settled. */
  frames?: { cleared: number[]; tiles: string[] }[];
  /**
   * What YOUR move did, so the bars can move WHEN THE BLOW LANDS.
   *
   * The server resolves your move and the bot's answer in one request, so the
   * page re-renders with the final health immediately — and the player saw
   * their life drop during their own turn, before the rival had visibly done
   * anything. The browser needs the pieces separately to pace them.
   */
  damageToOpponent?: number;
  healed?: number;
  /** Both fruit bars after this move, so they can be paced like the health. */
  fruits?: number;
  rivalFruits?: number;
  /** Set by the in-battle evolution, so the ceremony knows what to reveal. */
  evolvedInBattle?: { creatureId: string; element: string | null };
  /** Per creature: where its bar ended, and whether it fired this move. */
  attacks?: { id: string; manaAfter: number; manaCost: number; charged: boolean; damage: number }[];
  /**
   * The BOT's moves, replayed after yours. It plays the same board, so the
   * browser has to show its swap and its cascade too — otherwise the board
   * would simply be different next time you looked at it.
   */
  /**
   * WHAT THE FIELD DID. A board that changes with no explanation reads as a
   * glitch, so the mine's blast and the whirlwind's stir are reported as
   * events rather than left for the player to notice.
   */
  detonated?: number[];
  stirred?: 'shuffled' | 'gale' | null;
  fieldHealed?: number;
  /** The board was dead and had to be rebuilt: the player is owed that too. */
  reshuffled?: boolean;
  /**
   * Cells a power repainted, and the whole grid being rerolled.
   *
   * The server has always computed these and the browser has always thrown
   * them away — which is why tiles changed kind with no explanation whenever a
   * creature with `convert_tiles` fired.
   */
  convertedCells?: number[];
  convertedTo?: string | null;
  boardShuffled?: boolean;
  rival?: {
    from: { row: number; col: number };
    to: { row: number; col: number };
    swapped: string[];
    frames: { cleared: number[]; tiles: string[] }[];
    damageToPlayer: number;
    attacks: { id: string; manaAfter: number; manaCost: number; charged: boolean; damage: number }[];
  }[];
};

const REASONS: Record<string, string> = {
  no_creatures: 'Elige al menos una kriatura',
  not_your_creature: 'Esa kriatura no es tuya',
  battle_already_active: 'Ya tienes una partida en curso',
  not_enough_stamina: 'Tu kriatura está agotada. Dale de comer y vuelve.',
  creature_has_no_element:
    'Esa kriatura todavía no tiene elemento: ninguna gema del tablero la cargaría. Necesita una piedra elemental.',
  creature_is_sick: 'Esa kriatura está enferma. Cúrala en el corral.',
  duplicate_element:
    'No puedes llevar dos kriaturas del mismo elemento: una sola gema cargaría las dos barras.',
  no_enemies_available: 'No hay especies publicadas para formar enemigos',
  battle_not_found: 'Esa partida no existe',
  not_your_battle: 'Esa partida no es tuya',
  battle_finished: 'Esta partida ya terminó',
  not_adjacent: 'Esas casillas no se tocan',
  out_of_bounds: 'Fuera del tablero',
  no_match: 'Ese intercambio no alinea nada — no gastas jugada',
  not_enough_fruits: 'Todavía no tienes drakofruta suficiente en esta partida',
  not_in_battle: 'Esa kriatura no está en esta partida',
  already_evolved: 'Esa kriatura ya se transformó en esta partida',
};

function describe(reason: string, detail?: string): string {
  const base = REASONS[reason] ?? 'No se pudo completar la jugada';
  return detail ? `${base}. ${detail}` : base;
}

export async function startBattleAction(
  _prev: BattleActionState,
  form: FormData,
): Promise<BattleActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador. Ejecuta npm run db:seed' };

  const parsed = startBattleSchema.safeParse({
    creatureIds: form.getAll('creatureIds').map(String),
    /** The MODE is a choice; the field it rolls is not. */
    mode: String(form.get('mode') ?? 'normal'),
  });
  if (!parsed.success) return { ok: false, message: 'Selección de equipo no válida' };

  const result = await startBattle(
    player.id,
    parsed.data.creatureIds,
    new Date(),
    parsed.data.mode,
  );
  revalidatePath('/jugar');

  return result.ok
    ? { ok: true, message: '¡A pelear!' }
    : { ok: false, message: describe(result.reason, result.detail) };
}

export async function playMoveAction(
  _prev: BattleActionState,
  form: FormData,
): Promise<BattleActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = playMoveSchema.safeParse({
    battleId: String(form.get('battleId') ?? ''),
    fromRow: Number(form.get('fromRow')),
    fromCol: Number(form.get('fromCol')),
    toRow: Number(form.get('toRow')),
    toCol: Number(form.get('toCol')),
  });
  if (!parsed.success) return { ok: false, message: 'Jugada no válida' };

  const result = await playMove(
    parsed.data.battleId,
    player.id,
    { row: parsed.data.fromRow, col: parsed.data.fromCol },
    { row: parsed.data.toRow, col: parsed.data.toCol },
    new Date(),
  );
  revalidatePath('/jugar');

  if (!result.ok) return { ok: false, message: describe(result.reason) };

  const { log } = result;
  /**
   * A match is not a hit any more: it charges bars. Saying "0 de daño" on a
   * move that filled nothing would read as an attack that failed, when what
   * actually happened is that the bar went up.
   */
  const parts: string[] = [
    result.steps.length === 0
      ? 'Moviste sin alinear'
      : log.damageToOpponent > 0
        ? `${log.damageToOpponent} de daño`
        : 'cargas maná',
  ];
  if (log.specialsFired.length > 0) parts.push(`⚡ especial x${log.specialsFired.length}`);
  if (log.extraMoveGranted) parts.push('✦ jugada extra');
  if (log.healed > 0) parts.push(`+${log.healed} vida`);
  if (log.cascades > 0) parts.push(`${log.cascades} cascada(s)`);
  if (log.foodGained > 0) parts.push(`+${log.foodGained} comida`);
  if (log.fruitsGained > 0) parts.push(`+${log.fruitsGained} drakofruta (${log.fruits})`);
  if (log.rivalEvolved) parts.push(`el rival transformó a ${log.rivalEvolved}`);
  if (log.coinsGained > 0) parts.push(`+${log.coinsGained} monedas`);

  if (!log.turnOver && log.status === 'active') {
    parts.push(`te queda${log.movesLeft === 1 ? '' : 'n'} ${log.movesLeft} jugada(s)`);
  } else if (log.status === 'active') {
    parts.push(
      log.damageToPlayer > 0 ? `el rival te pega ${log.damageToPlayer}` : 'el rival carga maná',
    );
  }
  if (log.canEvolve) parts.push('✦ ¡puedes transformar una kriatura!');
  if (log.reshuffled) parts.push('sin jugadas posibles: tablero barajado');
  if (log.detonated.length > 0) parts.push(`💣 una mina se llevó ${log.detonated.length} fichas`);
  if (log.convertedCells.length > 0) {
    parts.push(`🎨 ${log.convertedCells.length} fichas ahora son de ${log.convertedTo ?? 'tu elemento'}`);
  }
  if (log.boardShuffled) parts.push('🌀 tablero revuelto por un poder');
  if (log.stirred === 'shuffled') parts.push('🌀 el remolino barajó el tablero');
  if (log.stirred === 'gale') parts.push('🌬 el vendaval movió una columna');
  if (log.fieldHealed > 0) parts.push(`+${log.fieldHealed} vida del campo`);
  if (log.fieldHealed < 0) parts.push(`${log.fieldHealed} de vida: el campo no perdona`);
  if (log.status === 'won') parts.push('¡VICTORIA!');
  if (log.status === 'lost') parts.push('DERROTA');

  return {
    ok: true,
    message: parts.join(' · '),
    swapped: result.swapped,
    frames: result.steps,
    damageToOpponent: log.damageToOpponent,
    healed: log.healed,
    fruits: log.fruits,
    rivalFruits: log.rivalFruits,
    attacks: log.attacks,
    detonated: log.detonated,
    stirred: log.stirred,
    fieldHealed: log.fieldHealed,
    reshuffled: log.reshuffled,
    convertedCells: log.convertedCells,
    convertedTo: log.convertedTo,
    boardShuffled: log.boardShuffled,
    rival: result.rivalMoves.map((rivalMove) => ({
      from: rivalMove.from,
      to: rivalMove.to,
      swapped: rivalMove.swapped,
      frames: rivalMove.steps,
      damageToPlayer: rivalMove.damageToPlayer,
      attacks: rivalMove.attacks,
    })),
  };
}

/**
 * Closes the result screen.
 *
 * The result lives in the row (`dismissed_at`), so only the server can decide
 * the player has seen it — a client that simply navigated away would find the
 * same screen waiting on the next load, which is the point.
 */
export async function dismissBattleAction(
  _prev: BattleActionState,
  form: FormData,
): Promise<BattleActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = dismissBattleSchema.safeParse({ battleId: String(form.get('battleId') ?? '') });
  if (!parsed.success) return { ok: false, message: 'Partida no válida' };

  await dismissBattle(parsed.data.battleId, player.id, new Date());
  revalidatePath('/jugar');
  return { ok: true };
}

/**
 * Spends the battle's fruit bar on one creature, for this battle only.
 *
 * The client sends a battle id and a creature id — never the bar, never the
 * threshold, never what the transformation is worth.
 */
export async function evolveInBattleAction(
  _prev: BattleActionState,
  form: FormData,
): Promise<BattleActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = evolveInBattleSchema.safeParse({
    battleId: String(form.get('battleId') ?? ''),
    creatureId: String(form.get('creatureId') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: 'Datos no válidos' };

  const result = await evolveCreatureInBattle(
    parsed.data.battleId,
    player.id,
    parsed.data.creatureId,
  );
  revalidatePath('/jugar');

  return result.ok
    ? {
        ok: true,
        message: `¡${result.name} se transformó${result.element ? ` en ${result.element}` : ''}!`,
        evolvedInBattle: { creatureId: parsed.data.creatureId, element: result.element },
      }
    : { ok: false, message: describe(result.reason) };
}

export async function abandonBattleAction(
  _prev: BattleActionState,
  form: FormData,
): Promise<BattleActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = abandonBattleSchema.safeParse({ battleId: String(form.get('battleId') ?? '') });
  if (!parsed.success) return { ok: false, message: 'Partida no válida' };

  await abandonBattle(parsed.data.battleId, player.id, new Date());
  revalidatePath('/jugar');
  return { ok: true, message: 'Partida abandonada' };
}
