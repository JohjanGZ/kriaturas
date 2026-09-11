'use server';

import { revalidatePath } from 'next/cache';
import {
  abandonBattleSchema,
  playMoveSchema,
  startBattleSchema,
} from '@/core/schemas/battle';
import { abandonBattle, playMove, startBattle } from '@/db/queries/battle';
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
};

const REASONS: Record<string, string> = {
  no_creatures: 'Elige al menos una kriatura',
  not_your_creature: 'Esa kriatura no es tuya',
  battle_already_active: 'Ya tienes una partida en curso',
  not_enough_stamina: 'Tu kriatura está agotada. Dale de comer y vuelve.',
  no_enemies_available: 'No hay especies publicadas para formar enemigos',
  battle_not_found: 'Esa partida no existe',
  not_your_battle: 'Esa partida no es tuya',
  battle_finished: 'Esta partida ya terminó',
  not_adjacent: 'Esas casillas no se tocan',
  out_of_bounds: 'Fuera del tablero',
  no_match: 'Ese intercambio no alinea nada — no gastas jugada',
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
  });
  if (!parsed.success) return { ok: false, message: 'Selección de equipo no válida' };

  const result = await startBattle(player.id, parsed.data.creatureIds, new Date());
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
  /** A free swap clears nothing: "0 de daño" would read as a hit that failed. */
  const parts: string[] = [
    result.steps.length === 0 ? 'Moviste sin alinear' : `${log.damageToOpponent} de daño`,
  ];
  if (log.specialsFired.length > 0) parts.push(`⚡ especial x${log.specialsFired.length}`);
  if (log.healed > 0) parts.push(`+${log.healed} vida`);
  if (log.cascades > 0) parts.push(`${log.cascades} cascada(s)`);
  if (log.foodGained > 0) parts.push(`+${log.foodGained} comida`);
  if (log.drakofrutaGained > 0) parts.push(`+${log.drakofrutaGained} drakofruta`);
  if (log.coinsGained > 0) parts.push(`+${log.coinsGained} monedas`);
  if (log.damageToPlayer > 0) parts.push(`recibes ${log.damageToPlayer}`);
  if (log.status === 'won') parts.push('¡VICTORIA!');
  if (log.status === 'lost') parts.push('DERROTA');

  return {
    ok: true,
    message: parts.join(' · '),
    swapped: result.swapped,
    frames: result.steps,
  };
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
