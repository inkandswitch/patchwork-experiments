// Pointer Lock as a SOURCE — once the pointer is locked to the page, the browser
// stops clamping the cursor to the viewport and reports raw, unbounded relative
// motion in `movementX/movementY`. We snapshot each mousemove into a plain
// `{ dx, dy }` delta and push it. (gated: pointer lock must be requested from a
// user gesture, so the box shows an Enable button before it starts.)
import { Source } from "./opstreams.js";
import { makeSourceMount } from "./source-nodes.js";

// a pointer-lock delta { dx, dy } — both numeric (the raw relative motion)
const deltaSchema = () => ({
  "~standard": {
    version: 1,
    vendor: "sketchy",
    validate: (value) =>
      value && typeof value === "object" && typeof value.dx === "number" && typeof value.dy === "number"
        ? { value }
        : { issues: [{ message: "expected a pointer delta { dx, dy }" }] },
  },
});

// pure: a mousemove event → a plain { dx, dy } relative-motion delta. Falls back to
// 0 on either axis when the platform doesn't supply movement (so it's always a
// finite pair). Unit-testable with any `{ movementX, movementY }`-shaped object.
export function snapshotDelta(e) {
  return { dx: (e && e.movementX) || 0, dy: (e && e.movementY) || 0 };
}

// the pointer-lock device: requests a lock on document.body, then pushes a
// `{ dx, dy }` snapshot for each mousemove while locked. stop() removes the
// listener and exits the lock. Guards when the API/document is absent (pushes an
// `{ error }` and returns a no-op stop).
export function pointerLockSource() {
  const stream = new Source(null);
  const doc = typeof document !== "undefined" ? document : null;
  const body = doc && doc.body;
  if (!body || typeof body.requestPointerLock !== "function") {
    stream.push({ error: "Pointer Lock API unavailable" });
    return { stream, stop: () => {} };
  }
  const onMove = (e) => stream.push(snapshotDelta(e));
  try { body.requestPointerLock(); } catch (e) { stream.push({ error: e && e.message }); }
  (doc.addEventListener ? doc : body).addEventListener("mousemove", onMove);
  return {
    stream,
    stop: () => {
      (doc.removeEventListener ? doc : body).removeEventListener("mousemove", onMove);
      if (typeof doc.exitPointerLock === "function") doc.exitPointerLock();
    },
  };
}

export const plugin = {
  type: "sketchy:window",
  id: "pointer-lock",
  name: "Pointer lock",
  icon: "MousePointer2",
  inlets: [],
  outlets: [{ name: "delta", type: "json", schema: deltaSchema() }],
  async load() {
    return makeSourceMount({ start: pointerLockSource, outlet: "delta", label: "Pointer lock", gated: true });
  },
};
