/**
 * Filename safety.
 *
 * A filename arrives from the other device. Even in a session you started
 * deliberately, it is remote input and must not be trusted with a path, a
 * control character, or a name that displays as something other than what it
 * is.
 *
 * The attack worth understanding: Unicode has characters that reverse text
 * direction. A file called "invoice\u202Egnp.exe" is rendered by almost every
 * operating system as "invoiceexe.png". Someone sees a picture and saves an
 * executable. The bytes never lie; the display does.
 */

// Direction overrides and other invisible formatting. These have no business
// in a filename and are the whole basis of the spoof above.
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

// Control characters, including the null byte that truncates a path in older
// native code.
const CONTROL = /[\u0000-\u001F\u007F]/g;

// Names Windows refuses to create, with or without an extension.
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

const MAX_LENGTH = 180;

/**
 * Make a remote filename safe to write to disk and safe to show to a person.
 * Always returns something usable — never an empty string.
 */
export function safeFilename(raw, fallback = 'file') {
  let name = typeof raw === 'string' ? raw : '';

  name = name.replace(BIDI, '').replace(CONTROL, '');

  // Take only the last path component, then remove separators outright, so
  // neither "../../etc/passwd" nor "..\\windows" can escape a chosen folder.
  name = name.split(/[/\\]/).pop() || '';
  name = name.replace(/[/\\]/g, '_');

  // Characters that are illegal on Windows or awkward in a shell.
  name = name.replace(/[<>:"|?*]/g, '_');

  // Leading dots hide the file; leading or trailing spaces and dots are
  // silently stripped by Windows, which makes the saved name differ from the
  // shown one.
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  if (RESERVED.test(name)) name = `_${name}`;

  // Keep the extension when trimming, since that is what a person and their
  // operating system use to decide what the file is.
  if (name.length > MAX_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, MAX_LENGTH - ext.length) + ext;
  }

  return name || fallback;
}

/**
 * True when a name was altered by sanitising — worth telling the person,
 * because a name that needed changing is a name that was trying something.
 */
export function wasRewritten(raw) {
  return typeof raw === 'string' && raw !== safeFilename(raw);
}

/**
 * Does the extension suggest something that runs when opened?
 *
 * This does not block anything. People legitimately send installers, and
 * refusing would be both wrong and easy to work around. It exists so the
 * accept dialog can say what the file is, especially when the name was
 * disguised.
 */
const EXECUTABLE = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'ps1', 'psm1', 'reg', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  'sh', 'bash', 'zsh', 'run', 'bin', 'jar', 'lnk', 'hta', 'cpl', 'msc',
]);

export function looksExecutable(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return EXECUTABLE.has(ext);
}
