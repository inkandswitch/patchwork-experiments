import { describe, it, expect } from "vitest";
import { fitView, toScreen, toWorld, hitElement, dialGeometry, headingFromDial, sampleHeatmap, newElementId, unmaskedRuns, probeText } from "./view2d.js";
import { compileField } from "./field.js";
import { RANKINE_SEED } from "./datatype.js";

describe("view2d", () => {
  const domain = { min: [-6, -6, -4], max: [16, 6, 4] };
  const v = fitView(domain, 800, 400, 20);

  it("fits the domain, north up, and round-trips", () => {
    const [ax, ay] = toScreen(v, -6, 6);
    const [bx, by] = toScreen(v, 16, -6);
    expect(ax).toBeGreaterThanOrEqual(19.99);
    expect(bx).toBeLessThanOrEqual(780.01);
    expect(ay).toBeLessThan(by); // north is up the screen
    expect(ay).toBeGreaterThanOrEqual(19.99);
    const [x, y] = toWorld(v, 321, 123);
    const [sx, sy] = toScreen(v, x, y);
    expect(sx).toBeCloseTo(321);
    expect(sy).toBeCloseTo(123);
  });

  it("hits the nearest element within the radius", () => {
    const els = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0.2, y: 0 }];
    const [sx, sy] = toScreen(v, 0.19, 0);
    expect(hitElement(v, els, sx, sy)?.id).toBe("b");
    expect(hitElement(v, els, sx + 100, sy)).toBeNull();
  });

  it("reads a heading off the dial counter-clockwise from east", () => {
    const d = dialGeometry(v);
    expect(headingFromDial(d, d.cx + 10, d.cy)).toBe(0);
    expect(headingFromDial(d, d.cx, d.cy - 10)).toBe(90); // up the screen = north
    expect(headingFromDial(d, d.cx - 10, d.cy)).toBe(180);
    expect(headingFromDial(d, d.cx, d.cy + 10)).toBe(270);
    expect(headingFromDial(d, d.cx + 10, d.cy - 9, 15)).toBe(45);
  });

  it("samples a heatmap with the Rankine body masked", () => {
    const f = compileField(RANKINE_SEED);
    const s = sampleHeatmap(f, 0, 44, 24, { maskEvery: 2, planar: true });
    const inside = s.inside.reduce((a, b) => a + b, 0);
    expect(inside).toBeGreaterThan(0.04 * 44 * 24);
    expect(inside).toBeLessThan(0.14 * 44 * 24);
    // the cell at mid-body is inside, the one at the domain corner is not
    const cell = (x, y) => Math.floor(((y + 6) / 12) * 24) * 44 + Math.floor(((x + 6) / 22) * 44);
    expect(s.inside[cell(5, 0)]).toBe(1);
    expect(s.inside[cell(-5, 5)]).toBe(0);
    expect(s.cp[cell(-5, 5)]).toBeCloseTo(0, 1);
  });

  it("masks the body below the plane its elements sit in", () => {
    // half-breadth is ~1.37 m, so at z = −0.8 the mid-body is still inside;
    // a trace held to the plane never reaches the source at z = 0
    const f = compileField(RANKINE_SEED);
    const cell = (x, y) => Math.floor(((y + 6) / 12) * 55) * 100 + Math.floor(((x + 6) / 22) * 100);
    const s = sampleHeatmap(f, -0.8, 100, 55, { maskEvery: 3 });
    expect(s.inside[cell(5, 0)]).toBe(1);
    expect(s.inside[cell(3, 0.4)]).toBe(1);
    expect(s.inside[cell(5, 1.3)]).toBe(0);
    expect(s.inside.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.02 * 100 * 55);
  });

  it("makes fresh element ids", () => {
    let n = 0;
    const rand = () => [0.1, 0.1, 0.7][n++];
    const a = newElementId("source", {}, () => 0.1);
    expect(a).toMatch(/^source-/);
    expect(newElementId("vortex-line", { [a.replace("source", "vortex")]: {} }, rand)).not.toBe(a.replace("source", "vortex"));
  });

  it("unmaskedRuns drops the part of a streamline that crosses a masked body", () => {
    const domain = { min: [0, 0, 0], max: [4, 2, 1] };
    // 4 x 2 cells of 1 m; cell (2, 1) is body
    const sample = { cols: 4, rows: 2, inside: Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 0]) };
    const line = [[0.5, 1.5, 0], [1.5, 1.5, 0], [2.5, 1.5, 0], [3.2, 1.5, 0], [3.8, 1.5, 0]];
    expect(unmaskedRuns(line, sample, domain)).toEqual([line.slice(0, 2), line.slice(3)]);
    // a lone point either side of the body is not a run
    expect(unmaskedRuns([[1.5, 1.5, 0], [2.5, 1.5, 0], [3.5, 1.5, 0]], sample, domain)).toEqual([]);
    // no mask: the whole line
    expect(unmaskedRuns(line, null, domain)).toEqual([line]);
  });

  it("the axis streamline of a hull-shaped body stops at the mask", () => {
    const zW = 0.666;
    const f = compileField({
      freestream: { speed: 2.5, headingDeg: 180 },
      domain: { min: [-2.5, -2.6, -1.8], max: [8, 2.6, 0.7] },
      elements: {
        bow: { kind: "source", position: [4.38, 0, zW], strength: 1.78 },
        fwd: { kind: "source", position: [3.09, 0, zW], strength: 6.3 },
        stern: { kind: "sink", position: [0.6, 0, zW], strength: 8.08 },
      },
    });
    const s = sampleHeatmap(f, 0, 105, 52, { maskEvery: 2 });
    const line = [];
    for (let x = 7.9; x > -2.4; x -= 0.05) line.push([x, 0.01, 0]);
    const runs = unmaskedRuns(line, s, f.domain);
    expect(runs.length).toBe(2); // ahead of the body and in its wake
    const inBody = (p) => p[0] > 1.2 && p[0] < 2.4;
    expect(runs.flat().some(inBody)).toBe(false);
  });
});

describe("probeText", () => {
  const f = compileField({
    freestream: { speed: 2.5, headingDeg: 180 },
    elements: { s: { kind: "source", position: [3, 0, 0.666], strength: 6 } },
    domain: { min: [-2, -2, -1], max: [8, 2, 1] },
  });
  it("reads speed and Cp in the stream", () => {
    expect(probeText(f, 0, 1.5, 0.666)).toMatch(/^x 0\.00  y 1\.50  z 0\.67 m · \|V\| 2\.\d\d m\/s · Cp -?0\.\d\d$/);
  });
  it("names the element instead of printing a runaway number next to it", () => {
    const t = probeText(f, 3.01, 0, 0.666);
    expect(t).toMatch(/at the source: \|V\| > 50\.00 m\/s$/);
    expect(t).not.toMatch(/Cp/);
  });
});
