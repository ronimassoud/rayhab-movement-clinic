// What a live deployment actually sends: the security headers, the private
// pages' caching and indexing, redirects, the 404 page, the API, and TLS.
// Run by .github/workflows/live-check.yml each time Vercel finishes a
// deployment, or by hand:
//
//   node infra/vercel/check-live.mjs https://dr-rayhab.com --production
//   node infra/vercel/check-live.mjs https://staging.dr-rayhab.com
//
// A preview behind Vercel's Deployment Protection needs the project's
// "Protection Bypass for Automation" secret in VERCEL_BYPASS (sent as the
// x-vercel-protection-bypass header). Exit code 0 when everything holds.
import tls from 'node:tls';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https:\/\//.test(a)) || '').replace(/\/+$/, '');
const production = args.includes('--production');
if (!base) { console.error('Usage: node infra/vercel/check-live.mjs https://<host> [--production]'); process.exit(2); }
const host = new URL(base).host;
const bypass = process.env.VERCEL_BYPASS || '';
const auth = bypass ? { 'x-vercel-protection-bypass': bypass } : {};

let failed = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failed++; console.log('  FAIL  ' + m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function get(path, opts = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(base + path, { redirect: 'manual', ...opts, headers: { ...auth, ...(opts.headers || {}) } });
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));   // DNS or a just-assigned domain
    }
  }
}
const h = (r, name) => (r.headers.get(name) || '').toLowerCase();

async function main() {
  console.log(`${base} (${production ? 'production' : 'preview'})`);

  const home = await get('/');
  if (home.status === 401 || home.status === 403) {
    bad(`the site answers ${home.status}: Deployment Protection is on; set VERCEL_BYPASS`);
    return;
  }
  check(home.status === 200, `/ answers 200 (${home.status})`);
  const html = await home.text();

  console.log('Security headers');
  const csp = h(home, 'content-security-policy');
  check(/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp), 'Content-Security-Policy');
  check(/script-src 'self'( 'sha256-[^']+')+;/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp), 'scripts locked to self and hashes');
  const hsts = /max-age=(\d+)/.exec(h(home, 'strict-transport-security'));
  check(hsts && Number(hsts[1]) >= 86400, `Strict-Transport-Security (${hsts ? 'max-age=' + hsts[1] : 'missing'})`);
  check(h(home, 'x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  check(h(home, 'x-frame-options') === 'deny', 'X-Frame-Options: DENY');
  check(h(home, 'referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer-Policy');
  check(/camera=\(\)/.test(h(home, 'permissions-policy')), 'Permissions-Policy');

  console.log('Indexing and demo mode');
  const noindex = /<meta name="robots" content="noindex/i.test(html);
  const demo = /name="rayhab-demo"/i.test(html);
  if (production) {
    check(!noindex, 'production pages are indexable');
    check(!demo, 'production pages do not allow demo mode');
  } else {
    check(noindex, 'preview pages are noindex');
  }

  console.log('Private pages');
  for (const path of ['/admin/', '/payment/']) {
    const r = await get(path);
    check(r.status === 200, `${path} answers 200 (${r.status})`);
    check(h(r, 'cache-control').includes('no-store'), `${path} Cache-Control: no-store`);
    check(h(r, 'x-robots-tag').includes('noindex'), `${path} X-Robots-Tag: noindex`);
    if (path === '/payment/') check(h(r, 'referrer-policy') === 'no-referrer', '/payment/ Referrer-Policy: no-referrer');
  }

  console.log('Routing');
  const missing = await get('/no-such-page-' + Date.now());
  check(missing.status === 404, `a missing page answers 404 (${missing.status})`);
  const old = await get('/services/frc-joint-training.html');
  check([301, 308].includes(old.status) && (old.headers.get('location') || '').includes('/services/joint-training-mobility'), 'the old service URL redirects');
  const plain = await fetch('http://' + host + '/', { redirect: 'manual', headers: auth }).catch(() => null);
  check(plain && [301, 308].includes(plain.status) && (plain.headers.get('location') || '').startsWith('https://'), 'http:// redirects to https://');
  if (production) {
    const www = await fetch('https://www.' + host + '/', { redirect: 'manual' }).catch(() => null);
    check(www && [301, 308].includes(www.status) && (www.headers.get('location') || '').startsWith(base), 'www redirects to the apex');
  }

  console.log('API');
  const health = await get('/api/health');
  const body = await health.json().catch(() => null);
  check(health.status === 200 && body && body.ok === true, `/api/health is ok (${health.status})`);
  check(h(health, 'cache-control').includes('no-store'), '/api/health is not cached');
  const staff = await get('/api/admin/appointments');
  check(staff.status === 401, `staff data answers 401 without a session (${staff.status})`);
  const link = await get('/api/payment-selection');
  check(link.status === 404, `the payment endpoint refuses a request without a token (${link.status})`);
  const cron = await get('/api/cron/worker');
  check(cron.status === 401, `the cron route refuses a request without its secret (${cron.status})`);

  console.log('TLS');
  const legacy = await new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT:@SECLEVEL=0' });
    s.once('secureConnect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(8000, () => { s.destroy(); resolve(false); });
  });
  check(!legacy, 'TLS 1.0 and 1.1 are refused');
  const modern = await new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, minVersion: 'TLSv1.2' });
    s.once('secureConnect', () => { const v = s.getProtocol(); s.destroy(); resolve(v); });
    s.once('error', () => resolve(null));
  });
  check(modern === 'TLSv1.3' || modern === 'TLSv1.2', `TLS 1.2 or newer works (${modern || 'failed'})`);
}

main().then(() => {
  console.log(failed ? `\n${failed} check(s) failed.` : '\nEverything holds.');
  process.exit(failed ? 1 : 0);
}, (e) => { console.error('could not reach ' + base + ': ' + e.message); process.exit(1); });
