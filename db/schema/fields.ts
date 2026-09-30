import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { FIELD_KINDS } from '@/core/fields';
import { timestamps } from './_shared';

/**
 * THE FIELDS, as the admin can edit them.
 *
 * What is NOT here is the rule. A whirlwind shuffles the board and a minefield
 * counts down, and those live in `core/fields` as code, because a field is a
 * sentence and not composed data — ten of them, fixed, each legible in one
 * line. Nothing in this table can invent an eleventh.
 *
 * What IS here is everything about a field that is not its verb: the name it
 * shows, the sentence that explains it, the artwork behind the board, and
 * whether it comes up at all. That last one is the real lever — a field that
 * turns out to be unfun is switched off from the panel instead of deleted from
 * a source file.
 *
 * `kind` is the join back to the code, and it is unique: one row per field, no
 * more and no fewer. A row for a kind that does not exist is refused by the
 * check, so a rename in `FIELD_KINDS` cannot leave orphan settings behind
 * pretending to configure something.
 */
export const battleFields = pgTable(
  'battle_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),

    name: text('name').notNull(),
    /** One sentence. A field nobody can restate in a line is one nobody plays around. */
    rule: text('rule').notNull(),
    icon: text('icon').notNull().default('🎲'),
    /** The artwork behind the board. Null falls back to the plain slate. */
    imagePath: text('image_path'),

    /** Off means it never comes up in the draw. The tuning lever, not a delete. */
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** Relative chance in the draw. Two weights the same is an even coin. */
    weight: integer('weight').notNull().default(1),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('battle_fields_kind_key').on(t.kind),
    check('battle_fields_weight_positive', sql`${t.weight} > 0`),
    check(
      'battle_fields_kind_is_known',
      sql.raw(
        `"battle_fields"."kind" in (${FIELD_KINDS.map((kind) => `'${kind}'`).join(', ')})`,
      ),
    ),
  ],
);

export type BattleFieldRow = typeof battleFields.$inferSelect;
