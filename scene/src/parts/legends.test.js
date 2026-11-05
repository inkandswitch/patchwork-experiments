import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import legends, { legendCards, sanitizeLegend } from "./legends.js";

const LEGEND = { title: "Speed", unit: "m/s", min: 2, max: 3, stops: ["#000000", "#808080", "#ffffff"] };
const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

async function mount(doc, legendsById = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.legends" }, module: legends }], doc });
  // no WebGL here: what the stage would say each object's GLB carries
  s.api("scene.legends").content = (id) => (legendsById[id] ? { loaded: true, box: null, extras: { legend: legendsById[id] }, stats: null } : null);
  s.change((d) => (d.title = "content arrived"));
  await s.settle();
  return s;
}
const cards = (s) => [...s.root.querySelectorAll(".stage-overlay > .legends > .legend")];

describe("scene.legends (pure)", () => {
  it("rejects legends it can't draw safely (the old sanitizeLegend)", () => {
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

  it("notes a tint, and drops the card when the object is hidden", async () => {
    const s = await mount({ objects: { a: object({ name: "Slice", color: "#4e5b73" }) }, order: ["a"] }, { a: LEGEND });
    const card = cards(s)[0];
    expect(card.hasAttribute("data-tinted")).toBe(true);
    expect(card.querySelector(".legend-tint").title).toContain("#4e5b73");
    s.change((d) => (d.objects.a.visible = false));
    await s.settle();
    expect(cards(s)).toEqual([]);
    s.unmount();
  });

  it("keeps its cards across a hover", async () => {
    const s = await mount({ objects: { a: object({ name: "A" }) }, order: ["a"] }, { a: LEGEND });
    const card = cards(s)[0];
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await s.settle();
    expect(cards(s)[0]).toBe(card);
    s.unmount();
  });
});
