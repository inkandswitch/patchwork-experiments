import { describe, it, expect } from "vitest";
import { snapshotMotion, motionSource, plugin } from "../src/motion-source.js";

describe("snapshotMotion", () => {
  it("shapes a full device reading into plain values", () => {
    const fake = {
      acceleration: { x: 1, y: 2, z: 3 },
      rotationRate: { alpha: 10, beta: 20, gamma: 30 },
      interval: 16,
    };
    expect(snapshotMotion(fake)).toEqual({
      acceleration: { x: 1, y: 2, z: 3 },
      rotationRate: { alpha: 10, beta: 20, gamma: 30 },
      interval: 16,
    });
  });

  it("defaults null acceleration / rotationRate / axes to 0", () => {
    expect(snapshotMotion({ acceleration: null, rotationRate: null })).toEqual({
      acceleration: { x: 0, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      interval: 0,
    });
    expect(snapshotMotion({ acceleration: { x: 5, y: null, z: null }, rotationRate: { alpha: null, beta: 7, gamma: null }, interval: 8 })).toEqual({
      acceleration: { x: 5, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 7, gamma: 0 },
      interval: 8,
    });
  });

  it("survives a totally empty event", () => {
    expect(snapshotMotion(undefined)).toEqual({
      acceleration: { x: 0, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      interval: 0,
    });
  });

  it("pushes a snapshotted value through a live listener", () => {
    // happy-dom DOES provide window.addEventListener but NOT a devicemotion
    // sensor — we can still dispatch a synthetic event and see it flow.
    const { stream, stop } = motionSource();
    const evt = new Event("devicemotion");
    Object.assign(evt, { acceleration: { x: 9, y: 8, z: 7 }, rotationRate: { alpha: 1, beta: 2, gamma: 3 }, interval: 4 });
    window.dispatchEvent(evt);
    expect(stream.value).toEqual({
      acceleration: { x: 9, y: 8, z: 7 },
      rotationRate: { alpha: 1, beta: 2, gamma: 3 },
      interval: 4,
    });
    expect(() => stop()).not.toThrow();
  });
});

describe("motion plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("device-motion");
    expect(plugin.name).toBe("Motion");
    expect(plugin.icon).toBe("Activity");
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0]).toMatchObject({ name: "motion", type: "json" });
    expect(plugin.outlets[0].schema).toBeTruthy();
    expect(plugin.outlets[0].schema["~standard"]).toBeTruthy();
  });

  it("load() returns a gated mount factory", async () => {
    const mount = await plugin.load();
    expect(typeof mount).toBe("function");
    // mount it: gated → an Enable button is rendered, outlet proxy registered,
    // start() not called until the gesture.
    const element = document.createElement("div");
    const outs = {};
    const cleanup = mount({ element, setOutlet: (n, s) => { outs[n] = s; } });
    expect(outs.motion).toBeTruthy(); // proxy wired up front
    expect(element.querySelector("button")).toBeTruthy(); // Enable button (gated)
    expect(() => cleanup()).not.toThrow();
  });
});
