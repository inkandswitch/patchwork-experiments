// Device-orientation SOURCE — emits the phone/laptop's compass + tilt as it moves.
// `deviceorientation` fires {alpha,beta,gamma,absolute}: alpha = compass heading
// (0–360°), beta = front-back tilt (−180–180°), gamma = left-right tilt (−90–90°),
// absolute = whether the angles are relative to true earth coordinates.
import { Source } from "./opstreams.js";
import { makeSourceMount } from "./source-nodes.js";

// a device-orientation snapshot { alpha, beta, gamma } — each a number OR null
// (the angle can be absent when the sensor lacks that axis).
const isNumOrNull = (n) => n === null || typeof n === "number";
const orientationSchema = () => ({
  "~standard": {
    version: 1,
    vendor: "sketchy",
    validate: (value) =>
      value && typeof value === "object" && isNumOrNull(value.alpha) && isNumOrNull(value.beta) && isNumOrNull(value.gamma)
        ? { value }
        : { issues: [{ message: "expected an orientation { alpha, beta, gamma } (numbers or null)" }] },
  },
});

// pure: snapshot a DeviceOrientationEvent into a plain, JSON-shaped value
export function snapshotOrientation(e) {
  if (!e) return null;
  return {
    alpha: e.alpha ?? null,
    beta: e.beta ?? null,
    gamma: e.gamma ?? null,
    absolute: !!e.absolute,
  };
}

// the device's orientation, listened on `window` (gated: iOS prompts on the gesture)
export function orientationSource() {
  const stream = new Source(null);
  const haveWindow = typeof window !== "undefined" && typeof window.addEventListener === "function";
  let onOrient = null;
  if (haveWindow) {
    onOrient = (e) => stream.push(snapshotOrientation(e));
    window.addEventListener("deviceorientation", onOrient);
  } else {
    stream.push({ error: "deviceorientation unavailable" });
  }
  return { stream, stop: () => { if (onOrient) window.removeEventListener("deviceorientation", onOrient); } };
}

export const plugin = {
  type: "sketchy:window",
  id: "device-orientation",
  name: "Orientation",
  icon: "Compass",
  inlets: [],
  outlets: [{ name: "orientation", type: "json", schema: orientationSchema() }],
  async load() {
    return makeSourceMount({ start: orientationSource, outlet: "orientation", label: "Orientation", gated: true });
  },
};
