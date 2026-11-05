// Peers' selections out of presence, and the colour each peer is drawn in:
// shared by scene.select (boxes in the view) and scene.outline (rows), so a
// peer's box and their row are always the same colour. Pure.

const DEFAULT_REMOTE = [0.6, 0.4, 0.9];
/** How far (degrees) a peer's hue may sit from the theme's remote hue, either way. */
const SPREAD = 60;
/** How many distinct hues the spread is cut into. */
const STEPS = 7;

/** A stable 32-bit hash of a string (FNV-1a). */
export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const isRgb = (c) => Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((n) => Number.isFinite(n));

/**
 * A peer's colour: the theme's remote colour turned by a hue step picked
 * from a stable hash of who they are (their viewer, else their session), so
 * each peer keeps one colour, on every screen, near the theme's remote hue.
 * @param {number[]} remote  the theme's remote colour, [r, g, b] in 0..1
 * @param {string} who  the peer's viewer (or session) string
 * @returns {number[]} [r, g, b] in 0..1
 */
export function peerColor(remote, who) {
  const base = isRgb(remote) ? remote : DEFAULT_REMOTE;
  const [h, s, l] = rgbToHsl(base);
  const step = (hashString(who) % STEPS) - (STEPS - 1) / 2; // −3 … 3
  const hue = (((h + (step * 2 * SPREAD) / (STEPS - 1)) % 360) + 360) % 360;
  return hslToRgb([hue, s, l]);
}

/** peerColor as a CSS rgb() colour. */
export function peerCss(remote, who) {
  const [r, g, b] = peerColor(remote, who).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return `rgb(${r} ${g} ${b})`;
}

/**
 * What each peer has selected, from api.presence.get(): [{ session, viewer,
 * selected, hovered }], peers that have something to show, by session.
 * References to objects that aren't in `objects` are dropped.
 * @param {object} peers  presence.get()
 * @param {string} ext  the extension id the keys are under
 * @param {object} [objects]  the scene's objects (optional filter)
 */
export function peerSelections(peers, ext, objects = null) {
  const out = [];
  for (const [session, rec] of Object.entries(peers ?? {})) {
    const k = rec?.keys?.[ext];
    if (!k) continue;
    const ok = (id) => typeof id === "string" && (!objects || !!objects[id]);
    const selected = ok(k.selected) ? k.selected : null;
    const hovered = ok(k.hovered) ? k.hovered : null;
    if (!selected && !hovered) continue;
    out.push({ session, viewer: rec.viewer ?? null, selected, hovered });
  }
  return out.sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
}
