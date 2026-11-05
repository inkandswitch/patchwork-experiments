import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import kits, { toggleKit } from "./kits.js";

describe("toggleKit (pure)", () => {
  const doc = { view: { kits: ["model"] } };
  it("writes the smallest change to the doc's suggestion", () => {
    expect(toggleKit(null, doc, "table", true)).toEqual({
      on: ["table"],
      off: [],
    });
    expect(toggleKit({ on: ["table"], off: [] }, doc, "model", false)).toEqual({
      on: ["table"],
      off: ["model"],
    });
    expect(toggleKit({ on: ["table"], off: ["model"] }, doc, "model", true)).toEqual({ on: ["table"], off: [] });
    expect(toggleKit({ on: ["table"], off: [] }, doc, "table", false)).toEqual({
      on: [],
      off: [],
    });
    // no doc list: the suggestion is ["model"]
    expect(toggleKit(null, {}, "model", false)).toEqual({
      on: [],
      off: ["model"],
    });
  });
});

describe("scene.kits", () => {
  let s;
  beforeEach(async () => {
    localStorage.clear();
    const plain = { create: () => ({}) };
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.kits", always: true }, module: kits },
        { meta: { id: "t.edit" }, module: plain },
        { meta: { id: "t.table" }, module: plain },
      ],
      kits: [
        { id: "model", name: "Modelling", extensions: ["t.edit"] },
        { id: "table", name: "Table layout", extensions: ["t.table"] },
      ],
      doc: { objects: { a: object() }, order: ["a"] },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  const running = () => s.local.get().running.map((r) => r.id);
  const box = (id) => s.root.querySelector(`.kits-pop input[data-kit="${id}"]`);
  const openList = async () => {
    s.root.querySelector(".kits-button").click();
    await s.settle();
  };

  it("lists every kit, checked as this viewer has them", async () => {
    expect(running()).toEqual(["t.edit", "scene.kits"]);
    expect(s.root.querySelector(".kits-pop").hidden).toBe(true);
    await openList();
    expect(s.root.querySelector(".kits-pop").hidden).toBe(false);
    expect(box("model").checked).toBe(true);
    expect(box("table").checked).toBe(false);
    expect(s.root.querySelector(".kits-suggest").disabled).toBe(true);
  });

  it("turning kits on and off is this viewer's change to the suggestion", async () => {
    await openList();
    box("table").checked = true;
    box("table").dispatchEvent(new Event("change"));
    await s.settle();
    expect(s.local.get().kits).toEqual({ on: ["table"], off: [] });
    expect(running()).toEqual(["t.edit", "t.table", "scene.kits"]);
    box("model").checked = false;
    box("model").dispatchEvent(new Event("change"));
    await s.settle();
    expect(s.local.get().kits).toEqual({ on: ["table"], off: ["model"] });
    expect(running()).toEqual(["t.table", "scene.kits"]);
    expect(s.doc().view.kits).toBeUndefined();
    expect(box("model").checked).toBe(false);
  });

  it("suggests this viewer's kits to everyone", async () => {
    await openList();
    box("table").checked = true;
    box("table").dispatchEvent(new Event("change"));
    await s.settle();
    const suggest = s.root.querySelector(".kits-suggest");
    expect(suggest.disabled).toBe(false);
    suggest.click();
    await s.settle();
    expect(s.doc().view.kits).toEqual(["model", "table"]);
    expect(s.local.get().kits).toEqual({ on: [], off: [] });
    expect(running()).toEqual(["t.edit", "t.table", "scene.kits"]);
    expect(s.root.querySelector(".kits-suggest").disabled).toBe(true);
  });

  it("closes on Escape or a click outside", async () => {
    await openList();
    box("model").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(s.root.querySelector(".kits-pop").hidden).toBe(true);
    await openList();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(s.root.querySelector(".kits-pop").hidden).toBe(true);
  });
});
