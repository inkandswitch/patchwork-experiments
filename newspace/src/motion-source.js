// Device motion SOURCE — the accelerometer + gyroscope via the `devicemotion`
// window event. Pushes a plain {acceleration, rotationRate, interval} snapshot
// each event. Gated: on mobile Safari (and friends) reading motion requires a
// user-gesture permission grant, so the node shows an Enable button.
import { Source } from "./opstreams.js";
import { makeSourceMount } from "./source-nodes.js";

// a device-motion snapshot — an object carrying an `acceleration` reading
const motionSchema = () => ({
  "~standard": {
    version: 1,
    vendor: "sketchy",
    validate: (value) =>
      value && typeof value === "object" && !!value.acceleration && typeof value.acceleration === "object"
        ? { value }
        : { issues: [{ message: "expected a motion snapshot { acceleration, … }" }] },
  },
});

// pure: snapshot a DeviceMotionEvent into a plain, JSON-shaped value. Reads the
// nested acceleration / rotationRate dictionaries defensively (they can be null,
// and each axis can be null when the sensor lacks that component), defaulting
// every missing number to 0.
export function snapshotMotion(e) {
  const a = (e && e.acceleration) || null;
  const r = (e && e.rotationRate) || null;
  return {
    acceleration: { x: (a && a.x) || 0, y: (a && a.y) || 0, z: (a && a.z) || 0 },
    rotationRate: { alpha: (r && r.alpha) || 0, beta: (r && r.beta) || 0, gamma: (r && r.gamma) || 0 },
    interval: (e && e.interval) || 0,
  };
}

// the device's motion sensors, listened on the window's `devicemotion` event
// (prompts for permission via the gated mount). Guards when window is absent.
export function motionSource() {
  const stream = new Source(null);
  const win = typeof window !== "undefined" ? window : null;
  let onMotion = null;
  if (win && win.addEventListener) {
    onMotion = (e) => stream.push(snapshotMotion(e));
    win.addEventListener("devicemotion", onMotion);
  } else {
    stream.push({ error: "device motion unavailable" });
  }
  return { stream, stop: () => { if (onMotion && win) win.removeEventListener("devicemotion", onMotion); } };
}

export const plugin = {
  type: "sketchy:surface",
  id: "device-motion",
  name: "Motion",
  icon: "Activity",
  inlets: [],
  outlets: [{ name: "motion", type: "json", schema: motionSchema() }],
  async load() {
    return makeSourceMount({ start: motionSource, outlet: "motion", label: "Motion", gated: true });
  },
};
