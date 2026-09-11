import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared';
import { userRoleEnum } from './enums';

/**
 * Identity and authorisation.
 *
 * `role` is the ONLY source of truth for admin access. It is read server-side
 * on every admin request. A client-supplied role, claim or cookie flag is never
 * trusted, and the role is never accepted as input by any player-facing action.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    role: userRoleEnum('role').notNull().default('player'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
