/**
 * Connection diagnostics.
 *
 * Built because the speed question could not be answered from here. Every
 * measurement in this project came from two browser tabs on one machine with
 * no network between them; the one real-world number was a screenshot showing
 * 268ms and 863 KB/s. This panel puts the same numbers on the device where the
 * problem actually happens.
 *
 * It reads from WebRTC's own statistics rather than guessing, and everything
 * stays local — nothing here is reported anywhere.
 */

const fmt = (n, unit = '') => (n == null ? '—' : `${n}${unit}`);

/**
 * Pull the candidate pair that is actually carrying data, plus the totals.
 * getStats returns a large flat map keyed by id; the useful parts have to be
 * found by type and cross-referenced.
 */
export async function readStats(link) {
  if (!link || !link.pc || typeof link.pc.getStats !== 'function') return null;

  let report;
  try { report = await link.pc.getStats(); } catch { return null; }

  const byId = new Map();
  for (const s of report.values()) byId.set(s.id, s);

  let pair = null;
  for (const s of report.values()) {
    if (s.type === 'candidate-pair' && (s.selected || s.state === 'succeeded')) {
      // Prefer the pair the browser marks as nominated and in use.
      if (!pair || s.nominated) pair = s;
    }
  }
  if (!pair) return null;

  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);

  let channel = null;
  for (const s of report.values()) if (s.type === 'data-channel') channel = s;

  return {
    rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    sentBytes: pair.bytesSent ?? null,
    recvBytes: pair.bytesReceived ?? null,
    outgoingBps: pair.availableOutgoingBitrate ?? null,

    // "host" means the two devices found each other on the same network —
    // the fast case. "srflx" is through a NAT, "relay" is via TURN.
    localType: local ? local.candidateType : null,
    remoteType: remote ? remote.candidateType : null,
    localProtocol: local ? local.protocol : null,

    channelState: channel ? channel.state : null,
    messagesSent: channel ? channel.messagesSent : null,
  };
}

/** Turn candidate types into something a person can act on. */
export function describeRoute(stats) {
  if (!stats) return { label: 'unknown', advice: null };

  const pairTypes = `${stats.localType || '?'}/${stats.remoteType || '?'}`;

  if (stats.localType === 'host' && stats.remoteType === 'host') {
    return { label: pairTypes, quality: 'best', advice: null };
  }
  if (stats.localType === 'relay' || stats.remoteType === 'relay') {
    return { label: pairTypes, quality: 'poor', advice: 'turn' };
  }
  return { label: pairTypes, quality: 'ok', advice: 'sameWifi' };
}

/**
 * Judge the round-trip time, since that predicts speed better than anything
 * else and is the number people can actually do something about.
 */
export function describeRtt(ms) {
  if (ms == null) return { quality: null, advice: null };
  if (ms <= 20) return { quality: 'best', advice: null };
  if (ms <= 80) return { quality: 'ok', advice: 'sameWifi' };
  return { quality: 'poor', advice: 'sameWifi' };
}

/** A plain-text block someone can paste into a bug report. */
export function asText(state, stats, extra = {}) {
  const lines = [
    'K-Drop diagnostics',
    `time            ${new Date().toISOString()}`,
    `route           ${extra.mode || '—'}`,
    `candidates      ${stats ? describeRoute(stats).label : '—'}`,
    `round trip      ${fmt(stats && stats.rttMs, ' ms')}`,
    `data channel    ${fmt(stats && stats.channelState)}`,
    `sent            ${stats && stats.sentBytes != null ? (stats.sentBytes / 1048576).toFixed(1) + ' MB' : '—'}`,
    `received        ${stats && stats.recvBytes != null ? (stats.recvBytes / 1048576).toFixed(1) + ' MB' : '—'}`,
    `frame size      ${fmt(extra.chunkSize, ' bytes')}`,
    `session key     ${extra.secure ? 'agreed' : 'none'}`,
    `secure context  ${window.isSecureContext}`,
    `stream to disk  ${'showDirectoryPicker' in window}`,
    `browser         ${navigator.userAgent}`,
    `language        ${navigator.language}`,
    `screen          ${screen.width}x${screen.height} @${devicePixelRatio}x`,
  ];
  return lines.join('\n');
}
