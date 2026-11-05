// Checks vercel.json in CI (api-ci.yml): the API function and its route, the
// worker's cron, the security headers, and that the Content-Security-Policy
// allows exactly the inline scripts the pages carry (each by its hash), so a
// changed inline script cannot silently stop running in production.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };

need(v.outputDirectory === 'site', 'outputDirectory must be site');
need(/vercel-php@/.test(v.functions?.['api/public/index.php']?.runtime || ''), 'api/public/index.php must use the vercel-php runtime');
need((v.rewrites || []).some((r) => r.source === '/api/:route*' && r.destination.startsWith('/api/public/index.php?__route=')), 'the /api rewrite to index.php is missing');
need((v.crons || []).some((c) => c.path === '/api/cron/worker' && c.schedule === '* * * * *'), 'the every-minute worker cron is missing');

const headersFor = (source) => Object.fromEntries(((v.headers || []).find((h) => h.source === source)?.headers || []).map((h) => [h.key.toLowerCase(), h.value]));
const all = headersFor('/(.*)');
for (const [k, want] of Object.entries({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin' })) {
  need(all[k] === want, `every response needs ${k}: ${want}`);
}
need(/^max-age=\d+/.test(all['strict-transport-security'] || ''), 'every response needs Strict-Transport-Security');
const priv = headersFor('/(admin|payment)/(.*)');
need(priv['cache-control'] === 'no-store' && /noindex/.test(priv['x-robots-tag'] || ''), 'admin and payment pages need no-store and noindex');
need(headersFor('/payment/(.*)')['referrer-policy'] === 'no-referrer', 'the payment page needs Referrer-Policy: no-referrer');

// Every executable inline script on a page must be allowed by its hash.
const csp = all['content-security-policy'] || '';
const allowed = new Set([...csp.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));
const used = new Map();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.html')) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type="application\/ld\+json"/.test(m[1])) continue;   // data, not run
      const h = createHash('sha256').update(m[2], 'utf8').digest('base64');
      if (!used.has(h)) used.set(h, p);
    }
  }
})('site');
for (const [h, page] of used) need(allowed.has(h), `the CSP does not allow an inline script in ${page} (add 'sha256-${h}')`);
for (const h of allowed) need(used.has(h), `the CSP allows a script hash no page uses any more: sha256-${h}`);

if (problems.length) {
  console.error(`${problems.length} problem(s) in vercel.json:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`vercel.json: function, route, cron and headers in place; ${used.size} inline script(s), each allowed by its hash`);
