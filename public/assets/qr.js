/**
 * Tiny local QR encoder for K-Drop pairing tokens.
 *
 * K-Drop pairing payloads are exactly 10 characters from the QR alphanumeric
 * alphabet (6-char room code + 4-char PIN), so a Version 1 / M QR code is
 * sufficient. Keeping generation in the browser means the PIN never has to be
 * sent back to the server just to draw an image.
 */

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const SIZE = 21;
const DATA_CODEWORDS = 16; // Version 1-M
const EC_CODEWORDS = 10;

function bitsPush(out, value, length) {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function encodeData(text) {
  const s = String(text || '').toUpperCase();
  if (!s || s.length > 20 || [...s].some((c) => !ALNUM.includes(c))) {
    throw new Error('Unsupported QR pairing token');
  }

  const bits = [];
  bitsPush(bits, 0b0010, 4);      // alphanumeric mode
  bitsPush(bits, s.length, 9);    // Version 1 character count width
  for (let i = 0; i + 1 < s.length; i += 2) {
    bitsPush(bits, ALNUM.indexOf(s[i]) * 45 + ALNUM.indexOf(s[i + 1]), 11);
  }
  if (s.length % 2) bitsPush(bits, ALNUM.indexOf(s.at(-1)), 6);

  const capacity = DATA_CODEWORDS * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    bytes.push(b);
  }
  let pad = 0;
  while (bytes.length < DATA_CODEWORDS) bytes.push((pad++ % 2) ? 0x11 : 0xec);
  return bytes;
}

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < EXP.length; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function addErrorCorrection(data) {
  const gen = rsGenerator(EC_CODEWORDS);
  const rem = [...data, ...new Array(EC_CODEWORDS).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = rem[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j++) rem[i + j] ^= gfMul(gen[j], factor);
  }
  return [...data, ...rem.slice(data.length)];
}

function bchDigit(n) {
  let d = 0;
  while (n) { d++; n >>>= 1; }
  return d;
}

function formatBits(mask) {
  // Error correction M is 00 in QR format information.
  const data = mask & 7;
  let d = data << 10;
  const g = 0x537;
  while (bchDigit(d) - bchDigit(g) >= 0) d ^= g << (bchDigit(d) - bchDigit(g));
  return ((data << 10) | d) ^ 0x5412;
}

function finder(mod, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r, x = col + c;
      if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) continue;
      const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      mod[y][x] = dark;
    }
  }
}

function reserveFormat(mod) {
  for (let i = 0; i < 15; i++) {
    const v = i < 6 ? [i, 8] : i < 8 ? [i + 1, 8] : [SIZE - 15 + i, 8];
    const h = i < 8 ? [8, SIZE - i - 1] : i < 9 ? [8, 7] : [8, 15 - i - 1];
    if (mod[v[0]][v[1]] == null) mod[v[0]][v[1]] = false;
    if (mod[h[0]][h[1]] == null) mod[h[0]][h[1]] = false;
  }
  mod[SIZE - 8][8] = true;
}

function applyFormat(mod, mask) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    if (i < 6) mod[i][8] = dark;
    else if (i < 8) mod[i + 1][8] = dark;
    else mod[SIZE - 15 + i][8] = dark;

    if (i < 8) mod[8][SIZE - i - 1] = dark;
    else if (i < 9) mod[8][7] = dark;
    else mod[8][15 - i - 1] = dark;
  }
  mod[SIZE - 8][8] = true;
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0;
    case 7: return ((((r * c) % 3) + ((r + c) % 2)) % 2) === 0;
    default: return false;
  }
}

function buildMatrix(text, mask = 0) {
  const mod = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  finder(mod, 0, 0);
  finder(mod, SIZE - 7, 0);
  finder(mod, 0, SIZE - 7);

  for (let i = 8; i < SIZE - 8; i++) {
    if (mod[i][6] == null) mod[i][6] = i % 2 === 0;
    if (mod[6][i] == null) mod[6][i] = i % 2 === 0;
  }
  reserveFormat(mod);

  const bytes = addErrorCorrection(encodeData(text));
  let byteIndex = 0, bitIndex = 7, row = SIZE - 1, inc = -1;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (mod[row][x] != null) continue;
        let dark = false;
        if (byteIndex < bytes.length) dark = ((bytes[byteIndex] >>> bitIndex) & 1) === 1;
        if (maskBit(mask, row, x)) dark = !dark;
        mod[row][x] = dark;
        if (--bitIndex < 0) { byteIndex++; bitIndex = 7; }
      }
      row += inc;
      if (row < 0 || row >= SIZE) { row -= inc; inc = -inc; break; }
    }
  }
  applyFormat(mod, mask);
  return mod;
}

export function qrSvgDataUrl(text) {
  const mod = buildMatrix(text, 0);
  const margin = 4;
  const total = SIZE + margin * 2;
  let path = '';
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) if (mod[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#F4F0E8"/><path d="${path}" fill="#15171B"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
