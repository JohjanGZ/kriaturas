'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { FIELD_KINDS } from '@/core/fields';
import { saveFieldSettings } from '@/db/queries/field';
import { AdminAccessError, requireAdmin } from '@/lib/auth';
import { MAX_IMAGE_BYTES, imageStorage } from '@/lib/storage';

/**
 * Editing a field's presentation.
 *
 * What can be changed here is its NAME, its sentence, its icon, its background
 * and whether it comes up. What cannot is the rule: a whirlwind shuffles the
 * board because `core/fields` says so, and no row in any table can turn it into
 * something else. That is the line this action keeps — it never writes a number
 * the engine reads.
 */

export type FieldActionState = { ok: boolean; message?: string };

export async function saveFieldAction(
  _prev: FieldActionState,
  form: FormData,
): Promise<FieldActionState> {
  try {
    await requireAdmin();

    const file = form.get('art');
    let imagePath: string | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          message: `La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
        };
      }
      const stored = await imageStorage().put({
        prefix: 'campos',
        filename: file.name,
        contentType: file.type,
        data: await file.arrayBuffer(),
      });
      imagePath = stored.key;
    }

    const parsed = z
      .strictObject({
        kind: z.enum(FIELD_KINDS),
        name: z.string().trim().min(2).max(60),
        rule: z.string().trim().min(4).max(400),
        icon: z.string().trim().min(1).max(8),
        isEnabled: z.boolean(),
        weight: z.number().int().min(1).max(100),
      })
      .safeParse({
        kind: String(form.get('kind') ?? ''),
        name: String(form.get('name') ?? '').trim(),
        rule: String(form.get('rule') ?? '').trim(),
        icon: String(form.get('icon') ?? '').trim(),
        isEnabled: form.get('isEnabled') === 'on',
        weight: Number(form.get('weight') ?? 1),
      });
    if (!parsed.success) {
      return { ok: false, message: 'Revisa los campos: nombre, regla, icono y peso' };
    }

    await saveFieldSettings(parsed.data.kind, {
      name: parsed.data.name,
      rule: parsed.data.rule,
      icon: parsed.data.icon,
      isEnabled: parsed.data.isEnabled,
      weight: parsed.data.weight,
      /** Absent means "keep the current artwork", never "clear it". */
      ...(imagePath !== undefined ? { imagePath } : {}),
    });

    revalidatePath('/admin/campos');
    revalidatePath('/jugar');
    return { ok: true, message: 'Campo guardado' };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    console.error(error);
    return { ok: false, message: 'Algo falló al guardar. Mira la consola del servidor.' };
  }
}
