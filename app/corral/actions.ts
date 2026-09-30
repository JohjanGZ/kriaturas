'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { feedCreatureSchema } from '@/core/schemas/creature';
import { buyCorral, cureCreature, moveCreature } from '@/db/queries/corral';
import { feedCreature } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';

/**
 * Corral actions. The client sends ids and a count of food units; the price of
 * a corral and what a unit of food restores are both read from config on the
 * server, never sent.
 */

export type CorralActionState = { ok: boolean; message?: string };

const REASONS: Record<string, string> = {
  not_yours: 'Esa kriatura no es tuya',
  full: 'Ese corral está lleno',
  not_for_sale: 'Ese corral no está a la venta',
  not_enough_coins: 'No te alcanzan las monedas',
  not_enough_food: 'No tienes comida suficiente',
  already_full: 'Ya está descansada del todo',
  creature_not_found: 'Esa kriatura no existe',
  not_sick: 'Esa kriatura no está enferma',
};

const describe = (reason: string): string => REASONS[reason] ?? 'No se pudo completar';

export async function feedInCorralAction(
  _prev: CorralActionState,
  form: FormData,
): Promise<CorralActionState> {
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

  revalidatePath('/corral');
  revalidatePath('/kriaturas');
  revalidatePath('/jugar');

  return result.ok
    ? { ok: true, message: `Stamina ${result.staminaBefore} → ${result.staminaAfter}` }
    : { ok: false, message: describe(result.reason) };
}

export async function buyCorralAction(
  _prev: CorralActionState,
  form: FormData,
): Promise<CorralActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ capacity: z.number().int().min(1).max(100) })
    .safeParse({ capacity: Number(form.get('capacity') ?? 0) });
  if (!parsed.success) return { ok: false, message: 'Corral no válido' };

  /** The PRICE is never sent: it is looked up from config by capacity. */
  const result = await buyCorral(player.id, parsed.data.capacity);
  revalidatePath('/corral');
  return result.ok
    ? { ok: true, message: 'Corral comprado' }
    : { ok: false, message: describe(result.reason) };
}

export async function moveCreatureAction(
  _prev: CorralActionState,
  form: FormData,
): Promise<CorralActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ creatureId: z.uuid(), corralId: z.uuid() })
    .safeParse({
      creatureId: String(form.get('creatureId') ?? ''),
      corralId: String(form.get('corralId') ?? ''),
    });
  if (!parsed.success) return { ok: false, message: 'Movimiento no válido' };

  const result = await moveCreature(parsed.data.creatureId, player.id, parsed.data.corralId);
  revalidatePath('/corral');
  return result.ok
    ? { ok: true, message: 'Kriatura movida' }
    : { ok: false, message: describe(result.reason) };
}

/**
 * La cura comprada. El PRECIO no viaja: se lee de la config en el servidor,
 * como todo lo que cuesta algo en este juego.
 */
export async function cureAction(
  _prev: CorralActionState,
  form: FormData,
): Promise<CorralActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ creatureId: z.uuid() })
    .safeParse({ creatureId: String(form.get('creatureId') ?? '') });
  if (!parsed.success) return { ok: false, message: 'Kriatura no válida' };

  const result = await cureCreature(parsed.data.creatureId, player.id);
  revalidatePath('/corral');
  revalidatePath('/kriaturas');
  revalidatePath('/jugar');

  return result.ok
    ? { ok: true, message: `Curada. Pagaste ${result.paid} monedas.` }
    : { ok: false, message: describe(result.reason) };
}
