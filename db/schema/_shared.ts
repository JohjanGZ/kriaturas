import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Every table carries created_at / updated_at, always timestamptz, always UTC.
 * Postgres stores timestamptz as an absolute instant; the driver hands it back
 * as a JS Date. Never use `timestamp without time zone` anywhere in this schema.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Shorthand for the one timestamptz configuration this project allows. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
