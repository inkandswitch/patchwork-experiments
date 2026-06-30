import { describe, it, expect } from "vitest";
import { snapshotOrientation, orientationSource, plugin } from "./orientation-source.js";

describe("snapshotOrientation (pure)", () => {
  it("shapes a faked DeviceOrientationEvent into a plain value", () => {
    const fake = { alpha: 123.4, beta: -45.6, gamma: 7.8, absolute: true, target: window };
    expect(snapshotOrientation(fake)).toEqual({ alpha: 123.4, beta: -45.6, gamma: 7.8, absolute: true });
  });

  it("returns null for a missing event", () => {
    expect(snapshotOrientation(null)).toBe(null);
  });

  it("nulls absent angles and defaults absolute to false", () => {
    expect(snapshotOrientation({})).toEqual({ alpha: null, beta: null, gamma: null, absolute: false });
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("device-orientation");
    expect(plugin.name).toBe("Orientation");
    expect(plugin.icon).toBe("Compass");
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0].name).toBe("orientation");
    expect(plugin.outlets[0].type).toBe("json");
    expect(plugin.outlets[0].schema).toBeTruthy();
  });

  it("load() returns a gated source mount (a function)", async () => {
    const mount = await plugin.load();
    expect(typeof mount).toBe("function");
  });
});

describe("orientationSource factory", () => {
  it("returns { stream, stop } and wires a real listener under happy-dom without throwing", () => {
    const { stream, stop } = orientationSource();
    expect(stream).toBeTruthy();
    expect(typeof stop).toBe("function");
    // happy-dom HAS window, so the listener branch is taken; initial value is null
    expect(stream.value).toBe(null);
    // a dispatched event should flow through the listener
    window.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha: 10, beta: 20, gamma: 30, absolute: true }));
    expect(stream.value).toEqual({ alpha: 10, beta: 20, gamma: 30, absolute: true });
    expect(() => stop()).not.toThrow();
    // after stop the listener is detached — further events do not update
    window.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha: 99 }));
    expect(stream.value.alpha).toBe(10);
  });
});
