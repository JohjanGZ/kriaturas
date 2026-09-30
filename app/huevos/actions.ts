'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { buyEgg, buyIncubator, hatchEgg, powerEgg, setEggIncubator } from '@/db/queries/egg';
import { getCurrentPlayer } from '@/lib/auth';

/**
 * Incubator actions.
 *
 * The client may send an id and a number of days. Never a price, never a date,
 * never which species is inside. Every one of those is decided server-side from
 * rows the browser cannot reach: the price comes from the egg-type row, the day
 * from the server clock, and the species was rolled once at purchase.
 */

export type EggActionState = { ok: boolean; message?: string };

const REASONS: Record<string, string> = {
  egg_type_not_found: 'Ese huevo ya no está a la venta',
  not_enough_coins: 'No te alcanzan las monedas',
  too_many_eggs: 'Ya tienes todos los huevos que caben a la vez',
  empty_pool: 'Ese huevo no tiene especies publicadas detrás',
  egg_not_found: 'Ese huevo no existe o ya eclosionó',
  no_incubator: 'Ese huevo no está en ninguna incubadora',
  already_done: 'Ese huevo ya tiene pagados todos sus días',
  battery_full: 'La batería está llena: espera a que pasen los días que ya pagaste',
  not_ready: 'Todavía le faltan días con energía',
  already_hatched: 'Ese huevo ya eclosionó',
  not_for_sale: 'Esa incubadora no está a la venta',
};

const describe = (reason: string): string => REASONS[reason] ?? 'No se pudo completar';

export async function buyEggAction(
  _prev: EggActionState,
  form: FormData,
): Promise<EggActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z.strictObject({ eggTypeId: z.uuid() }).safeParse({
    eggTypeId: String(form.get('eggTypeId') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: 'Huevo no válido' };

  const result = await buyEgg(player.id, parsed.data.eggTypeId, new Date());
  revalidatePath('/huevos');
  return result.ok
    ? { ok: true, message: '¡Huevo comprado! Ya está en la incubadora.' }
    : { ok: false, message: describe(result.reason) };
}

export async function powerEggAction(
  _prev: EggActionState,
  form: FormData,
): Promise<EggActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ eggId: z.uuid(), days: z.number().int().min(1).max(30) })
    .safeParse({
      eggId: String(form.get('eggId') ?? ''),
      days: Number(form.get('days') ?? 1),
    });
  if (!parsed.success) return { ok: false, message: 'Recarga no válida' };

  const result = await powerEgg(parsed.data.eggId, player.id, parsed.data.days, new Date());
  revalidatePath('/huevos');
  return result.ok
    ? {
        ok: true,
        message: `Pagaste ${result.cost} monedas: ${result.days} día(s) con energía.`,
      }
    : { ok: false, message: describe(result.reason) };
}

export async function hatchEggAction(
  _prev: EggActionState,
  form: FormData,
): Promise<EggActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z.strictObject({ eggId: z.uuid() }).safeParse({
    eggId: String(form.get('eggId') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: 'Huevo no válido' };

  const result = await hatchEgg(parsed.data.eggId, player.id, new Date());
  revalidatePath('/huevos');
  revalidatePath('/kriaturas');
  return result.ok
    ? { ok: true, message: `¡Eclosionó! Es una ${result.name}.` }
    : { ok: false, message: describe(result.reason) };
}

export async function buyIncubatorAction(
  _prev: EggActionState,
  form: FormData,
): Promise<EggActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const parsed = z
    .strictObject({ capacityDays: z.number().int().min(1).max(30) })
    .safeParse({ capacityDays: Number(form.get('capacityDays') ?? 0) });
  if (!parsed.success) return { ok: false, message: 'Incubadora no válida' };

  /** The PRICE is never sent: it is looked up from config by capacity. */
  const result = await buyIncubator(player.id, parsed.data.capacityDays, new Date());
  revalidatePath('/huevos');
  return result.ok
    ? { ok: true, message: 'Incubadora comprada' }
    : { ok: false, message: describe(result.reason) };
}

export async function moveEggAction(
  _prev: EggActionState,
  form: FormData,
): Promise<EggActionState> {
  const player = await getCurrentPlayer();
  if (!player) return { ok: false, message: 'No hay jugador' };

  const raw = String(form.get('incubatorId') ?? '');
  const parsed = z
    .strictObject({ eggId: z.uuid(), incubatorId: z.uuid().nullable() })
    .safeParse({
      eggId: String(form.get('eggId') ?? ''),
      incubatorId: raw.length > 0 ? raw : null,
    });
  if (!parsed.success) return { ok: false, message: 'Movimiento no válido' };

  const result = await setEggIncubator(parsed.data.eggId, player.id, parsed.data.incubatorId);
  revalidatePath('/huevos');
  return result.ok
    ? { ok: true, message: 'Huevo movido' }
    : { ok: false, message: 'No se pudo mover ese huevo' };
}
