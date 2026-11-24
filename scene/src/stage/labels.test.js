// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { LabelLayer } from "./labels.js";

const items = (layer, owner) => [...(layer.groups.get(owner)?.values() ?? [])];
/** Give every label a fixed size (happy-dom lays nothing out). */
const sized = (layer, w = 40, h = 14) => {
  for (const entries of layer.groups.values())
    for (const e of entries.values()) {
      Object.defineProperty(e.el, "offsetWidth", { value: w, configurable: true });
      Object.defineProperty(e.el, "offsetHeight", { value: h, configurable: true });
    }
};

describe("LabelLayer", () => {
  it("keeps each owner's labels apart, keyed within the owner, and keeps a key's element across syncs", () => {
    const onChange = vi.fn();
    const layer = new LabelLayer(document.createElement("div"), onChange);
    layer.sync("measure", [{ key: "a", text: "1 m", position: [0, 0, 0] }, { key: "b", text: "2 m", position: [1, 0, 0] }, { text: "no key" }]);
    layer.sync("grid", [{ key: "a", text: "x", position: [0, 0, 0] }]);
    expect(layer.el.querySelectorAll(".label")).toHaveLength(3);
    expect(onChange).toHaveBeenCalledTimes(2);
    const el = items(layer, "measure")[0].el;
    layer.sync("measure", [{ key: "a", text: "1.5 m", position: [0, 0, 0] }]);
    expect(items(layer, "measure")[0].el).toBe(el);
    expect(el.textContent).toBe("1.5 m");
    expect(layer.el.querySelectorAll(".label")).toHaveLength(2);
    // clearing one owner leaves the other's
    layer.clear("measure");
    expect(layer.groups.has("measure")).toBe(false);
    expect(layer.el.querySelectorAll(".label")).toHaveLength(1);
    expect(items(layer, "grid")[0].el.textContent).toBe("x");
  });

  it("places a label at its point (in its owner's frame), at a screen point, or where its place says, with a leader", () => {
    const layer = new LabelLayer(document.createElement("div"));
    const place = vi.fn(({ project, w, h }) => {
      const p = project([2, 3, 0]);
      return { x: p.x + w, y: p.y + h, leader: { x: p.x, y: p.y } };
    });
    layer.sync("o", [
      { key: "p", text: "p", position: [1, 2, 3] },
      { key: "s", text: "s", screen: { x: 10, y: 20 } },
      { key: "q", text: "q", place },
    ]);
    // the frame moves everything by +1 in x before it's projected (screen points excepted)
    layer.sync("f", [{ key: "p", text: "f", position: [1, 2, 3] }], () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
    sized(layer);
    layer.update((v) => ({ x: v.x * 10, y: v.y * 10 }));
    const [p, s, q] = items(layer, "o").map((e) => e.el.style.transform);
    expect(p).toBe("translate(10px, 20px) translate(-50%, -50%)");
    expect(s).toBe("translate(10px, 20px) translate(-50%, -50%)");
    expect(q).toBe("translate(60px, 44px) translate(-50%, -50%)");
    expect(items(layer, "f")[0].el.style.transform).toBe("translate(20px, 20px) translate(-50%, -50%)");
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ w: 40, h: 14 }));
    const leader = layer.el.querySelector(".label-leader");
    expect(leader.style.display).toBe("");
    expect(leader.style.width).toBe(`${Math.hypot(40, 14).toFixed(1)}px`);
    // a place with no leader hides it; one that says nowhere hides the label
    place.mockImplementation(() => ({ x: 1, y: 1 }));
    layer.update((v) => ({ x: v.x, y: v.y }));
    expect(leader.style.display).toBe("none");
    place.mockImplementation(() => null);
    layer.update((v) => ({ x: v.x, y: v.y }));
    expect(items(layer, "o")[2].el.style.display).toBe("none");
  });

  it("a placed label coming back from hidden is measured shown, so it's placed by its real size", () => {
    const layer = new LabelLayer(document.createElement("div"));
    let where = null;
    const place = vi.fn(({ w }) => (where ? { x: where.x + w, y: where.y } : null));
    layer.sync("o", [{ key: "q", text: "q", place }]);
    const el = items(layer, "o")[0].el;
    // as a browser does: a label not displayed has no size
    Object.defineProperty(el, "offsetWidth", { get: () => (el.style.display === "none" ? 0 : 40) });
    Object.defineProperty(el, "offsetHeight", { get: () => (el.style.display === "none" ? 0 : 14) });
    layer.update(() => ({ x: 0, y: 0 }));
    expect(el.style.display).toBe("none");
    where = { x: 100, y: 50 };
    layer.update(() => ({ x: 0, y: 0 }));
    expect(el.style.transform).toBe("translate(140px, 50px) translate(-50%, -50%)");
  });

  it("an item that follows something is placed where its at() says each time, and hidden while it says nowhere", () => {
    const layer = new LabelLayer(document.createElement("div"));
    let p = [1, 2, 0];
    layer.sync("o", [{ key: "k", text: "t", at: () => p, position: [9, 9, 9] }]);
    const el = items(layer, "o")[0].el;
    const place = () => (layer.update((v) => ({ x: v.x * 10, y: v.y * 10 })), el.style.display === "none" ? null : el.style.transform);
    expect(place()).toBe("translate(10px, 20px) translate(-50%, -50%)");
    p = [3, 4, 0];
    expect(place()).toBe("translate(30px, 40px) translate(-50%, -50%)");
    p = null;
    expect(place()).toBe(null);
  });

  it("hides what it can't place, and an owner's labels while it says they aren't shown", () => {
    const layer = new LabelLayer(document.createElement("div"));
    let shown = true;
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0] }], null, () => shown);
    const el = items(layer, "o")[0].el;
    layer.update(() => ({ x: 1, y: 1 }));
    expect(el.style.display).toBe("");
    layer.update(() => null);
    expect(el.style.display).toBe("none");
    shown = false;
    layer.update(() => ({ x: 1, y: 1 }));
    expect(el.style.display).toBe("none");
  });

  it("writes data attributes and drops those that went away", () => {
    const layer = new LabelLayer(document.createElement("div"));
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], data: { axis: "x", selected: true } }]);
    const el = items(layer, "o")[0].el;
    expect(el.getAttribute("data-axis")).toBe("x");
    expect(el.hasAttribute("data-selected")).toBe(true);
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], data: { selected: false } }]);
    expect(el.hasAttribute("data-axis")).toBe(false);
    expect(el.hasAttribute("data-selected")).toBe(false);
  });

  it("calls onPointerDown without letting the press through", () => {
    const layer = new LabelLayer(document.createElement("div"));
    const down = vi.fn();
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], onPointerDown: down }]);
    const ev = new Event("pointerdown", { bubbles: true });
    const stop = vi.spyOn(ev, "stopPropagation");
    items(layer, "o")[0].el.dispatchEvent(ev);
    expect(down).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
  });

  it("declutters every owner's labels together, by their own rank (1 when they don't say), never hiding rank 2 and up", () => {
    const layer = new LabelLayer(document.createElement("div"));
    layer.sync("grid", [{ key: "g", text: "grid", position: [0, 0, 0], rank: 1.5 }]);
    layer.sync("bounds", [{ key: "b", text: "bounds", position: [0, 0, 0] }]);
    layer.sync("axes", [{ key: "x", text: "X", position: [0, 0, 0], rank: 2 }, { key: "y", text: "Y", position: [0, 0, 0], rank: 2 }]);
    sized(layer);
    layer.update(() => ({ x: 100, y: 100 }));
    const vis = (owner, i = 0) => items(layer, owner)[i].el.style.visibility;
    expect([vis("axes", 0), vis("axes", 1), vis("grid"), vis("bounds")]).toEqual(["", "", "hidden", "hidden"]);
  });
});
