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

    /** Powered days needed before it can hatch. */
    careDaysRequired: integer('care_days_required').notNull(),
    /**
     * Coins the incubator burns per day with this egg in it — the electricity
     * bill. A column and not a constant so a rarer egg can be slower AND more
     * expensive to run, which is the whole knob for tuning rarity later.
     */
    electricityCost: integer('electricity_cost').notNull().default(25),
    /**
     * Kept, unused: eggs no longer spoil. Being away never costs anything here,
     * the same rule the stamina model follows — an egg bought with coins earned
     * by playing must not be the one place that punishes a quiet week.
     */
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
 * AN INCUBATOR — the thing electricity is paid for.
 *
 * Its only real property is `capacityDays`: how far AHEAD its battery can be
 * charged. The free one everybody starts with holds a single day, so a
 * three-day egg wants three visits; the ones bought hold three or seven and
 * charge in one go.
 *
 * What that sells is AUTONOMY, never forgiveness. An unpowered egg simply sits
 * still — it never spoils — so a bigger battery buys not having to remember,
 * not protection from a punishment.
 */
export const incubators = pgTable(
  'incubators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    capacityDays: integer('capacity_days').notNull().default(1),
    /** What it cost, or 0 for the free one everybody is given. */
    paidAmount: integer('paid_amount').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('incubators_player_idx').on(t.playerId),
    check('incubators_capacity_positive', sql`${t.capacityDays} > 0`),
    check('incubators_paid_non_negative', sql`${t.paidAmount} >= 0`),
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

    /**
     * Which incubator holds it. An egg outside one cannot be powered at all, so
     * the number of incubators is what really limits how many eggs run at once.
     */
    incubatorId: uuid('incubator_id').references(() => incubators.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

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
    index('eggs_incubator_idx').on(t.incubatorId),
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
 * ONE ROW PER DAY PAID. `care_date` may be in the FUTURE: buying three days of
 * electricity writes three rows at once, and each arrives on its own.
 *
 * The unique index IS the anti-cheat: paying twice for the same day violates it,
 * so a day cannot be bought again, replayed or back-filled. `care_date` comes
 * from the server clock plus the eggs.dayBoundaryUtcOffsetMinutes config —
 * never from a client timestamp.
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
export type IncubatorRow = typeof incubators.$inferSelect;
