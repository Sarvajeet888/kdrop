const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = file => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '../public/assets', file))).toString('base64'));
(async () => {
  const { explainSpeed, SpeedMeter } = await load('speed.js');
  assert.equal(explainSpeed({ mode: 'relayed' }).route, 'Internet relay');
  assert.equal(explainSpeed({ mode: 'direct', stats: { localType: 'relay' } }).route, 'WebRTC via TURN');
  assert.equal(explainSpeed({ mode: 'direct' }).route, 'WebRTC · checking route');
  assert.match(explainSpeed({ mode: 'direct', rate: 1, elapsed: 10 }).title, /steadily/);
  assert.match(explainSpeed({ rate: 1, peak: 100, elapsed: 10 }).detail, /does not identify/);
  assert.match(explainSpeed({ writeBusy: .9, writeSamples: 1 }).title, /Measuring/);
  assert.match(explainSpeed({ writeBusy: .9, writeSamples: 4 }).title, /Storage/);
  assert.match(explainSpeed({ stalledFor: 6 }).title, /No recent/);
  assert.match(explainSpeed({ paused: true, stalledFor: 6 }).title, /paused/);
  const meter = new SpeedMeter();
  assert.equal(meter.update(0, 0).rate, 0);
  assert.equal(meter.update(1000, 1000).rate, 1000);
  assert.equal(meter.update(2000, 2000).peak, 1000);
  meter.update(2000, 5000);
  assert.equal(meter.update(2000, 8000).rate, 0);
  assert.equal(meter.update(2000, 8000).stalledFor, 6);
  assert.equal(meter.update(10, 9000).rate, 0); // resume rollback
  const { readStats } = await load('diagnostics.js');
  const report = new Map([
    ['wrong', { id: 'wrong', type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'local' }],
    ['actual', { id: 'actual', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'relay' }],
    ['transport', { type: 'transport', selectedCandidatePairId: 'actual' }],
    ['local', { id: 'local', candidateType: 'host' }], ['relay', { id: 'relay', candidateType: 'relay' }]
  ]);
  assert.equal((await readStats({ pc: { getStats: async () => report } })).localType, 'relay');
  console.log('Speed evidence, acknowledgement sampling, resume reset and selected route: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
