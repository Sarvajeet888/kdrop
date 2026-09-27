/**
 * K-Drop convergence trace — the brand signature, made functional.
 *
 * A noisy Iron measurement enters from the left and resolves into a clean
 * Vermillion estimate ending in a solid dot. That is the Kalman mark.
 *
 * Here it also carries state:
 *   - waiting        noise stays wide, the estimate never settles
 *   - connected      noise narrows, the estimate converges and holds
 *   - transferring   trace amplitude tracks real throughput
 *
 * Raw input is always Iron. Resolved output is always Vermillion.
 */

const css = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || fb).trim();

export class Trace {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');

    this.noise = 1;          // 1 = fully unresolved, 0 = converged
    this.targetNoise = 1;
    this.phase = 0;
    this.drift = 0.35;       // how fast the noise walks
    this.settled = false;
    this.running = false;
    this.last = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;


    this.readColors();

    // A fixed random walk, so the noise looks like a measurement rather
    // than a sine wave.
    this.walk = Array.from({ length: 96 }, () => Math.random() * 2 - 1);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  readColors() {
    const css = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || fb).trim();
    this.colors = {
      iron: css('--iron', '#6b7078'),
      ash: css('--ash', '#c9c3b9'),
      vermillion: css('--vermillion', '#de4b22'),
    };
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.c.clientWidth || 600;
    const h = Math.max(96, Math.min(w * 0.26, 160));
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.c.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    if (!this.running) this.draw();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min((t - this.last) / 1000, 0.05);
      this.last = t;
      this.step(dt);
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  /** No device yet: the estimate cannot converge. */
  waiting() { this.targetNoise = 1; this.drift = 0.3; }

  /** A device is on the other end: the estimate resolves and holds. */
  connected() { this.targetNoise = 0.10; this.drift = 0.5; }

  /** Throughput in bytes per second drives the trace amplitude. */
  throughput(bps) {
    if (!bps) return this.connected();
    this.targetNoise = 0.14 + Math.min(Math.log10(1 + bps / 40_000) * 0.16, 0.5);
    this.drift = 0.8 + Math.min(Math.log10(1 + bps / 40_000) * 1.4, 4);
  }

  step(dt) {
    this.noise += (this.targetNoise - this.noise) * Math.min(dt * 2.2, 1);
    if (!this.reduced && !document.body.classList.contains('motion-paused')) this.phase += this.drift * dt;
  }

  /** Sampled noise at position 0..1 along the trace. */
  sample(u) {
    const n = this.walk.length;
    const x = (u * (n - 1) * 0.42 + this.phase * 5) % n;   // lower frequency reads as signal, not hash
    const i = Math.floor(x);
    const f = x - i;
    const a = this.walk[i % n];
    const b = this.walk[(i + 1) % n];
    return a + (b - a) * (f * f * (3 - 2 * f));   // smoothstep between samples
  }

  draw() {
    const { ctx, w, h } = this;
    const mid = h / 2;
    const left = 2;
    const right = w - 14;
    const span = right - left;

    ctx.clearRect(0, 0, w, h);

    // Covariance envelope — how uncertain the estimate still is.
    ctx.strokeStyle = this.colors.ash;
    ctx.lineWidth = 0.5;
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let px = 0; px <= span; px += 3) {
        const u = px / span;
        const spread = (1 - u ** 1.4) * this.noise * h * 0.42 + 1.5;
        const y = mid + sign * spread;
        px === 0 ? ctx.moveTo(left + px, y) : ctx.lineTo(left + px, y);
      }
      ctx.stroke();
    }

    // The measurement. Raw input is Iron and it never smooths — a real sensor
    // stays noisy no matter how good your estimate gets.
    ctx.strokeStyle = this.colors.iron;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let px = 0; px <= span; px += 2) {
      const u = px / span;
      const amp = (1 - u * 0.35) * this.noise * h * 0.32;
      const y = mid + this.sample(u) * amp;
      px === 0 ? ctx.moveTo(left + px, y) : ctx.lineTo(left + px, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The estimate. Resolved output is Vermillion. It starts on top of the
    // measurement, then converges and holds.
    // Drawn in short segments so the unresolved left end can stay faint —
    // Vermillion is seasoning, and it belongs on the resolved end.
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let endY = mid;
    let prev = null;
    for (let px = 0; px <= span; px += 2) {
      const u = px / span;
      const t = Math.min(u / 0.38, 1);
      const pull = t * t * (3 - 2 * t);              // smoothstep to converged
      const amp = (1 - u * 0.35) * this.noise * h * 0.32;
      const y = mid + this.sample(u) * amp * (1 - pull);
      endY = y;
      if (prev) {
        ctx.strokeStyle = this.colors.vermillion;
        ctx.globalAlpha = 0.2 + pull * 0.8;
        ctx.beginPath();
        ctx.moveTo(left + prev.px, prev.y);
        ctx.lineTo(left + px, y);
        ctx.stroke();
      }
      prev = { px, y };
    }
    ctx.globalAlpha = 1;

    // The resolved state.
    ctx.fillStyle = this.colors.vermillion;
    ctx.beginPath();
    ctx.arc(right, endY, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
