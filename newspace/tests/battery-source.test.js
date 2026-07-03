import { describe, it, expect } from "vitest";
import { snapshotBattery, batterySource, plugin } from "../src/battery-source.js";

describe("snapshotBattery", () => {
  it("shapes a faked BatteryManager reading into a plain value", () => {
    const fake = {
      level: 0.42,
      charging: true,
      chargingTime: 1800,
      dischargingTime: Infinity,
      addEventListener() {},
      removeEventListener() {},
    };
    expect(snapshotBattery(fake)).toEqual({
      level: 0.42,
      charging: true,
      chargingTime: 1800,
      dischargingTime: Infinity,
    });
  });

  it("returns null for a missing reading", () => {
    expect(snapshotBattery(null)).toBe(null);
    expect(snapshotBattery(undefined)).toBe(null);
  });
});

describe("batterySource factory (device absent under happy-dom)", () => {
  it("returns { stream, stop } and pushes an error without throwing", () => {
    expect(typeof navigator.getBattery).not.toBe("function"); // happy-dom lacks it
    const src = batterySource();
    expect(src.stream).toBeTruthy();
    expect(typeof src.stop).toBe("function");
    // unavailable branch pushes an { error } value
    expect(src.stream.value).toEqual({ error: "Battery Status API unavailable" });
    expect(() => src.stop()).not.toThrow();
  });
});

describe("plugin descriptor", () => {
  it("has the expected shape", () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("battery");
    expect(plugin.name).toBe("Battery");
    expect(plugin.icon).toBe("BatteryCharging");
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toHaveLength(1);
    expect(plugin.outlets[0].name).toBe("battery");
    expect(plugin.outlets[0].type).toBe("json");
    expect(plugin.outlets[0].schema).toBeTruthy();
  });

  it("load() returns a gated mount function", async () => {
    const mount = await plugin.load();
    expect(typeof mount).toBe("function");
  });
});
