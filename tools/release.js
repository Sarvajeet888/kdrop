#!/usr/bin/env node
/**
 * Release gate.
 *
 *   node tools/release.js check          verify this build is coherent
 *   node tools/release.js set 1.0.1      set the version everywhere at once
 *
 * A checklist you tick by hand records intention. This checks the build.
 *
 * Most of what it looks for is version drift — the Android version code not
 * incremented, the docs still claiming an older release, a placeholder left in
 * a file that ships. None of these break anything locally, and all of them are
 * embarrassing or rejected once published.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let fail = 0;
let warn = 0;
const ok = (m, d = '') => console.log(`  ok    ${m}${d ? '  — ' + d : ''}`);
const bad = (m, d = '') => { console.log(`  FAIL  ${m}${d ? '  — ' + d : ''}`); fail++; };
const soft = (m, d = '') => { console.log(`  warn  ${m}${d ? '  — ' + d : ''}`); warn++; };

/* ------------------------------------------------------------------ set */

function setVersion(next) {
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error('  version must look like 1.0.1');
    process.exit(1);
  }

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const previous = pkg.version;
  pkg.version = next;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  package.json      ${previous} → ${next}`);

  // Android needs a version NAME and an always-increasing version CODE. Play
  // refuses an upload whose code is not higher than the last one, and there is
  // no way to reuse a number once it has been consumed.
  const twaPath = path.join(ROOT, 'android', 'twa-manifest.json');
  if (fs.existsSync(twaPath)) {
    const twa = JSON.parse(fs.readFileSync(twaPath, 'utf8'));
    const code = (twa.appVersionCode || 0) + 1;
    twa.appVersionName = next;
    twa.appVersionCode = code;
    fs.writeFileSync(twaPath, JSON.stringify(twa, null, 2) + '\n');
    console.log(`  twa-manifest.json ${next}, version code ${code}`);
  }

  const docs = path.join(ROOT, 'public', 'docs.html');
  if (fs.existsSync(docs)) {
    const s = fs.readFileSync(docs, 'utf8')
      .replace(/Documentation · v[\d.]+/g, `Documentation · v${next}`);
    fs.writeFileSync(docs, s);
    console.log(`  docs.html         v${next}`);
  }

  console.log(`\n  Now: git commit, then git tag v${next}\n`);
}

/* ---------------------------------------------------------------- check */

function check() {
  console.log('\nRelease gate\n');

  const pkg = JSON.parse(read('package.json'));
  const version = pkg.version;
  console.log(`  version under test: ${version}\n`);

  /* ---- version agreement across everything that carries one ---- */
  if (exists('android/twa-manifest.json')) {
    const twa = JSON.parse(read('android/twa-manifest.json'));
    twa.appVersionName === version
      ? ok('android version name matches package.json')
      : bad('android version name is out of step', `${twa.appVersionName} vs ${version}`);
    Number.isInteger(twa.appVersionCode) && twa.appVersionCode > 0
      ? ok('android version code is set', String(twa.appVersionCode))
      : bad('android version code is missing or invalid');
  }

  const docs = read('public/docs.html');
  docs.includes(`Documentation · v${version}`)
    ? ok('documentation states the current version')
    : bad('documentation states a different version', 'run: node tools/release.js set ' + version);

  /* ---- placeholders that must not ship ---- */
  const placeholders = [
    ['public/security.html', 'add your security contact address here', 'a disclosure policy with nowhere to disclose to'],
    ['android/twa-manifest.json', 'REPLACE_WITH_YOUR_DOMAIN', 'the Android build points at nothing'],
    ['store/LISTING.md', 'YOUR-DOMAIN', 'the store listing has no working links'],
  ];
  for (const [file, needle, why] of placeholders) {
    if (!exists(file)) continue;
    read(file).includes(needle)
      ? bad(`${file} still has a placeholder`, why)
      : ok(`${file} has no placeholders`);
  }

  /* ---- the things that must exist before a public release ---- */
  const required = [
    'README.md', 'LICENSE', 'DEPLOY.md', 'TESTING.md', 'TESTERS.md',
    'public/privacy.html', 'public/terms.html', 'public/acceptable-use.html',
    'public/data-retention.html', 'public/security.html', 'public/status.html',
    'store/LISTING.md', 'store/feature-graphic.png', 'store/play-icon-512.png',
    'Dockerfile', 'render.yaml', '.env.example',
  ];
  const missing = required.filter((f) => !exists(f));
  missing.length
    ? bad(`${missing.length} required file(s) missing`, missing.join(', '))
    : ok(`all ${required.length} required files present`);

  const shots = exists('store/screenshots')
    ? fs.readdirSync(path.join(ROOT, 'store', 'screenshots')).filter((f) => f.endsWith('.png'))
    : [];
  shots.length >= 2
    ? ok(`${shots.length} store screenshots`)
    : bad('at least 2 store screenshots are required by Play');

  /* ---- dependencies ---- */
  exists('package-lock.json')
    ? ok('lockfile is committed', 'production builds are reproducible')
    : bad('package-lock.json is missing', 'npm ci cannot run, and versions may differ from what you tested');

  const devDeps = Object.keys(pkg.devDependencies || {});
  devDeps.length
    ? soft('dev dependencies present', `${devDeps.join(', ')} — fine, but they must not reach production`)
    : ok('no dev dependencies to leak into production');

  try {
    execSync('npm audit --omit=dev --audit-level=high', { cwd: ROOT, stdio: 'pipe' });
    ok('no high-severity dependency advisories');
  } catch {
    bad('npm audit reports a high-severity advisory');
  }

  /* ---- the app itself ---- */
  try {
    execSync('node --check server.js', { cwd: ROOT, stdio: 'pipe' });
    ok('server parses');
  } catch { bad('server has a syntax error'); }

  try {
    execSync('node tests/scan-secrets.js', { cwd: ROOT, stdio: 'pipe' });
    ok('no secrets in the working tree');
  } catch { bad('the secret scan found something'); }

  /* ---- git ---- */
  try {
    const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: 'pipe' }).toString().trim();
    dirty
      ? soft('working tree has uncommitted changes', 'a release should be built from a committed state')
      : ok('working tree is clean');

    const tags = execSync('git tag --list', { cwd: ROOT, stdio: 'pipe' }).toString();
    tags.includes(`v${version}`)
      ? ok(`tag v${version} exists`)
      : soft(`tag v${version} does not exist yet`, `git tag v${version}`);
  } catch {
    soft('not a git repository', 'version history is how you roll back');
  }

  /* ---- the parts only a person can confirm ---- */
  console.log('\n  Not checkable from here — confirm by hand:\n');
  for (const item of [
    'the site is live on your own domain over HTTPS',
    'TESTING.md has been completed on real devices',
    'the AAB installs from the internal testing track',
    'asset links verify: node tools/android-build.js verify https://your-domain',
    'you would send your own important file with this build',
  ]) console.log(`    [ ] ${item}`);

  console.log(fail
    ? `\n  ${fail} blocking problem(s)${warn ? `, ${warn} warning(s)` : ''}. Not a release candidate.\n`
    : `\n  No blocking problems${warn ? `, ${warn} warning(s)` : ''}. This build can be a release candidate\n  once the manual items above are true.\n`);
  process.exit(fail ? 1 : 0);
}

const [, , cmd, arg] = process.argv;
if (cmd === 'set' && arg) setVersion(arg);
else if (cmd === 'check') check();
else {
  console.log(`
  node tools/release.js check          verify this build is coherent
  node tools/release.js set 1.0.1      set the version everywhere at once
`);
  process.exit(1);
}
