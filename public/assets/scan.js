/**
 * In-app QR scanning.
 *
 * Without this, joining means leaving K-Drop, opening the camera app, scanning,
 * and coming back — which is fine on a phone that puts a scanner in the camera
 * and awkward on one that does not.
 *
 * Uses the browser's own BarcodeDetector where it exists (Chrome and Edge on
 * Android and desktop). There is deliberately no fallback library: shipping a
 * hundred kilobytes of decoder to cover Safari would cost every visitor on
 * every page, and typing six characters is not a hardship. Where the detector
 * is missing, the button simply does not appear.
 */

export function scanSupported() {
  return typeof window.BarcodeDetector !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && window.isSecureContext;
}

export class Scanner {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.detector = null;
    this.raf = null;
    this.stopped = true;
  }

  /**
   * Start the camera and call onFound with the first code seen.
   * Resolves once the camera is live, or rejects with a reason worth showing.
   */
  async start(onFound) {
    if (!scanSupported()) throw new Error('unsupported');

    this.detector = new BarcodeDetector({ formats: ['qr_code'] });

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },   // rear camera on a phone
        audio: false,
      });
    } catch (e) {
      // Distinguish "you said no" from "there is no camera" — the first is
      // recoverable by the person, the second is not.
      throw new Error(e && e.name === 'NotAllowedError' ? 'denied' : 'nocamera');
    }

    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');   // iOS refuses fullscreen-less video without this
    await this.video.play();

    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        const found = await this.detector.detect(this.video);
        if (found.length) {
          const value = found[0].rawValue || '';
          this.stop();
          onFound(value);
          return;
        }
      } catch {
        // A frame can fail to decode mid-resize; just try the next one.
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}

/**
 * Pull a pairing code out of whatever the QR contained.
 *
 * Ours encode the 10-character room-code + PIN token locally, but someone
 * may point the camera at anything, so this accepts a bare code too and
 * returns null rather than guessing.
 */
export function codeFromScan(text) {
  if (!text) return null;

  let candidate = text.trim();
  try {
    const url = new URL(candidate);
    candidate = url.hash.replace(/^#/, '');
  } catch {
    // Not a URL. Treat it as a raw code.
  }

  const cleaned = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 10 ? cleaned.slice(0, 10) : null;
}
