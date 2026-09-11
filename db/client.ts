import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/**
 * THE ONLY MODULE THAT KNOWS WHICH DRIVER IS RUNNING.
 *
 * Local development uses PGlite (embedded Postgres over WASM, stored in
 * ./.pglite — no Docker, no server). Production uses Neon over WebSockets from
 * Cloudflare Workers. The single difference between them is DATABASE_URL.
 *
 * Callers receive a `Db` and cannot tell the two apart: it is the generic
 * Drizzle Postgres interface that both drivers implement, transactions included.
 * Never import PGlite or Neon anywhere else.
 *
 * Neon is used over WebSockets, NOT over HTTP, on purpose: the HTTP driver
 * cannot do interactive transactions, and evolving a creature or buying an egg
 * must be atomic.
 */

export type Schema = typeof schema;

export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type DriverKind = 'pglite' | 'neon';

export type Connection = {
  db: Db;
  kind: DriverKind;
  close: () => Promise<void>;
};

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Local development expects file:./.pglite — see .env.example',
    );
  }
  return url;
}

/**
 * A `file:` URL (or a bare path) means the embedded database; a postgres URL
 * means the remote one. Anything else is a configuration mistake and fails loudly
 * rather than silently falling back to a local file in production.
 */
export function driverFor(url: string): DriverKind {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'neon';
  if (url.startsWith('file:') || url.startsWith('.') || url.startsWith('/')) return 'pglite';
  if (/^[a-zA-Z]:[\\/]/.test(url)) return 'pglite';
  throw new Error(`Unrecognised DATABASE_URL: expected postgres:// or file:, got "${url}"`);
}

/** ./.pglite for "file:./.pglite" — PGlite wants a directory, not a URL. */
export function dataDirFor(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

/**
 * Opens a NEW connection. Scripts (migrate, seed, tests) use this so they can
 * close it deterministically; the app uses the cached `getDb()` below.
 *
 * The driver is imported dynamically so the unused one never reaches the bundle:
 * a Worker must not carry the PGlite WASM payload.
 */
export async function createConnection(url: string = databaseUrl()): Promise<Connection> {
  const kind = driverFor(url);

  if (kind === 'pglite') {
    const [{ PGlite }, { drizzle }] = await Promise.all([
      import('@electric-sql/pglite'),
      import('drizzle-orm/pglite'),
    ]);
    const client = new PGlite(dataDirFor(url));
    const db = drizzle(client, { schema }) as unknown as Db;
    return { db, kind, close: () => client.close() };
  }

  const [{ Pool }, { drizzle }] = await Promise.all([
    import('@neondatabase/serverless'),
    import('drizzle-orm/neon-serverless'),
  ]);
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, kind, close: () => pool.end() };
}

/**
 * Cached connection for the app.
 *
 * Stored on globalThis because Next.js dev reloads modules on every edit, and a
 * fresh PGlite instance per reload would lock the same data directory twice.
 */
type ConnectionCache = { promise: Promise<Connection> | null };

const cache: ConnectionCache = ((globalThis as Record<string, unknown>).__kriaturasDb ??= {
  promise: null,
}) as ConnectionCache;

export function getConnection(): Promise<Connection> {
  cache.promise ??= createConnection();
  return cache.promise;
}

export async function getDb(): Promise<Db> {
  return (await getConnection()).db;
}
