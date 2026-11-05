import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import grid, { rulerLabels, sceneExtent } from "./grid.js";
import { gridFor } from "../units.js";

const mount = (doc = {}) => mountStage({ extensions: [{ meta: { id: "scene.grid" }, module: grid }], doc });
const run = (s, command, value) => s.api("scene.grid").run({ ext: "scene.grid", command, target: null, value });
const state = (s, target = null) => s.instance("scene.grid").commands.find((c) => c.id === "grid").state(target, { scene: s.api("scene.grid").scene(), local: s.local.get() });
const caption = (s) => s.root.querySelector(".grid-caption");
const labels = (s) => [...s.root.querySelectorAll(".labels .grid-label")];

describe("scene.grid (pure)", () => {
  it("covers the scene's horizontal reach, or half its height", () => {
    expect(sceneExtent(null)).toBe(0.5);
    expect(sceneExtent({ min: [-3, 0, -1], max: [2, 1, 1] })).toBe(3);
    expect(sceneExtent({ min: [0, 0, 0], max: [1, 10, 1] })).toBe(5);
  });
  it("puts ruler ticks along X and Z, the last one with the unit", () => {
    const g = gridFor(3, "m");
    const items = rulerLabels(g, "m");
    expect(items.every((i) => i.className === "grid-label")).toBe(true);
    expect(items.some((i) => i.key === "x0")).toBe(false);
    const xs = items.filter((i) => i.data.axis === "x");
    expect(xs.at(-1).text.endsWith(" m")).toBe(true);
    expect(xs[0].text.endsWith(" m")).toBe(false);
    expect(items.find((i) => i.data.axis === "z").position[0]).toBe(0);
  });
});

describe("scene.grid", () => {
  it("shows the grid, its ruler and caption, and gives the stage its plane as an extent", async () => {
    const s = await mount();
    expect(state(s)).toMatchObject({ checked: true });
    expect(state(s, "a")).toBe(null);
    expect(caption(s).hidden).toBe(false);
    expect(caption(s).textContent).toBe("grid 0.1 m");
    expect(labels(s).length).toBeGreaterThan(0);
    const ext = s.debug.viewport.extents.get("scene.grid");
    expect(ext.min.y).toBe(0);
    expect(ext.max.x).toBeCloseTo(-ext.min.x);
    expect(s.debug.viewport.layers.get("scene.grid").values().next().value.children.length).toBe(1);
    s.unmount();
  });

  it("toggles this viewer's grid pref, never the doc", async () => {
    const s = await mount();
    expect(run(s, "grid")).toBe(true);
    await s.settle();
    expect(s.local.get().prefs.grid).toBe(false);
    expect(s.doc().view.grid).toBe(true);
    expect(state(s).checked).toBe(false);
    expect(caption(s).hidden).toBe(true);
    expect(labels(s)).toEqual([]);
    expect(s.debug.viewport.extents.has("scene.grid")).toBe(false);
    expect(s.debug.viewport.layers.get("scene.grid").values().next().value.children.length).toBe(0);
    run(s, "grid");
    await s.settle();
    expect(caption(s).hidden).toBe(false);
    s.unmount();
  });

  it("follows the doc's suggestion, the units pref and the scene's size", async () => {
    const s = await mount({ view: { grid: false } });
    expect(caption(s).hidden).toBe(true);
    s.api("scene.grid").setPref("grid", true);
    s.api("scene.grid").setPref("units", "cm");
    await s.settle();
    expect(caption(s).textContent).toBe("grid 10 cm");
    expect(labels(s).some((l) => l.textContent.endsWith(" cm"))).toBe(true);
    // content arriving makes the scene bigger (no WebGL here, so the box is stubbed)
    s.api("scene.grid").sceneBox = () => ({ min: [-3, 0, -1], max: [2, 1, 1] });
    s.api("scene.grid").setPref("units", "m");
    s.change((d) => (d.objects.a = object()));
    await s.settle();
    expect(caption(s).textContent).toBe("grid 1 m");
    s.unmount();
  });

  it("doesn't redraw on a hover", async () => {
    const s = await mount();
    const g = s.debug.viewport.layers.get("scene.grid").values().next().value.children[0];
    s.local.swap((m) => ({ ...m, hovered: "x" }));
    await s.settle();
    expect(s.debug.viewport.layers.get("scene.grid").values().next().value.children[0]).toBe(g);
    s.unmount();
  });
});
