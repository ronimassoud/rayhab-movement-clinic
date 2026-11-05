// Vercel's build step (vercel.json "buildCommand"). The site in site/ is
// committed ready to serve (stylesheet built, asset URLs stamped, sitemap
// written; CI checks all of it), so this only guards what goes out:
//
//   production (VERCEL_ENV=production):
//     - refuses pages still marked data-draft (the privacy notice and booking
//       terms until the legal adviser approves them), and
//     - refuses demo mode (the rayhab-demo flag);
//   preview (staging, branch deployments):
//     - marks every page noindex and allows demo mode, as the old GitHub Pages
//       staging copy did (content/staging_noindex.py).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'site';
const env = process.env.VERCEL_ENV || 'development';
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.html')) pages.push(p);
  }
})(SITE);

if (env === 'production') {
  const drafts = pages.filter((p) => readFileSync(p, 'utf8').includes('data-draft'));
  const demo = pages.filter((p) => readFileSync(p, 'utf8').includes('name="rayhab-demo"'));
  if (drafts.length) {
    console.error('Not deploying to production: these pages are drafts awaiting legal review.');
    for (const p of drafts) console.error('  ' + p);
    console.error('Once approved: resolve their placeholders, remove data-draft, the draft banner and the noindex tag, and link them (docs/production-runbook.md, step 13).');
    process.exit(1);
  }
  if (demo.length) { console.error('Demo mode is switched on in: ' + demo.join(', ')); process.exit(1); }
  console.log(`production: ${pages.length} pages, no drafts, no demo mode`);
} else {
  const NOINDEX = '<meta name="robots" content="noindex">';
  const DEMO = '<meta name="rayhab-demo" content="allowed">';
  let n = 0;
  for (const p of pages) {
    let html = readFileSync(p, 'utf8');
    const add = [!/<meta name="robots" content="[^"]*noindex/.test(html) && NOINDEX, !html.includes('name="rayhab-demo"') && DEMO].filter(Boolean);
    if (!add.length) continue;
    html = html.replace(/<head>/i, '<head>\n' + add.join('\n'));
    writeFileSync(p, html);
    n++;
  }
  console.log(`${env}: noindex and demo mode on ${n} of ${pages.length} pages`);
}
