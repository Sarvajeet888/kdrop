#!/usr/bin/env node
/**
 * Bandwidth economics.
 *
 *   node tools/cost.js                              model from assumptions
 *   node tools/cost.js https://your-domain TOKEN    model from live metrics
 *
 * K-Drop has no revenue. Every rupee of bandwidth is a rupee out of pocket,
 * which makes this the number that decides whether the service can stay free
 * and open to the public.
 *
 * The only expensive path is the relay. A direct transfer never touches the
 * server, so it costs nothing at all — which is why the direct connection rate
 * matters more here than anything about speed.
 */
'use strict';

const GB = 1073741824;

// Rough public list prices, mid-2026, in USD per GB egress. Deliberately not
// precise: the point is the shape of the curve, not an invoice.
const HOSTS = {
  'render-free':  { egressGb: 0,     included: 100,  monthly: 0,   note: 'free tier, 100 GB/month, instance sleeps' },
  'render-paid':  { egressGb: 0.10,  included: 500,  monthly: 7,   note: 'starter instance' },
  'fly':          { egressGb: 0.02,  included: 100,  monthly: 5,   note: 'cheapest egress of the three' },
  'railway':      { egressGb: 0.10,  included: 0,    monthly: 5,   note: 'usage-based' },
};

// A TURN server turns a relayed transfer back into a direct one. It carries
// only the connection setup, not the file, so it is far cheaper than relaying —
// but it is not free either.
const TURN_MONTHLY = 5;

const fmt = (n) => (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString());
const gb = (bytes) => bytes / GB;

async function live(base, token) {
  const url = `${base.replace(/\/$/, '')}/api/metrics${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`metrics returned ${res.status} — is METRICS_TOKEN set?`);
  return res.json();
}

function model({ transfersPerMonth, avgSizeMb, directRate }) {
  const relayedTransfers = transfersPerMonth * (1 - directRate);
  const relayedGb = (relayedTransfers * avgSizeMb) / 1024;

  // The relay both receives and sends every byte, so a transfer costs twice
  // its own size in traffic. This is the single most important line here and
  // the one most often forgotten when estimating.
  const billableGb = relayedGb * 2;

  return { relayedTransfers, relayedGb, billableGb };
}

function table(m) {
  console.log('\n  Monthly cost by host\n');
  console.log('  ' + 'host'.padEnd(14) + 'egress'.padStart(10) + 'total'.padStart(10) + '   note');
  console.log('  ' + '-'.repeat(74));
  for (const [name, h] of Object.entries(HOSTS)) {
    const over = Math.max(0, m.billableGb - h.included);
    const egress = over * h.egressGb;
    const total = egress + h.monthly;
    const capped = h.egressGb === 0 && over > 0;
    console.log(
      '  ' + name.padEnd(14)
      + (capped ? 'OVER LIMIT' : `$${fmt(egress)}`).padStart(10)
      + (capped ? '—' : `$${fmt(total)}`).padStart(10)
      + `   ${h.note}`
    );
  }
}

function advise(m, directRate, transfersPerMonth) {
  console.log('\n  Reading this\n');

  if (m.billableGb === 0) {
    console.log('  Nothing is going through the relay. Every transfer is direct, and');
    console.log('  therefore free. This is the goal state.');
    return;
  }

  console.log(`  ${Math.round((1 - directRate) * 100)}% of transfers take the relay.`);
  console.log(`  That is ${fmt(m.relayedGb)} GB of files, which bills as ${fmt(m.billableGb)} GB`);
  console.log('  because the relay both receives and sends every byte.\n');

  if (m.billableGb > 100) {
    console.log('  This exceeds the free tier. Options, cheapest first:\n');
    console.log(`    1. Add TURN (~$${TURN_MONTHLY}/month). It carries connection setup, not files,`);
    console.log('       so most relayed transfers become direct and stop costing bandwidth.');
    console.log('       This is almost always the right answer.');
    console.log('    2. Lower MAX_RELAY_BYTES so one session cannot spend the budget.');
    console.log('    3. Move to a host with cheaper egress.');
  } else {
    console.log('  This fits inside a free tier. No action needed yet.');
  }

  if (directRate < 0.7 && transfersPerMonth > 100) {
    console.log(`\n  A direct rate of ${Math.round(directRate * 100)}% is low. Above roughly 70%,`);
    console.log('  relay costs stay small on their own.');
  }

  const perThousand = (m.billableGb / (transfersPerMonth / 1000)) * 0.10;
  console.log(`\n  Rough marginal cost: $${fmt(perThousand)} per 1,000 transfers at $0.10/GB.`);
  console.log('  With no revenue, that figure is the entire business model.');
}

(async () => {
  const [, , base, token] = process.argv;

  console.log('\nK-Drop bandwidth economics');

  let scenarios;

  if (base) {
    const m = await live(base, token);
    const counters = m.counters || m;
    const direct = counters.transfersDirect || 0;
    const relayedN = counters.transfersRelayed || 0;
    const routed = direct + relayedN;
    const uptimeDays = (m.uptimeSec || 1) / 86400;

    if (!routed) {
      console.log('\n  No completed transfers recorded yet. Falling back to assumptions.\n');
    } else {
      const observedDirect = direct / routed;
      const relayGbSoFar = gb(counters.relayBytes || 0);
      const perDay = routed / Math.max(uptimeDays, 0.01);
      const avgRelayMb = relayedN ? (relayGbSoFar * 1024) / relayedN : 0;

      console.log(`\n  Measured over ${uptimeDays.toFixed(1)} day(s) of uptime:\n`);
      console.log(`    transfers recorded      ${routed}`);
      console.log(`    direct                  ${Math.round(observedDirect * 100)}%`);
      console.log(`    relayed traffic so far  ${fmt(relayGbSoFar)} GB`);
      console.log(`    average relayed file    ${fmt(avgRelayMb)} MB`);

      scenarios = [{
        label: 'at the current rate',
        transfersPerMonth: Math.round(perDay * 30),
        avgSizeMb: avgRelayMb || 50,
        directRate: observedDirect,
      }];

      // Growth is the question worth asking before it arrives, not after.
      for (const mult of [10, 100]) {
        scenarios.push({
          label: `${mult}× current traffic`,
          transfersPerMonth: Math.round(perDay * 30 * mult),
          avgSizeMb: avgRelayMb || 50,
          directRate: observedDirect,
        });
      }
    }
  }

  if (!scenarios) {
    console.log('\n  No live metrics — modelling from assumptions.');
    console.log('  Pass a URL and token to use real numbers:');
    console.log('    node tools/cost.js https://your-domain YOUR_TOKEN\n');
    scenarios = [
      { label: 'a class of 50 students', transfersPerMonth: 500, avgSizeMb: 40, directRate: 0.7 },
      { label: '1,000 users, light use', transfersPerMonth: 5000, avgSizeMb: 50, directRate: 0.7 },
      { label: '1,000 users, heavy files', transfersPerMonth: 5000, avgSizeMb: 250, directRate: 0.6 },
      { label: '10,000 users', transfersPerMonth: 50000, avgSizeMb: 100, directRate: 0.7 },
    ];
  }

  for (const s of scenarios) {
    const m = model(s);
    console.log(`\n${'='.repeat(78)}`);
    console.log(`  ${s.label}`);
    console.log(`  ${s.transfersPerMonth.toLocaleString()} transfers/month · ${fmt(s.avgSizeMb)} MB average · ${Math.round(s.directRate * 100)}% direct`);
    table(m);
    advise(m, s.directRate, s.transfersPerMonth);
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('\n  The one lever that matters\n');
  console.log('  Direct transfers cost nothing. Relayed transfers cost double their own');
  console.log('  size. So the whole cost question is: what fraction of transfers go');
  console.log('  direct? TURN is the tool that raises it, and at a few dollars a month');
  console.log('  it is cheaper than the bandwidth it saves almost immediately.\n');
  console.log('  Watch directConnectionRate in /api/metrics. Below 50%, add TURN.\n');
})().catch((e) => { console.error('\n  failed:', e.message, '\n'); process.exit(1); });
