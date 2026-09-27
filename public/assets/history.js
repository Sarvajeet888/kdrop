/**
 * Transfer history — stored only in this browser.
 *
 * Nothing here is ever sent to the server. There is no account to attach it
 * to and no reason for us to know what you moved. Clearing it is one button,
 * and closing the browser in private mode leaves nothing behind.
 *
 * Filenames are kept because they are the only thing that makes the list
 * useful. That is exactly why it stays on the device.
 */

const KEY = 'kdrop.history.v1';
const MAX = 60;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];   // private mode, quota, or corrupted value — behave as empty
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* Storage unavailable. History is a convenience, not a requirement. */
  }
}

export function add(entry) {
  const list = read();
  list.unshift({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    dir: entry.dir,               // 'out' | 'in'
    name: String(entry.name || '').slice(0, 120),
    count: entry.count || 1,
    bytes: entry.bytes || 0,
    peer: String(entry.peer || '').slice(0, 40),
    route: entry.route || 'direct',
    ok: entry.ok !== false,
  });
  write(list);
  return list;
}

export function all() { return read(); }

export function clear() {
  try { localStorage.removeItem(KEY); } catch {}
}

/** Group into Today / Yesterday / Earlier for display. */
export function grouped() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  const buckets = { today: [], yesterday: [], earlier: [] };
  for (const e of read()) {
    if (e.at >= startOfToday) buckets.today.push(e);
    else if (e.at >= startOfYesterday) buckets.yesterday.push(e);
    else buckets.earlier.push(e);
  }
  return buckets;
}

/** A rough file-type glyph, from the extension alone. */
export function glyph(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx', 'txt', 'rtf', 'odt', 'md'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  return 'file';
}
