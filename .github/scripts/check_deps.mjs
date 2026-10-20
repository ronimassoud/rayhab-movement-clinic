// Dependencies: licenses and known vulnerabilities, for both npm lockfiles.
//
//   node .github/scripts/check_deps.mjs [--sbom <dir>]
//
// With --sbom it also writes a CycloneDX 1.5 bill of materials per lockfile
// into <dir> (every package, version and license, from the lockfile itself).
//
// Fails the build when
//   - a package's license is not on the list below (a new license is a
//     decision, not an accident: add it here with the reason), or
//   - npm reports a high or critical advisory that is not accepted below,
//     or whose acceptance has passed its review date.
//
// What reaches visitors' browsers is GSAP (vendored, site/assets/js/vendor)
// and the two OFL fonts (site/assets/fonts, license files beside them);
// everything else here only builds the stylesheet or runs local tests. The
// PHP API uses no packages at all, so its own source is its whole bill of
// materials.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKFILES = ['.', 'api/dev'];

const LICENSES = new Set([
  'MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0',
  // lightningcss and its platform builds (Tailwind's CSS engine). File-level
  // copyleft that applies only if its own files are modified and shipped;
  // it runs at build time and none of it is published.
  'MPL-2.0',
  // GSAP 3.13+: free for commercial use under its Standard License; the
  // vendored files are unmodified (site/assets/js/vendor/README.md).
  "Standard 'no charge' license: https://gsap.com/standard-license.",
]);

// Advisories accepted for now, each with the reason and a date to look again.
const ACCEPTED = {
  'GHSA-vfj7-8cjw-p6xm': {
    reason: 'braces (via @tailwindcss/cli 4.3.3, its file watcher): stack exhaustion on deeply nested glob patterns. '
          + 'Runs only at build time on the project\'s own fixed patterns; nothing user-supplied reaches it. npm\'s "fix" is a downgrade.',
    review: '2027-01-20',
  },
};

const problems = [];
const today = new Date().toISOString().slice(0, 10);
const sbomAt = process.argv.indexOf('--sbom');
const sbomDir = sbomAt > 0 ? process.argv[sbomAt + 1] : null;
const SPDX = /^[A-Za-z0-9.+-]+$/;

for (const dir of LOCKFILES) {
  const lock = JSON.parse(readFileSync(join(ROOT, dir, 'package-lock.json'), 'utf8'));
  let n = 0;
  const components = [];
  for (const [path, pkg] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    n++;
    const name = path.replace(/.*node_modules\//, '');
    const license = pkg.license || 'UNKNOWN';
    if (!LICENSES.has(license)) problems.push(`${dir}: ${name}@${pkg.version} has license "${license}", which is not on the allowed list`);
    components.push({
      type: 'library', name, version: pkg.version,
      purl: `pkg:npm/${name.startsWith('@') ? '%40' + name.slice(1) : name}@${pkg.version}`,
      scope: pkg.optional ? 'optional' : 'required',
      licenses: [{ license: SPDX.test(license) ? { id: license } : { name: license } }],
      ...(pkg.integrity ? { hashes: [{ alg: pkg.integrity.split('-')[0].toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(pkg.integrity.split('-')[1], 'base64').toString('hex') }] } : {}),
    });
  }
  if (sbomDir) {
    mkdirSync(sbomDir, { recursive: true });
    const label = dir === '.' ? 'site-build' : dir.replace(/\W+/g, '-');
    writeFileSync(join(sbomDir, `${label}.cdx.json`), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
      metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: lock.name || label } },
      components,
    }, null, 2) + '\n');
  }

  let audit;
  try {
    audit = JSON.parse(execSync('npm audit --json', { cwd: join(ROOT, dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    if (!e.stdout) throw e;
    audit = JSON.parse(e.stdout);
  }
  if (audit.error) throw new Error(`${dir}: npm audit failed: ${audit.error.summary || JSON.stringify(audit.error)}`);
  const seen = new Set();
  for (const v of Object.values(audit.vulnerabilities || {})) {
    for (const via of v.via) {
      if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
      const id = (via.url || '').split('/').pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const ok = ACCEPTED[id];
      if (!ok) problems.push(`${dir}: ${via.severity} advisory ${id} in ${via.name}: ${via.title} (${via.url})`);
      else if (ok.review < today) problems.push(`${dir}: accepted advisory ${id} passed its review date (${ok.review}); check it again`);
      else console.log(`accepted until ${ok.review}: ${id} in ${via.name}`);
    }
  }
  console.log(`${dir}: ${n} packages, licenses checked, ${seen.size} high or critical advisory id(s) seen`);
}

if (problems.length) {
  console.log(`\n${problems.length} dependency problem(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('dependencies: licenses allowed, no unaccepted high or critical advisories');
