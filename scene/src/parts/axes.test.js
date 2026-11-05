import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as THREE from "three";
import { mountStage } from "../test/stage-harness.js";
import axes, { axisLabels, axisLength, triadLabels } from "./axes.js";

const mount = (doc = {}) => mountStage({ extensions: [{ meta: { id: "scene.axes" }, module: axes }], doc });
const run = (s) => s.api("scene.axes").run({ ext: "scene.axes", command: "axes", target: null });
const layer = (s) => s.debug.viewport.layers.get("scene.axes").values().next().value;
const labelEls = (s, cls) => [...s.root.querySelectorAll(`.labels .${cls}`)];
const fakeRenderer = () => {
  const calls = [];
  const r = { autoClear: true, clearDepth: () => calls.push("clearDepth"), setScissorTest: (v) => calls.push(`scissor:${v}`), setScissor: (...a) => calls.push(`setScissor:${a}`), setViewport: (...a) => calls.push(`viewport:${a}`), render: () => calls.push("render") };
  return { r, calls };
};

describe("scene.axes (pure)", () => {
  it("reaches the grid's edge with the grid on, else a little past the scene", () => {
    expect(axisLength(null, { grid: true, unit: "m" })).toBeCloseTo(0.6);
    expect(axisLength(null, { grid: false, unit: "m" })).toBeCloseTo(0.6);
    expect(axisLength({ min: [0, 0, 0], max: [0.01, 0.01, 0.01] }, { grid: false, unit: "m" })).toBe(0.1);
    expect(axisLength({ min: [-3, 0, 0], max: [1, 1, 1] }, { grid: true, unit: "m" })).toBe(4);
  });
  it("labels each axis just past its end", () => {
    const l = axisLabels(2);
    expect(l.map((x) => x.text)).toEqual(["X", "Y", "Z"]);
    expect(l[1].position).toEqual([0, 2 * 1.07, 0]);
  });
  it("puts the triad's labels in the bottom-left corner", () => {
    const l = triadLabels([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: -1 }], 300);
    expect(l[0].screen).toEqual({ x: 8 + 96, y: 300 - 8 - 48 });
    expect(l[1].screen).toEqual({ x: 8 + 48, y: 300 - 8 - 96 });
    expect(l[2].screen).toEqual({ x: 8, y: 300 - 8 });
  });
});

describe("scene.axes", () => {
  it("draws three axis lines with labels, and toggles this viewer's axes pref", async () => {
    const s = await mount();
    expect(layer(s).children.length).toBe(3);
    expect(labelEls(s, "axis-label").map((e) => e.textContent)).toEqual(["X", "Y", "Z"]);
    expect(labelEls(s, "axis-label")[0].dataset.axis).toBe("x");
    const c = s.instance("scene.axes").commands[0];
    expect(c.state(null, {})).toMatchObject({ checked: true });
    expect(c.state("a", {})).toBe(null);
    expect(run(s)).toBe(true);
    await s.settle();
    expect(s.local.get().prefs.axes).toBe(false);
    expect(s.doc().view.axes).toBe(true);
    expect(layer(s).children.length).toBe(0);
    expect(labelEls(s, "axis-label")).toEqual([]);
    s.unmount();
  });

  it("draws the triad after the main pass, in a scissored corner, with its labels on screen", async () => {
    const s = await mount();
    const api = s.api("scene.axes");
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(3, 2, 4);
    cam.lookAt(0, 0, 0);
    api.camera = { ...api.camera, object: cam };
    const hooks = [...s.debug.viewport.afterHooks];
    expect(hooks.length).toBe(1);
    const { r, calls } = fakeRenderer();
    hooks[0](r, { w: 400, h: 300 });
    expect(calls).toContain("clearDepth");
    expect(calls).toContain("setScissor:8,8,96,96");
    expect(calls).toContain("render");
    const tri = labelEls(s, "triad-label");
    expect(tri.map((e) => e.textContent)).toEqual(["X", "Y", "Z"]);
    // the world axes' labels are kept alongside (one label set per extension)
    expect(labelEls(s, "axis-label").length).toBe(3);
    // Y points up the screen
    const y = [...s.debug.viewport.labels.groups].find(([k]) => k.startsWith("scene.axes#"))[1].get("triad-y").screen;
    expect(y.y).toBeLessThan(300 - 8 - 48);
    // axes off: the hook goes, and the triad's labels with it
    run(s);
    await s.settle();
    expect(s.debug.viewport.afterHooks.size).toBe(0);
    expect(labelEls(s, "triad-label")).toEqual([]);
    s.unmount();
  });

  it("starts hidden when the doc suggests no axes", async () => {
    const s = await mount({ view: { axes: false } });
    expect(layer(s).children.length).toBe(0);
    expect(s.debug.viewport.afterHooks.size).toBe(0);
    s.unmount();
  });
});
