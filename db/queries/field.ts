import { asc, eq } from 'drizzle-orm';
import { FIELD_KINDS, type FieldChoice, type FieldKind } from '@/core/fields';
import { getDb } from '../client';
import { battleFields } from '../schema';

/**
 * The fields, as the admin edits them.
 *
 * The RULE is still code (`core/fields`) — this is everything about a field
 * that is not its verb: its name, the sentence it shows, the artwork behind the
 * board, whether it comes up and how often.
 */

export type FieldSettings = {
  kind: FieldKind;
  name: string;
  rule: string;
  icon: string;
  imagePath: string | null;
  isEnabled: boolean;
  weight: number;
};

export async function listFieldSettings(): Promise<FieldSettings[]> {
  const db = await getDb();
  const rows = await db.select().from(battleFields).orderBy(asc(battleFields.name));

  /**
   * Ordered by the CODE's list, not by the table: the ten are a fixed set, and
   * a row missing from the database should show as a field with its defaults
   * rather than vanish from the panel.
   */
  return FIELD_KINDS.map((kind) => {
    const row = rows.find((entry) => entry.kind === kind);
    return {
      kind,
      name: row?.name ?? kind,
      rule: row?.rule ?? '',
      icon: row?.icon ?? '🎲',
      imagePath: row?.imagePath ?? null,
      isEnabled: row?.isEnabled ?? true,
      weight: row?.weight ?? 1,
    };
  });
}

/** One field's presentation, for the battle screen. Null when it has no row. */
export async function getFieldSettings(kind: string): Promise<FieldSettings | null> {
  const db = await getDb();
  const [row] = await db.select().from(battleFields).where(eq(battleFields.kind, kind)).limit(1);
  if (!row) return null;
  return {
    kind: row.kind as FieldKind,
    name: row.name,
    rule: row.rule,
    icon: row.icon,
    imagePath: row.imagePath,
    isEnabled: row.isEnabled,
    weight: row.weight,
  };
}

/**
 * What the draw may hand out. A field switched off is simply not in the list.
 *
 * Read at the START of a battle and never again, like the mana costs: turning a
 * field off must not move the rules under a fight already being played on it.
 */
export async function enabledFieldChoices(): Promise<FieldChoice[]> {
  const db = await getDb();
  const rows = await db.select().from(battleFields).where(eq(battleFields.isEnabled, true));

  /** No rows at all means a database that was never seeded: offer everything. */
  if (rows.length === 0) return FIELD_KINDS.map((kind) => ({ kind, weight: 1 }));

  return rows
    .filter((row): row is typeof row & { kind: FieldKind } =>
      (FIELD_KINDS as readonly string[]).includes(row.kind),
    )
    .map((row) => ({ kind: row.kind, weight: row.weight }));
}

export type FieldPatch = {
  name: string;
  rule: string;
  icon: string;
  isEnabled: boolean;
  weight: number;
  /** Absent means "keep the current artwork", not "clear it". */
  imagePath?: string | null;
};

/**
 * Writes one field's presentation. An upsert on `kind`, because the ten rows
 * are created with the seed and editing one is always an update of a row that
 * exists — the unique index is what guarantees there is exactly one per field.
 */
export async function saveFieldSettings(kind: FieldKind, patch: FieldPatch): Promise<void> {
  const db = await getDb();
  await db
    .insert(battleFields)
    .values({
      kind,
      name: patch.name,
      rule: patch.rule,
      icon: patch.icon,
      isEnabled: patch.isEnabled,
      weight: patch.weight,
      ...(patch.imagePath !== undefined ? { imagePath: patch.imagePath } : {}),
    })
    .onConflictDoUpdate({
      target: battleFields.kind,
      set: {
        name: patch.name,
        rule: patch.rule,
        icon: patch.icon,
        isEnabled: patch.isEnabled,
        weight: patch.weight,
        ...(patch.imagePath !== undefined ? { imagePath: patch.imagePath } : {}),
        updatedAt: new Date(),
      },
    });
}
