'use server';

import { revalidatePath } from 'next/cache';
import { isNeutral } from '@/core/balance';
import {
  activateSeasonSchema,
  createSeasonSchema,
  setAdjustmentSchema,
} from '@/core/schemas/season';
import { activateSeason, clearAdjustment, createSeason, setAdjustment } from '@/db/queries/season';
import { requireAdmin } from '@/lib/auth';

/**
 * Season actions.
 *
 * Every one calls `requireAdmin()` itself: an action is addressable on its own,
 * and the layout guard only decides what is drawn.
 */

export async function createSeasonAction(form: FormData): Promise<void> {
  await requireAdmin();
  const parsed = createSeasonSchema.safeParse({ name: String(form.get('name') ?? '') });
  if (!parsed.success) return;

  await createSeason(parsed.data.name, new Date());
  revalidatePath('/admin/temporadas');
}

export async function activateSeasonAction(form: FormData): Promise<void> {
  await requireAdmin();
  const parsed = activateSeasonSchema.safeParse({ seasonId: String(form.get('seasonId') ?? '') });
  if (!parsed.success) return;

  await activateSeason(parsed.data.seasonId, new Date());
  revalidatePath('/admin/temporadas');
  /** Battles read the running season, so the play screen must not serve a stale one. */
  revalidatePath('/jugar');
}

export async function setAdjustmentAction(form: FormData): Promise<void> {
  await requireAdmin();

  const note = String(form.get('note') ?? '').trim();
  const parsed = setAdjustmentSchema.safeParse({
    seasonId: String(form.get('seasonId') ?? ''),
    speciesId: String(form.get('speciesId') ?? ''),
    attackDelta: Number(form.get('attackDelta') ?? 0),
    manaCostDelta: Number(form.get('manaCostDelta') ?? 0),
    note: note.length > 0 ? note : null,
  });
  if (!parsed.success) return;

  /** An adjustment that changes nothing is not a row: it is the absence of one. */
  if (isNeutral(parsed.data)) {
    await clearAdjustment(parsed.data.seasonId, parsed.data.speciesId);
  } else {
    await setAdjustment(parsed.data);
  }

  revalidatePath('/admin/temporadas');
  revalidatePath('/jugar');
}
