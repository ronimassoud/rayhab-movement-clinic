// Applies the database migrations and the starting data to Supabase from this
// computer, using the schema owner's login in infra/connect.<env>.env:
//
//   node api/dev/migrate.mjs staging
//   node api/dev/migrate.mjs production
//
// On Vercel there is no server step before a deploy, so run this first
// whenever a deploy brings a new file in api/migrations (each runs once;
// running it again changes nothing). Nothing secret is printed.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { phpBinary, run } from './lib.mjs';

const env = process.argv[2];
if (!['staging', 'production'].includes(env)) {
  console.error('Usage: node api/dev/migrate.mjs <staging|production>');
  process.exit(2);
}
const file = fileURLToPath(new URL(`../../infra/connect.${env}.env`, import.meta.url));
if (!existsSync(file)) { console.error(`Missing infra/connect.${env}.env (copy infra/connect.example.env).`); process.exit(1); }
const url = (readFileSync(file, 'utf8').match(/^DATABASE_MIGRATE_URL=(.+)$/m) || [])[1]?.trim();
if (!url) { console.error(`DATABASE_MIGRATE_URL is empty in infra/connect.${env}.env.`); process.exit(1); }

const script = fileURLToPath(new URL('../bin/migrate.php', import.meta.url));
try {
  await run(phpBinary(), [script], { ...process.env, DATABASE_MIGRATE_URL: url });
  console.log(`${env}: migrations and starting data are in place.`);
} catch (e) {
  console.error(`${env}: migration failed (see above).`);
  process.exit(1);
}
