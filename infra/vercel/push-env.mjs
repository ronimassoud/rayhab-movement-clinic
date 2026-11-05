// Puts the API's settings into the Vercel project's environment variables,
// from infra/connect.<env>.env, without printing them:
//
//   npx vercel login                 (once)
//   npx vercel link                  (once, in this folder: choose the project)
//   node infra/vercel/push-env.mjs staging
//   node infra/vercel/push-env.mjs production
//
// production -> the Production environment; staging -> Preview deployments of
// the redesign-2.0 branch (the staging site). Each variable is replaced, so
// running it again after changing the connect file updates Vercel. Vercel
// applies new values to the next deployment: redeploy afterwards.
import { spawnSync } from 'node:child_process';
import { settingsFor, BRANCH } from './settings.mjs';

const env = process.argv[2];
let s;
try { s = settingsFor(env); } catch (e) { console.error(e.message); process.exit(1); }
const target = env === 'production' ? ['production'] : ['preview', BRANCH.staging];

const vercel = (args, input) => spawnSync(`npx vercel ${args.join(' ')}`, { input, encoding: 'utf8', shell: true });
const who = vercel(['whoami']);
if (who.status !== 0) { console.error('Sign in first: npx vercel login, then npx vercel link (in this folder).'); process.exit(1); }

let ok = 0;
for (const [name, value] of Object.entries(s)) {
  vercel(['env', 'rm', name, ...target, '--yes']);                 // absent the first time; that's fine
  const r = vercel(['env', 'add', name, ...target], value);
  if (r.status !== 0) { console.error(`  ${name}: failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`); continue; }
  console.log(`  ${name}: set`);
  ok++;
}
console.log(`\n${ok} of ${Object.keys(s).length} variables set for ${env} (${target.join(' ')}).`);
console.log('Next: redeploy (Vercel > Deployments > Redeploy), then node api/dev/doctor.mjs ' + env + '.');
process.exit(ok === Object.keys(s).length ? 0 : 1);
