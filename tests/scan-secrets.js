#!/usr/bin/env node
/**
 * Secret scan — refuses to let credentials reach the repository.
 *
 *   node tests/scan-secrets.js
 *
 * Deliberately noisy rather than clever. A false positive costs you ten
 * seconds; a leaked TURN credential costs you a bandwidth bill.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'screenshots']);
const SKIP_FILES = new Set(['package-lock.json', 'scan-secrets.js']);

const RULES = [
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{30,}/, 'GitHub personal access token'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'API secret key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/(TURN_PASS|METRICS_TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)\s*[=:]\s*['"]?(?!$|\s|#|your|YOUR|choose|<)[^\s'"#]{8,}/,
    'hard-coded credential'],
  [/postgres(ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/, 'database URL with password'],
  [/(storePassword|keyPassword|keyAlias)\s*[=:]\s*['"]?(?!$|\s|#|your|YOUR|<)[^\s'"#]{4,}/, 'Android signing credential'],
  [/mongodb(\+srv)?:\/\/[^\s:'"]+:[^\s@'"]+@/, 'MongoDB URL with password'],
];

const FORBIDDEN_FILES = [
  '.env', '.env.local', '.env.production', 'id_rsa', 'credentials.json',
  // Android signing material. Leaking an upload key lets someone publish an
  // update to your app under your name.
  'android.keystore', 'upload-keystore.jks', 'keystore.properties',
];

let findings = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);

    if (FORBIDDEN_FILES.includes(entry.name)) {
      console.log(`  LEAK  ${rel} — this file must never be committed`);
      findings++;
      continue;
    }

    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;   // binary

    text.split('\n').forEach((line, i) => {
      for (const [re, label] of RULES) {
        if (re.test(line)) {
          console.log(`  LEAK  ${rel}:${i + 1} — ${label}`);
          console.log(`        ${line.trim().slice(0, 100)}`);
          findings++;
        }
      }
    });
  }
}

console.log('\nSecret scan\n');
walk(ROOT);

const gitignore = fs.existsSync(path.join(ROOT, '.gitignore'))
  ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
if (!/^\.env$/m.test(gitignore)) {
  console.log('  WARN  .gitignore does not list .env');
  findings++;
}

console.log(findings ? `\n  ${findings} finding(s) — fix before committing\n`
                     : '\n  No secrets found\n');
process.exit(findings ? 1 : 0);
