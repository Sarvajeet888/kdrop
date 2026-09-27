/**
 * File previews.
 *
 * A list of filenames tells you what you typed. A thumbnail tells you whether
 * you picked the right photo — which is the mistake people actually make.
 *
 * Previews are generated locally from the file the sender already holds, and
 * for the receiver from the blob that has already arrived. Nothing extra
 * crosses the network to produce them: a thumbnail is never transmitted, only
 * the file itself.
 */

const IMAGE = /^image\/(png|jpeg|jpg|gif|webp|bmp|avif|svg\+xml)$/i;
const VIDEO = /^video\//i;

/** Small enough to decode quickly, large enough to recognise. */
const THUMB = 96;
const MAX_DECODE = 40 * 1024 * 1024;   // don't decode a huge image for a 96px box

/**
 * A rough category from the name and type, used when there is nothing to
 * render — which is most files.
 */
export function kindOf(name, type = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  if (IMAGE.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (VIDEO.test(type) || ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(ext)) return 'video';
  if (/^audio\//i.test(type) || ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'xml', 'sh'].includes(ext)) return 'code';
  return 'file';
}

/**
 * A square thumbnail as a data URL, or null when one cannot be made.
 *
 * Drawn to a canvas rather than shown at size, so a 40-megapixel photo does
 * not sit in memory as a full-resolution element while the list is open.
 */
export async function thumbnail(blob, name = '') {
  if (!blob || blob.size > MAX_DECODE) return null;
  if (kindOf(name, blob.type) !== 'image') return null;
  if (!IMAGE.test(blob.type || '')) return null;

  let url = null;
  try {
    url = URL.createObjectURL(blob);
    const img = await load(url);

    const canvas = document.createElement('canvas');
    canvas.width = THUMB;
    canvas.height = THUMB;
    const ctx = canvas.getContext('2d');

    // Cover, not contain: a letterboxed thumbnail in a grid looks broken.
    const scale = Math.max(THUMB / img.width, THUMB / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (THUMB - w) / 2, (THUMB - h) / 2, w, h);

    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;      // corrupt, unsupported, or simply not worth reporting
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('decode timeout')), 4000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('decode failed')); };
    img.src = src;
  });
}

/**
 * Build previews for a set of files, capped so choosing a folder of two
 * thousand photos does not lock the tab decoding all of them.
 */
export async function previewAll(files, limit = 8) {
  const out = [];
  for (const f of [...files].slice(0, limit)) {
    out.push({ name: f.name, size: f.size, kind: kindOf(f.name, f.type), thumb: await thumbnail(f, f.name) });
  }
  for (const f of [...files].slice(limit)) {
    out.push({ name: f.name, size: f.size, kind: kindOf(f.name, f.type), thumb: null });
  }
  return out;
}
