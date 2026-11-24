// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import legends, { legendCards, sanitizeLegend } from "./legends.js";
import { legendModel, tintStop } from "./legend.js";

const LEGEND = { title: "Speed", unit: "m/s", min: 2, max: 3, stops: ["#000000", "#808080", "#ffffff"] };
const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

async function mount(doc, legendsById = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.legends" }, module: legends }], doc });
  // no WebGL here: what the stage would say each object's GLB carries
  s.facet("scene.legends").content = (id) => (legendsById[id] ? { loaded: true, box: null, extras: { legend: legendsById[id] }, stats: null } : null);
  s.change((d) => (d.title = "content arrived"));
  await s.settle();
  return s;
}
const cards = (s) => [...s.root.querySelectorAll(".stage-overlay > .legends > .legend")];

describe("scene.legends (pure)", () => {
  it("turns a provider's legend into a label, a gradient and three ticks", () => {
    const m = legendModel({ title: "Speed", unit: "m/s", min: 2, max: 3, stops: ["#000000", "#808080", "#ffffff"] }, "Streamlines");
    expect(m.label).toBe("Streamlines · Speed (m/s)");
    expect(m.gradient).toBe("linear-gradient(to right, #000000 0.0%, #808080 50.0%, #ffffff 100.0%)");
    expect(m.ticks).toEqual([{ at: 0, text: "2" }, { at: 0.5, text: "2.5" }, { at: 1, text: "3" }]);
    expect(legendModel({ title: "Pressure coefficient Cp", unit: "", min: -0.6, max: 0.6, stops: ["#000000", "#ffffff"] }, "Slice").ticks.map((t) => t.text)).toEqual(["−0.6", "0", "0.6"]);
    // without noise: a middle of −0.0001 reads 0, the ends round to two places
    expect(legendModel({ title: "T", unit: "", min: -2.468, max: 2.4678, stops: ["#000000", "#ffffff"] }, "S").ticks.map((t) => t.text)).toEqual(["−2.47", "0", "2.47"]);
  });

  it("shows the colours a colour override actually draws (multiplied in linear light)", () => {
    expect(tintStop("#ffffff", "#4e5b73")).toBe("#4e5b73");
    expect(tintStop("#000000", "#4e5b73")).toBe("#000000");
    expect(tintStop("#3b4cc0", "#ffffff")).toBe("#3b4cc0");
    // multiplied in linear light (0.216² → #3d3d3d), not in sRGB (0.502² → #404040)
    expect(tintStop("#808080", "#808080")).toBe("#3d3d3d");
    const m = legendModel({ title: "Cp", unit: "", min: -1, max: 1, stops: ["#3b4cc0", "#dddddd", "#b40426"] }, "Slice", "#4e5b73");
    expect(m.tinted).toBe(true);
    expect(m.gradient).toBe(`linear-gradient(to right, ${tintStop("#3b4cc0", "#4e5b73")} 0.0%, ${tintStop("#dddddd", "#4e5b73")} 50.0%, ${tintStop("#b40426", "#4e5b73")} 100.0%)`);
    expect(legendModel({ title: "Cp", unit: "", min: -1, max: 1, stops: ["#000000", "#ffffff"] }, "Slice", null).tinted).toBe(false);
  });

  it("rejects legends it can't draw safely", () => {
    expect(sanitizeLegend(null)).toBe(null);
    expect(sanitizeLegend({ min: 1, max: 1, stops: ["#000000", "#ffffff"] })).toBe(null);
    expect(sanitizeLegend({ min: 0, max: 1, stops: ["red", "url(x)"] })).toBe(null);
    const ok = sanitizeLegend({ title: "T", min: "0", max: 2, stops: ["#000000", "javascript:1", "#FFFFFF"] });
    expect(ok).toEqual({ title: "T", unit: "", min: 0, max: 2, stops: ["#000000", "#FFFFFF"] });
  });

  it("makes a card for each shown object with a legend, in scene order", () => {
    const objects = { a: object({ name: "A" }), b: object({ name: "B", visible: false }), c: object({ name: "C", group: "g" }), g: group({ visible: false }), d: object({ name: "D" }) };
    const scene = { objects, ids: ["d", "a", "b", "c", "g"], parents: new Map(), groups: new Map([["c", "g"]]) };
    const out = legendCards(scene, (id) => (id === "d" ? null : LEGEND), (id) => `seen ${id}`);
    expect(out.map((c) => c.id)).toEqual(["a"]);
    expect(out[0].model.label).toBe("seen a · Speed (m/s)");
  });
});

describe("scene.legends", () => {
  it("draws a colour-bar card in the overlay for an object whose content has a legend", async () => {
    const s = await mount({ objects: { a: object({ name: "Streamlines" }), b: object({ name: "Plain" }) }, order: ["a", "b"] }, { a: LEGEND, b: { min: 0, max: 0, stops: [] } });
    const [card, ...rest] = cards(s);
    expect(rest).toEqual([]);
    expect(card.dataset.objectId).toBe("a");
    expect(card.querySelector(".legend-label").textContent).toBe("Streamlines · Speed (m/s)");
    expect(card.querySelector(".legend-bar").style.background).toContain("linear-gradient");
    expect([...card.querySelectorAll(".legend-ticks span")].map((e) => e.textContent)).toEqual(["2", "2.5", "3"]);
    expect(card.hasAttribute("data-tinted")).toBe(false);
    s.unmount();
  });
});
