import 'dotenv/config';
import { createConnection } from './client';

/**
 * Applies the SQL migrations in db/migrations.
 *
 * Schema changes ALWAYS go through a generated migration — `drizzle-kit push`
 * is never used, not even locally, so the local database and Neon are built by
 * exactly the same statements in exactly the same order.
 */
async function main(): Promise<void> {
  const { db, kind, close } = await createConnection();
  console.log(`Applying migrations with the ${kind} driver...`);

  try {
    /**
     * The migrator is driver-specific even though the database handle is not,
     * so this is the one place that switches. The cast is confined here.
     */
    if (kind === 'pglite') {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(db as never, { migrationsFolder: './db/migrations' });
    } else {
      const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
      await migrate(db as never, { migrationsFolder: './db/migrations' });
    }
    console.log('Migrations applied.');
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
