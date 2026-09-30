'use server';

import { revalidatePath } from 'next/cache';
import { feedCreatureSchema } from '@/core/schemas/creature';
import { feedCreature } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';

/**
 * Care actions.
 *
 * The client sends ids and a number of food units. Never a stamina value, never
 * a fruit cost, never a completion flag — those are recomputed from rows every
 * time, so a stale page showing an old cost cannot pay an old price.
 */

export type CareActionState = {
  ok: boolean;
  message?: string;
};

const REASONS: Record<string, string> = {
  not_found: 'No encuentro esa kriatura',
  no_food: 'No te queda comida. Consíguela alineando fichas de comida.',
  already_full: 'Ya está a tope de stamina — no gastes comida',
};

const describe = (reason: string): string => REASONS[reason] ?? 'No se pudo completar';

export async function feedAction(
  _prev: CareActionState,
  form: FormData,
): Promise<CareActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = feedCreatureSchema.safeParse({
    creatureId: String(form.get('creatureId') ?? ''),
    foodUnits: Number(form.get('foodUnits') ?? 1),
  });
  if (!parsed.success) return { ok: false, message: 'Datos no válidos' };

  const result = await feedCreature(
    parsed.data.creatureId,
    player.id,
    parsed.data.foodUnits,
    new Date(),
  );
  revalidatePath('/kriaturas');
  revalidatePath(`/kriaturas/${parsed.data.creatureId}`);
  revalidatePath('/jugar');

  return result.ok
    ? {
        ok: true,
        message: `Stamina ${result.staminaBefore} → ${result.staminaAfter} · gastaste ${result.unitsConsumed} de comida`,
      }
    : { ok: false, message: describe(result.reason) };
}
