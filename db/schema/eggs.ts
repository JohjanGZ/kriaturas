import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, tstz } from './_shared';
import { creatures } from './creatures';
import { eggStatusEnum, resourceKindEnum } from './enums';
import { players } from './players';
import { species } from './species';

/**
 * EGG TYPES — what the shop sells. Admin-created, like species.
 * The price is a (resource, amount) pair so it can be coins today and something
 * else later without a schema change.
 */
export const eggTypes = pgTable(
  'egg_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    imagePath: text('image_path'),

    priceAmount: integer('price_amount').notNull(),
    priceResource: resourceKindEnum('price_resource').notNull().default('coins'),

    /** Successful care days needed before it can hatch. */
    careDaysRequired: integer('care_days_required').notNull(),
    /** Missed days tolerated before the egg spoils. */
    maxMissedDays: integer('max_missed_days').notNull().default(1),

    isPublished: boolean('is_published').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('egg_types_slug_key').on(t.slug),
    index('egg_types_is_published_idx').on(t.isPublished),
    check('egg_types_price_positive', sql`${t.priceAmount} > 0`),
    check('egg_types_care_days_positive', sql`${t.careDaysRequired} > 0`),
    check('egg_types_max_missed_non_negative', sql`${t.maxMissedDays} >= 0`),
  ],
);

/**
 * The weighted species pool for an egg type. The roll is server-side; the client
 * never sees the pool weights and never influences the draw.
 */
export const eggTypeSpecies = pgTable(
  'egg_type_species',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eggTypeId: uuid('egg_type_id')
      .notNull()
      .references(() => eggTypes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    weight: integer('weight').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('egg_type_species_key').on(t.eggTypeId, t.speciesId),
    index('egg_type_species_species_idx').on(t.speciesId),
    check('egg_type_species_weight_positive', sql`${t.weight} > 0`),
  ],
);

/**
 * A player-owned egg.
 *
 * `species_id` is rolled AT PURCHASE, server-side, and stored right away: the
 * outcome is fixed before the player can do anything about it, so there is
 * nothing to re-roll and nothing to influence. It is simply not exposed by any
 * query until `status = 'hatched'`.
 *
 * Care is tracked by rows in egg_care_log, not by a number the client sends.
 */
export const eggs = pgTable(
  'eggs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    eggTypeId: uuid('egg_type_id')
      .notNull()
      .references(() => eggTypes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** The pre-rolled outcome. Hidden until hatched. */
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    status: eggStatusEnum('status').notNull().default('incubating'),

    /** What was actually paid, for audit and for the spoiled-egg refund. */
    paidAmount: integer('paid_amount').notNull(),
    paidResource: resourceKindEnum('paid_resource').notNull(),

    /** Derived from egg_care_log by the server; never written from client input. */
    careDaysCompleted: integer('care_days_completed').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    lastCaredAt: tstz('last_cared_at'),

    hatchedAt: tstz('hatched_at'),
    spoiledAt: tstz('spoiled_at'),

    /** The creature this egg produced. One creature per egg. */
    creatureId: uuid('creature_id').references(() => creatures.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    ...timestamps,
  },
  (t) => [
    index('eggs_player_idx').on(t.playerId),
    index('eggs_status_idx').on(t.status),
    uniqueIndex('eggs_creature_key')
      .on(t.creatureId)
      .where(sql`${t.creatureId} is not null`),
    check('eggs_paid_amount_positive', sql`${t.paidAmount} > 0`),
    check('eggs_care_days_non_negative', sql`${t.careDaysCompleted} >= 0`),
    check('eggs_streak_non_negative', sql`${t.currentStreak} >= 0`),
    check(
      'eggs_hatched_state_consistent',
      sql`(${t.status} <> 'hatched' and ${t.hatchedAt} is null and ${t.creatureId} is null)
          or (${t.status} = 'hatched' and ${t.hatchedAt} is not null)`,
    ),
    check(
      'eggs_spoiled_state_consistent',
      sql`(${t.status} <> 'spoiled' and ${t.spoiledAt} is null)
          or (${t.status} = 'spoiled' and ${t.spoiledAt} is not null)`,
    ),
  ],
);

/**
 * One row per (egg, care day). The unique index IS the anti-cheat: a second care
 * action on the same server day violates it, so care cannot be spammed, replayed
 * or back-filled. `care_date` is computed from the server clock plus the
 * eggs.dayBoundaryUtcOffsetMinutes config — never from a client timestamp.
 */
export const eggCareLog = pgTable(
  'egg_care_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eggId: uuid('egg_id')
      .notNull()
      .references(() => eggs.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    careDate: date('care_date').notNull(),
    /** The exact server instant the care happened, for audit. */
    caredAt: tstz('cared_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('egg_care_log_egg_date_key').on(t.eggId, t.careDate),
    index('egg_care_log_egg_idx').on(t.eggId),
  ],
);

export type EggTypeRow = typeof eggTypes.$inferSelect;
export type NewEggTypeRow = typeof eggTypes.$inferInsert;
export type EggTypeSpeciesRow = typeof eggTypeSpecies.$inferSelect;
export type EggRow = typeof eggs.$inferSelect;
export type NewEggRow = typeof eggs.$inferInsert;
export type EggCareLogRow = typeof eggCareLog.$inferSelect;
