import { describe, it, expect } from "vitest";
import { geometryDigest, variantKey, variantLetters, inputRows, diffInputs, resultRows, setupFromRun } from "./inputs.js";
import { newRun } from "./protocol.js";
import { defaultSetup, normalizeSetup } from "./setup.js";

const tri = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0.1]);
const run = (over = {}) => {
  const r = newRun({
    caseUrl: "automerge:case",
    serverUrl: "automerge:queue",
    setup: normalizeSetup({ ...defaultSetup(), ...over.setup }),
    hull: {
      stl: new Uint8Array(4),
      info: { volume: 2, lwl: 9.9, wettedArea: 30 },
      source: { url: "automerge:hull", heads: ["bbbbbbbbbb", "aaaaaaaaaa"], path: "source", title: "boat.3dm", providerId: "file-3dm", providerName: "Rhino 3DM file", parts: ["Hull Bottom", "Topsides"] },
      frame: { bow: "+x", waterZ: 0.5 },
      geometry: { digest: over.digest ?? "d1".repeat(32), triangles: 11000 },
    },
    now: 1,
    made: { tool: "openfoam", version: "0.1.0" },
  });
  return { ...r, ...over.run };
};

describe("a hull's geometry digest", () => {
  it("is the same for float64 and float32 copies of a hull (a kept hull is float32)", async () => {
    expect(await geometryDigest(tri)).toBe(await geometryDigest(Float32Array.from(tri)));
  });
  it("changes with the geometry", async () => {
    const moved = Float64Array.from(tri);
    moved[8] = 0.2;
    expect(await geometryDigest(moved)).not.toBe(await geometryDigest(tri));
    expect(await geometryDigest(tri)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hull variations", () => {
  it("are told apart by geometry, not by speed or attitude", () => {
    const a1 = run();
    const a2 = run({ setup: { speed: { value: 3, unit: "m/s" }, attitude: { sinkage: 0.1, trim: 1, heel: 20 } } });
    const b = run({ digest: "e2".repeat(32) });
    expect(variantKey(a1)).toBe(variantKey(a2));
    expect(variantKey(b)).not.toBe(variantKey(a1));
  });
  it("are lettered in the order they first appear, so a letter never moves", () => {
    const a = run();
    const b = run({ digest: "e2".repeat(32) });
    const m = variantLetters([a, null, b, a]);
    expect([m.get(variantKey(a)), m.get(variantKey(b))]).toEqual(["A", "B"]);
    expect(variantLetters([run({ digest: "x" })]).size).toBe(1);
  });
  it("fall back to where the hull came from when a run has no digest", () => {
    const r = run();
    delete r.hull.geometry;
    expect(variantKey(r)).toBe("s:automerge:hull|aaaaaaaa bbbbbbbb|Hull Bottom,Topsides|+x");
  });
});

describe("a run's inputs", () => {
  it("cover the hull, how it floats, the flow, the solver and where it ran", () => {
    const rows = inputRows(run({ run: { daemon: { host: "mac", openfoam: "v2606", cores: 8, version: "0.1.0", commit: "abc123", dirty: true }, recipe: { digest: "f".repeat(64), count: 15 } } }));
    expect([...new Set(rows.map((r) => r.group))]).toEqual(["Hull", "Floating", "Flow", "Solver", "Ran on"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["hull.heads"].value).toBe("aaaaaaaa bbbbbbbb");
    expect(by["hull.parts"].value).toBe("Hull Bottom, Topsides");
    expect(by["hull.geometry"].value).toMatch(/^d1d1d1d1d1 · 11,000 triangles$/);
    expect(by["daemon.code"].value).toBe("0.1.0 @ abc123 (with changes)");
    expect(by["recipe"].value).toMatch(/15 files/);
    // every row says something, and nothing is undefined
    for (const r of rows) expect(r.value).not.toMatch(/undefined|NaN/);
  });
  it("say which differ between two runs: one changed input is one difference", () => {
    const a = run();
    expect(diffInputs(a, run()).size).toBe(0);
    expect([...diffInputs(a, run({ setup: { speed: { value: 3, unit: "m/s" } } }))]).toEqual(["setup.speed"]);
    const b = run({ digest: "e2".repeat(32) });
    expect([...diffInputs(a, b)]).toEqual(["hull.geometry"]);
  });
  it("set results side by side, with what's missing as null", () => {
    const rows = resultRows(run({ run: { summary: { Rt: 700, Rp: 300, Rv: 400, power: 2000, Ct: 0.004, Fz: -1, half: true, Fy: 0, cells: 1, iterations: 500 }, startedAt: 0, finishedAt: 40_000 } }));
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(by.Rt).toBe(700);
    expect(by.Ct).toBeCloseTo(4);
    expect(by.Fy).toBe(null); // a half model has no side force
    expect(by.time).toBe(40);
  });
});

describe("setting the case up from a run", () => {
  it("gives back its setup and the hull it was read from", () => {
    const r = run({ setup: { speed: { value: 3, unit: "m/s" }, attitude: { sinkage: 0.1, trim: 0, heel: 10 } } });
    r.hull.source.stash = "automerge:stash";
    const { setup, hull } = setupFromRun(r);
    expect(setup).toEqual(r.setup);
    expect(setup).not.toBe(r.setup);
    expect(hull).toEqual({ url: "automerge:hull", bow: "+x", parts: ["Hull Bottom", "Topsides"], stash: "automerge:stash" });
  });
});
