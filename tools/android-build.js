#!/usr/bin/env node
/**
 * Android build helper.
 *
 *   node tools/android-build.js check   https://your-domain
 *   node tools/android-build.js init    https://your-domain
 *   node tools/android-build.js verify  https://your-domain
 *
 * `check`  confirms the site is ready to be wrapped, before anything is built.
 * `init`   runs Bubblewrap with the right answers.
 * `verify` confirms Digital Asset Links actually work once deployed.
 *
 * The checks exist because every one of them is a failure that otherwise shows
 * up much later, as a TWA with a browser bar across the top or an app that
 * Play rejects — both hard to trace back to a missing header.
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, 'android');

const cmd = process.argv[2];
const site = (process.argv[3] || '').replace(/\/$/, '');

let failures = 0;
const ok = (m, d = '') => console.log(`  ok    ${m}${d ? '  — ' + d : ''}`);
const bad = (m, d = '') => { console.log(`  FAIL  ${m}${d ? '  — ' + d : ''}`); failures++; };
const note = (m) => console.log(`  note  ${m}`);

function usage() {
  console.log(`
K-Drop Android build helper

  node tools/android-build.js check   https://your-domain
  node tools/android-build.js init    https://your-domain
  node tools/android-build.js verify  https://your-domain
`);
  process.exit(1);
}

/* ------------------------------------------------------------------ check */

async function check() {
  console.log(`\nChecking ${site} is ready to wrap\n`);

  const allowHttp = process.env.ALLOW_HTTP === '1';
  if (!/^https:\/\//.test(site) && !allowHttp) {
    bad('the site must be https', 'a Trusted Web Activity cannot verify against http or localhost');
    return;
  }
  allowHttp && !/^https:/.test(site)
    ? note('http allowed for testing only — a real build must be https')
    : ok('site is https');

  /* manifest */
  let manifest;
  try {
    const res = await fetch(`${site}/manifest.webmanifest`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    manifest = await res.json();
    ok('manifest is reachable');
  } catch (e) {
    bad('manifest could not be read', e.message);
    return;
  }

  const need = [
    ['name', !!manifest.name],
    ['short_name', !!manifest.short_name],
    ['start_url', !!manifest.start_url],
    ['display is standalone or fullscreen', /standalone|fullscreen/.test(manifest.display || '')],
    ['a 512px icon', (manifest.icons || []).some((i) => (i.sizes || '').includes('512'))],
    ['a maskable icon', (manifest.icons || []).some((i) => i.purpose === 'maskable')],
  ];
  for (const [label, present] of need) {
    present ? ok(`manifest has ${label}`) : bad(`manifest is missing ${label}`);
  }

  if (manifest.share_target) ok('share target declared', 'K-Drop will appear in the Android share sheet');
  else note('no share target — the app will not appear when sharing from the gallery');

  /* service worker */
  try {
    const res = await fetch(`${site}/sw.js`);
    res.ok ? ok('service worker is served') : bad('service worker missing', `status ${res.status}`);
  } catch { bad('service worker could not be fetched'); }

  /* asset links */
  try {
    const res = await fetch(`${site}/.well-known/assetlinks.json`);
    if (res.status === 200) {
      const links = await res.json();
      const fp = links?.[0]?.target?.sha256_cert_fingerprints || [];
      fp.length
        ? ok('asset links are configured', `${fp.length} fingerprint(s), package ${links[0].target.package_name}`)
        : bad('asset links have no fingerprint');
    } else {
      note('asset links not configured yet — set ANDROID_SHA256_FINGERPRINT after your first Play upload');
    }
  } catch { bad('asset links endpoint could not be reached'); }

  /* the app has to work at all */
  try {
    const res = await fetch(`${site}/api/health`);
    const h = await res.json();
    h.ok ? ok('server is healthy', `${h.rooms} rooms, ${h.rssMb}MB`) : bad('server reports unhealthy');
  } catch { bad('server health check failed'); }

  /* tooling */
  try {
    execSync('bubblewrap --version', { stdio: 'pipe' });
    ok('bubblewrap is installed');
  } catch {
    bad('bubblewrap is not installed', 'npm i -g @bubblewrap/cli');
  }

  try {
    const v = execSync('java -version 2>&1', { stdio: 'pipe' }).toString().trim().split('\n')[0];
    ok('a JDK is available', v);
  } catch {
    bad('no JDK found', 'Bubblewrap needs one to build; it can install a bundled JDK on first run');
  }

  console.log(failures
    ? `\n  ${failures} thing(s) to fix before wrapping\n`
    : '\n  Ready. Next: node tools/android-build.js init ' + site + '\n');
  process.exit(failures ? 1 : 0);
}

/* ------------------------------------------------------------------- init */

function init() {
  if (!/^https:\/\//.test(site)) usage();

  console.log(`\nGenerating the Android project from ${site}\n`);
  console.log('  Bubblewrap will ask a series of questions. The answers that matter:\n');
  console.log('    Package name .................. com.kalman.kdrop');
  console.log('    Application name .............. K-Drop');
  console.log('    Launcher name ................. K-Drop');
  console.log('    Display mode .................. standalone');
  console.log('    Status bar colour ............. #EDE9E3');
  console.log('    Splash colour ................. #EDE9E3');
  console.log('    Include support for shortcuts . yes');
  console.log('\n  Anything else can take its default.\n');
  console.log('  It will also create a signing key. Keep android.keystore and its');
  console.log('  passwords out of the repository — .gitignore already excludes them.\n');

  const r = spawnSync('bubblewrap', ['init', '--manifest', `${site}/manifest.webmanifest`], {
    cwd: ANDROID, stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('\n  bubblewrap init did not complete.\n');
    process.exit(1);
  }

  console.log('\n  Now check the target SDK before building:');
  console.log('    android/app/build.gradle → compileSdkVersion 36, targetSdkVersion 36');
  console.log('  Google Play requires API 36 for new submissions from 31 August 2026.\n');
  console.log('  Then:  cd android && bubblewrap build\n');
}

/* ----------------------------------------------------------------- verify */

async function verify() {
  if (!/^https?:\/\//.test(site)) usage();
  if (!/^https:/.test(site) && process.env.ALLOW_HTTP !== '1') {
    bad('the site must be https for a real check');
    process.exit(1);
  }
  console.log(`\nVerifying the app-to-site link for ${site}\n`);

  let links;
  try {
    const res = await fetch(`${site}/.well-known/assetlinks.json`);
    if (res.status !== 200) {
      bad('asset links are not being served', `status ${res.status}`);
      note('set ANDROID_SHA256_FINGERPRINT on the server, from Play Console → Setup → App signing');
      process.exit(1);
    }
    links = await res.json();
  } catch (e) {
    bad('could not fetch asset links', e.message);
    process.exit(1);
  }

  const entry = Array.isArray(links) ? links[0] : null;
  if (!entry) { bad('asset links file is empty'); process.exit(1); }

  entry.relation?.includes('delegate_permission/common.handle_all_urls')
    ? ok('relation is correct')
    : bad('relation is wrong', 'must be delegate_permission/common.handle_all_urls');

  entry.target?.namespace === 'android_app' ? ok('namespace is android_app') : bad('namespace is wrong');
  entry.target?.package_name ? ok('package name present', entry.target.package_name) : bad('no package name');

  const fps = entry.target?.sha256_cert_fingerprints || [];
  if (!fps.length) bad('no fingerprints listed');
  else {
    const shaped = fps.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(f));
    shaped ? ok(`${fps.length} fingerprint(s), correctly formatted`)
           : bad('a fingerprint is malformed', 'expected 32 hex pairs separated by colons');
  }

  note('Google also caches this. After changing it, confirm with:');
  note(`https://developers.google.com/digital-asset-links/tools/generator`);

  console.log(failures ? `\n  ${failures} problem(s)\n` : '\n  Asset links look correct.\n');
  process.exit(failures ? 1 : 0);
}

if (cmd === 'check' && site) check();
else if (cmd === 'init') init();
else if (cmd === 'verify') verify();
else usage();
