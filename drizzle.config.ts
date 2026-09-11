import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated with drizzle-kit and applied as SQL files.
 * `drizzle-kit push` is never used: schema changes always go through a migration.
 *
 * The driver is derived from DATABASE_URL exactly like db/client.ts does, so
 * `drizzle-kit studio` opens whichever database the app itself would use.
 */
const url = process.env.DATABASE_URL ?? 'file:./.pglite';
const isEmbedded = !url.startsWith('postgres');

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  ...(isEmbedded
    ? { driver: 'pglite' as const, dbCredentials: { url: url.replace(/^file:/, '') } }
    : { dbCredentials: { url } }),
  strict: true,
  verbose: true,
});
