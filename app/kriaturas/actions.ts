'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { chooseEvolutionPathSchema } from '@/core/schemas/evolution';
import { feedCreatureSchema } from '@/core/schemas/creature';
import { chooseEvolutionPath, evolveCreature, feedCreature } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';

/**
 * Care and evolution actions.
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
  path_not_found: 'Esa vía de evolución no existe',
  path_not_chosen: 'Elige antes una vía de evolución',
  path_choice_locked: 'Esta kriatura ya tiene su vía elegida, y es permanente',
  path_belongs_to_other_species: 'Esa vía no es de esta especie',
  already_evolved: 'Esta kriatura ya evolucionó. Es irreversible.',
  objectives_incomplete: 'Todavía le faltan objetivos',
  insufficient_fruits: 'No tienes suficiente drakofruta',
  max_evolutions_reached: 'Has alcanzado el máximo de evoluciones',
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

export async function choosePathAction(
  _prev: CareActionState,
  form: FormData,
): Promise<CareActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = chooseEvolutionPathSchema.safeParse({
    creatureId: String(form.get('creatureId') ?? ''),
    evolutionPathId: String(form.get('evolutionPathId') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: 'Datos no válidos' };

  const result = await chooseEvolutionPath(
    parsed.data.creatureId,
    player.id,
    parsed.data.evolutionPathId,
    new Date(),
  );
  revalidatePath(`/kriaturas/${parsed.data.creatureId}`);

  return result.ok
    ? { ok: true, message: 'Vía elegida. Es permanente.' }
    : { ok: false, message: describe(result.reason) };
}

export async function evolveAction(
  _prev: CareActionState,
  form: FormData,
): Promise<CareActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ creatureId: z.uuid(), evolutionPathId: z.uuid().nullable() })
    .safeParse({
      creatureId: String(form.get('creatureId') ?? ''),
      evolutionPathId: form.get('evolutionPathId') ? String(form.get('evolutionPathId')) : null,
    });
  if (!parsed.success) return { ok: false, message: 'Datos no válidos' };

  const result = await evolveCreature(
    parsed.data.creatureId,
    player.id,
    parsed.data.evolutionPathId,
    new Date(),
  );
  revalidatePath('/kriaturas');
  revalidatePath(`/kriaturas/${parsed.data.creatureId}`);

  return result.ok
    ? { ok: true, message: `¡Evolucionó a ${result.targetElement}! Gastaste ${result.cost} de drakofruta.` }
    : { ok: false, message: describe(result.reason) };
}
