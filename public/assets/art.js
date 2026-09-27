/**
 * Illustrations.
 *
 * Drawn rather than photographed, for three reasons that all matter more than
 * the aesthetic one:
 *
 *  - A stock photo host sees every visitor's IP address. The privacy page
 *    lists exactly two third parties, and decoration is a poor reason to add a
 *    third to a product whose whole argument is that it does not watch you.
 *  - These are a few kilobytes each and inline, so they appear with the page
 *    rather than after it, and they work in the offline shell.
 *  - They use the brand variables, so they cannot drift out of palette.
 *
 * Everything here is geometry: the same converging line as the logo, devices
 * as rectangles, movement as arrows. Nothing pretends to be a photograph.
 */

const A = 'var(--ash)';
const IRON = 'var(--iron)';
const INK = 'var(--graphite)';
const V = 'var(--vermillion)';
const SURF = 'var(--bone-2)';

/** Two devices with something crossing between them. */
const transfer = `
<svg viewBox="0 0 320 180" role="img" aria-label="A file moving from a laptop to a phone" fill="none">
  <rect x="14" y="42" width="112" height="72" rx="3" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <rect x="24" y="52" width="92" height="52" rx="2" fill="none" stroke="${A}" stroke-width="1"/>
  <path d="M6 122h128" stroke="${IRON}" stroke-width="2" stroke-linecap="round"/>

  <rect x="238" y="34" width="56" height="94" rx="6" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <rect x="246" y="46" width="40" height="66" rx="2" fill="none" stroke="${A}" stroke-width="1"/>
  <circle cx="266" cy="121" r="3" fill="${A}"/>

  <path d="M146 90c26-22 50-22 78 0" stroke="${V}" stroke-width="2.5" stroke-linecap="round"
        stroke-dasharray="5 5" class="ill-dash"/>
  <rect x="176" y="60" width="24" height="30" rx="2" fill="var(--bone)" stroke="${V}" stroke-width="2"
        class="ill-float"/>
  <path d="M181 70h14M181 76h14M181 82h9" stroke="${V}" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

/** The pairing idea: a code on one screen, a camera on the other. */
const pairing = `
<svg viewBox="0 0 320 180" role="img" aria-label="A code shown on one device and read by another" fill="none">
  <rect x="18" y="30" width="118" height="102" rx="3" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <g fill="${INK}">
    <rect x="38" y="50" width="22" height="22" rx="1"/><rect x="94" y="50" width="22" height="22" rx="1"/>
    <rect x="38" y="90" width="22" height="22" rx="1"/>
    <rect x="70" y="56" width="8" height="8"/><rect x="70" y="72" width="8" height="8"/>
    <rect x="86" y="80" width="8" height="8"/><rect x="70" y="96" width="8" height="8"/>
    <rect x="94" y="96" width="8" height="8"/><rect x="108" y="86" width="8" height="8"/>
  </g>
  <g fill="${SURF}">
    <rect x="44" y="56" width="10" height="10"/><rect x="100" y="56" width="10" height="10"/>
    <rect x="44" y="96" width="10" height="10"/>
  </g>

  <rect x="222" y="26" width="66" height="110" rx="7" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <path d="M238 62h34M238 62v-8h34v8" stroke="${V}" stroke-width="2" stroke-linecap="round"/>
  <path d="M238 100h34M238 100v8h34v-8" stroke="${V}" stroke-width="2" stroke-linecap="round"/>
  <circle cx="255" cy="81" r="11" stroke="${V}" stroke-width="2" class="ill-pulse"/>

  <path d="M150 81h56" stroke="${IRON}" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 6"/>
  <path d="M198 75l8 6-8 6" stroke="${IRON}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Why it is private: the file goes across, not up. */
const privacy = `
<svg viewBox="0 0 320 180" role="img" aria-label="The file passes between devices instead of through a server" fill="none">
  <rect x="122" y="10" width="76" height="40" rx="3" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <path d="M134 24h20M134 32h32M134 40h14" stroke="${A}" stroke-width="1.5" stroke-linecap="round"/>
  <text x="160" y="66" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="${IRON}">server</text>

  <path d="M60 108V72M260 108V72" stroke="${A}" stroke-width="2" stroke-dasharray="4 5"/>
  <g stroke="${IRON}" stroke-width="2.5" stroke-linecap="round">
    <path d="M52 64l16 16M68 64l-16 16"/>
    <path d="M252 64l16 16M268 64l-16 16"/>
  </g>

  <rect x="18" y="108" width="84" height="54" rx="3" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>
  <rect x="218" y="108" width="84" height="54" rx="3" fill="${SURF}" stroke="${A}" stroke-width="1.5"/>

  <path d="M110 135h100" stroke="${V}" stroke-width="3" stroke-linecap="round"/>
  <path d="M198 128l10 7-10 7" stroke="${V}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="160" cy="135" r="6" fill="${V}" class="ill-travel"/>
</svg>`;

/** Speed: a noisy measurement resolving, matching the logo. */
const speed = `
<svg viewBox="0 0 320 120" role="img" aria-label="A noisy signal resolving into a steady one" fill="none">
  <path d="M14 60l14-26 12 46 12-54 12 60 12-40 12 26" stroke="${IRON}" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
  <path d="M110 60c46 0 74-12 112-12s58 8 84 12" stroke="${V}" stroke-width="3" stroke-linecap="round"
        class="ill-draw"/>
  <circle cx="306" cy="60" r="6" fill="${V}"/>
</svg>`;

const ART = { transfer, pairing, privacy, speed };

/**
 * Place illustrations into any element carrying data-ill="<name>".
 * Unknown names are left alone rather than throwing — a typo in markup should
 * not take the page down.
 */
export function paint(root = document) {
  for (const el of root.querySelectorAll('[data-ill]')) {
    const art = ART[el.dataset.ill];
    if (art) el.innerHTML = art;
  }
}
