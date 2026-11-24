// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import grid, { sceneExtent } from "./grid.js";

const mount = (doc = {}) => mountStage({ editor: true, natives: true,  extensions: [{ meta: { id: "scene.grid" }, module: grid }], doc });
const run = (s, command, value) => s.api("scene.grid").run({ ext: "scene.grid", command, target: null, value });
const state = (s, target = null) => s.instance("scene.grid").commands.find((c) => c.id === "grid").state(target, { scene: s.facet("scene.grid").scene(), local: s.local.get() });
const caption = (s) => s.root.querySelector(".grid-caption");
const labels = (s) => [...s.root.querySelectorAll(".labels .grid-label")];

describe("scene.grid (pure)", () => {
  it("covers the scene's horizontal reach, or half its height", () => {
    expect(sceneExtent(null)).toBe(0.5);
    expect(sceneExtent({ min: [-3, 0, -1], max: [2, 1, 1] })).toBe(3);
    expect(sceneExtent({ min: [0, 0, 0], max: [1, 10, 1] })).toBe(5);
  });
});

describe("scene.grid", () => {
  it("toggles this viewer's grid pref, never the doc", async () => {
    const s = await mount();
    expect(s.debug.viewport.extents.has("scene.grid")).toBe(true);
    expect(run(s, "grid")).toBe(true);
    await s.settle();
    expect(s.local.get()["scene.prefs"].grid).toBe(false);
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
    s.api("scene.grid").use("prefs").set("grid", true);
    s.api("scene.grid").use("prefs").set("units", "cm");
    await s.settle();
    expect(caption(s).textContent).toBe("grid 10 cm");
    expect(labels(s).some((l) => l.textContent.endsWith(" cm"))).toBe(true);
    // content arriving makes the scene bigger (no WebGL here, so the box is stubbed)
    s.facet("scene.grid").sceneBox = () => ({ min: [-3, 0, -1], max: [2, 1, 1] });
    s.api("scene.grid").use("prefs").set("units", "m");
    s.change((d) => (d.objects.a = object()));
    await s.settle();
    expect(caption(s).textContent).toBe("grid 1 m");
    s.unmount();
  });
});
