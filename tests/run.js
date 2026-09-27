#!/usr/bin/env node
/**
 * K-Drop test runner.
 *
 *   npm test              everything that does not need a browser
 *   npm run test:all      everything, including browser tests
 *   node tests/run.js resume transfer      just those
 *
 * Starts a server on a spare port, runs the suites against it, and shuts it
 * down. Nothing here talks to a deployed instance unless KDROP_URL says so.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 3111);
const BASE = `http://localhost:${PORT}`;

// Browser suites need Chrome and puppeteer-core; the rest need neither.
const SUITES = [
  { name: 'delivery-engine', file: 'delivery-engine.js', browser: false, server: false },
  { name: 'secrets',   file: 'scan-secrets.js', browser: false, server: false },
  { name: 'protocol',  file: 'protocol.js',     browser: false, server: false },
  { name: 'legal',     file: 'legal.js',        browser: false, server: true },
  { name: 'hardening', file: 'hardening.js',    browser: false, server: true,
    env: { MAX_ROOMS_PER_IP: '3', MAX_RELAY_BYTES: '100000', MAX_SOCKETS_PER_IP: '4' } },
  { name: 'stress',    file: 'stress.js',       browser: false, server: true,
    env: { BAN_MS: '3000' } },
  { name: 'load',      file: 'load.js',         browser: false, server: true,
    args: ['100', '4'],
    env: { MAX_SOCKETS_PER_IP: '20000', MAX_ROOMS_PER_IP: '20000', MAX_ROOMS_TOTAL: '20000' } },
  { name: 'transfer',  file: 'transfer.js',     browser: true,  server: true },
  { name: 'resume',    file: 'resume.js',       browser: true,  server: true },
  { name: 'pin',       file: 'pin.js',          browser: true,  server: true },
  { name: 'features',  file: 'features.js',     browser: true,  server: true },
  { name: 'a11y',      file: 'a11y.js',         browser: true,  server: true },
  { name: 'android',   file: 'android.js',      browser: true,  server: true },
  { name: 'security',  file: 'security.js',     browser: true,  server: true },
  { name: 'flow',      file: 'flow.js',         browser: true,  server: true },
  { name: 'reliability', file: 'reliability.js', browser: true, server: true },
  { name: 'crypto',    file: 'crypto.js',       browser: true,  server: true },
  { name: 'background', file: 'background.js',   browser: true,  server: true },
  { name: 'fingerprint', file: 'fingerprint.js', browser: true, server: true },
  { name: 'trust',     file: 'trust.js',        browser: true,  server: true },
  { name: 'diagnostics', file: 'diagnostics.js', browser: true, server: true },
  { name: 'preview',   file: 'preview.js',      browser: true,  server: true },
  { name: 'device',    file: 'device.js',       browser: true,  server: true },
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const includeBrowser = process.env.TEST_BROWSER === '1' || process.argv.includes('--browser');

function haveBrowser() {
  try { require.resolve('puppeteer-core'); } catch { return false; }
  return true;
}

function waitForServer(ms = 15000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function poll() {
      http.get(`${BASE}/api/health`, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : retry();
      }).on('error', retry);
      function retry() {
        if (Date.now() > deadline) return reject(new Error('server did not start'));
        setTimeout(poll, 200);
      }
    })();
  });
}

function startServer(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`    [server] ${d}`));
  return child;
}

function run(file, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file), ...(args || [])], {
      cwd: ROOT,
      env: { ...process.env, KDROP_URL: BASE, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

(async () => {
  const browserOk = haveBrowser();
  const suites = SUITES.filter((s) => {
    if (wanted.length) return wanted.includes(s.name);
    if (s.browser) return includeBrowser;
    return true;
  });

  const results = [];

  for (const suite of suites) {
    if (suite.browser && !browserOk) {
      console.log(`\n──  ${suite.name}: skipped (npm i -D puppeteer-core, and set CHROME_PATH)`);
      results.push([suite.name, 'skip']);
      continue;
    }

    console.log(`\n────────────  ${suite.name}  ────────────`);

    let server = null;
    if (suite.server) {
      server = startServer(suite.env);
      try {
        await waitForServer();
      } catch (e) {
        console.error(`  could not start server: ${e.message}`);
        server.kill();
        results.push([suite.name, 'fail']);
        continue;
      }
    }

    // load.js takes its own url-derived host, so pass the ws form too
    const ok = await run(suite.file, suite.args, {
      KDROP_URL: suite.name === 'load' || suite.name === 'stress'
        ? BASE.replace('http', 'ws') + '/ws'
        : BASE,
    });

    if (server) { server.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 400)); }
    results.push([suite.name, ok ? 'pass' : 'fail']);
  }

  console.log('\n════════════  summary  ════════════');
  for (const [name, state] of results) {
    console.log(`  ${state.padEnd(5)} ${name}`);
  }
  const failed = results.filter(([, s]) => s === 'fail');
  console.log(failed.length ? `\n  ${failed.length} suite(s) failed\n` : '\n  all suites passed\n');
  process.exit(failed.length ? 1 : 0);
})();
