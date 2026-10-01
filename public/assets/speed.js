/** Evidence-based explanations. No network-quality guesses from MB/s alone. */
export function explainSpeed({ mode, stats, rate = 0, peak = 0, elapsed = 0,
  stalledFor = 0, paused = false, writeBusy = 0, writeSamples = 0 } = {}) {
  const turn = stats?.localType === 'relay' || stats?.remoteType === 'relay';
  const route = mode === 'relayed' ? 'Internet relay' : mode === 'direct'
    ? (turn ? 'WebRTC via TURN' : stats ? 'Direct peer connection' : 'WebRTC · checking route')
    : 'Connecting';
  let title = 'Measuring transfer speed';
  let detail = 'Speed is measured from receiver progress. Waiting for enough samples.';
  if (paused) {
    title = 'Transfer paused'; detail = 'Resume the transfer to continue measuring speed.';
  } else if (stalledFor >= 5) {
    title = 'No recent receiver progress';
    detail = 'Keep both apps open. The receiver has not reported new bytes; the cause is not yet known.';
  } else if (writeSamples >= 3 && writeBusy >= 0.7) {
    title = 'Storage writes are taking most of the receive time';
    detail = 'Measured disk-write waits occupy at least 70% of this interval. Check the receiving drive and other disk activity.';
  } else if (mode === 'relayed' || turn) {
    title = 'Files are travelling through a relay';
    detail = 'Speed depends on sender upload, receiver download and the relay path. A reachable local connection can avoid this route.';
  } else if (elapsed >= 5 && peak > 0 && rate < peak * 0.5) {
    title = 'Below this session’s recent peak';
    detail = 'Receiver throughput has dropped. This alone does not identify Wi-Fi, storage or CPU as the cause.';
  } else if (elapsed >= 5 && rate > 0) {
    title = 'Receiving steadily';
    detail = 'The current route is delivering data. This is measured throughput, not the connection’s maximum capacity.';
  }
  return { route, title, detail };
}

/** A rolling window smooths acknowledgement bursts without inventing speed. */
export class SpeedMeter {
  constructor() { this.samples = []; this.peak = 0; }
  update(bytes, now) {
    if (!this.samples.length || bytes < this.samples.at(-1).bytes) {
      this.samples = [{ bytes, now }]; this.peak = 0; this.started = now; this.changed = now;
    }
    if (bytes > this.samples.at(-1).bytes) this.changed = now;
    this.samples.push({ bytes, now });
    while (this.samples.length > 2 && this.samples[1].now < now - 3000) this.samples.shift();
    const first = this.samples[0];
    const dt = (now - first.now) / 1000;
    const rate = dt > 0 ? Math.max(0, bytes - first.bytes) / dt : 0;
    if (dt >= 2) this.peak = Math.max(this.peak, rate);
    return { rate, peak: this.peak, elapsed: (now - this.started) / 1000,
      stalledFor: (now - this.changed) / 1000 };
  }
}
