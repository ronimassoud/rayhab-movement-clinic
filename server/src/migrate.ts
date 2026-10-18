/* npm run migrate: apply migrations, then make sure the starting data is
   there. Uses DATABASE_MIGRATE_URL (the schema owner) when set. */
import { connectPostgres } from './db/db.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';

const url = process.env.DATABASE_MIGRATE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_MIGRATE_URL (or DATABASE_URL).');
  process.exit(1);
}
const db = await connectPostgres(url);
try {
  await migrate(db);
  await seed(db);
} finally {
  await db.close();
}
