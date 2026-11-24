// The camera each viewer keeps of a scene (API.md, "The camera": saved per
// viewer, else the doc's `view.start.home`): kept in this browser's storage
// under the outermost doc's URL, written a moment after the viewer's own
// orbit stops (a Frame, the autoframe's too, isn't kept, so a scene opened
// again still frames what it has then), and put back as the view opens.

/** How long after the orbit stops the camera is saved (ms). */
const SAVE_MS = 500;

const isVec3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => Number.isFinite(Number(n)));

/** A camera as saved (position, target, fov?), checked; null if it isn't one. Pure. */
export function cleanCamera(c) {
  if (!c || typeof c !== "object" || !isVec3(c.position)) return null;
  const out = { position: c.position.slice(0, 3).map(Number) };
  if (isVec3(c.target)) out.target = c.target.slice(0, 3).map(Number);
  if (Number.isFinite(Number(c.fov)) && c.fov != null) out.fov = Number(c.fov);
  return out;
}

/**
 * Where the camera starts: this viewer's saved camera, else the doc's
 * suggested home (`home`, as arriving.js startOf reads it), else null (a
 * frame extension frames on first content). Pure.
 */
export function initialCamera({ stored = null, home = null } = {}) {
  return cleanCamera(stored) ?? home ?? null;
}

function readJSON(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // private window, or full: this viewer's camera lasts the session
  }
}

/**
 * The camera kept for `url` on `viewport`: saved after each orbit (by
 * `later`, while `live()`), put back by `restore(home)`; `placed()` says
 * whether the view opened on a camera of its own (saved, or the doc's home)
 * rather than one a hand or a frame put there.
 */
export function createCameraMemory({ viewport, url, later, live }) {
  const key = `scene-camera:${url}`;
  let placed = false;
  let timer = null;
  const off = viewport.onCameraEnd((_, how) => {
    if (how !== "orbit") return;
    timer?.();
    timer = later(() => {
      timer = null;
      if (!live() || viewport.held) return;
      const cam = cleanCamera(viewport.getCamera());
      if (cam) writeJSON(key, cam);
    }, SAVE_MS);
  });
  return {
    restore(home) {
      const cam = initialCamera({ stored: readJSON(key), home });
      if (cam && viewport.ok) {
        viewport.setCamera(cam);
        placed = true;
      }
    },
    placed: () => placed,
    dispose: off,
  };
}
