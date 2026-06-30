// the Battery Status API as a SOURCE — emits a plain {level, charging, chargingTime,
// dischargingTime} snapshot on init and whenever the level/charging state changes.
// navigator.getBattery() is a PROMISE that resolves to a BatteryManager (an event
// target); we listen for levelchange/chargingchange and snapshot on each. (gated:
// while no permission prompt fires today, keeping it gated matches the other devices
// and lets you wire the outlet before enabling.)
import { Source } from "./opstreams.js";
import { makeSourceMount } from "./source-nodes.js";

// a battery snapshot — an object carrying a numeric `level` (0–1 charge fraction)
const batterySchema = () => ({
  "~standard": {
    version: 1,
    vendor: "sketchy",
    validate: (value) =>
      value && typeof value === "object" && typeof value.level === "number"
        ? { value }
        : { issues: [{ message: "expected a battery snapshot { level, … }" }] },
  },
});

// pure: snapshot a BatteryManager into a plain, JSON-shaped value (unit-testable
// without a real device — pass any object with the four fields)
export function snapshotBattery(b) {
  if (!b) return null;
  return {
    level: b.level,
    charging: b.charging,
    chargingTime: b.chargingTime,
    dischargingTime: b.dischargingTime,
  };
}

// the device battery, watched via the Battery Status API. Resolves the
// getBattery() promise, snapshots immediately, then re-snapshots on
// levelchange/chargingchange. stop() removes the listeners.
export function batterySource() {
  const stream = new Source(null);
  let mgr = null, onChange = null, cancelled = false;
  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    navigator.getBattery().then((b) => {
      if (cancelled) return;
      mgr = b;
      onChange = () => stream.push(snapshotBattery(b));
      b.addEventListener("levelchange", onChange);
      b.addEventListener("chargingchange", onChange);
      stream.push(snapshotBattery(b));
    }).catch((e) => stream.push({ error: e && e.message }));
  } else {
    stream.push({ error: "Battery Status API unavailable" });
  }
  return {
    stream,
    stop: () => {
      cancelled = true;
      if (mgr && onChange) {
        mgr.removeEventListener("levelchange", onChange);
        mgr.removeEventListener("chargingchange", onChange);
      }
    },
  };
}

export const plugin = {
  type: "sketchy:window",
  id: "battery",
  name: "Battery",
  icon: "BatteryCharging",
  inlets: [],
  outlets: [{ name: "battery", type: "json", schema: batterySchema() }],
  async load() {
    return makeSourceMount({ start: batterySource, outlet: "battery", label: "Battery", gated: true });
  },
};
