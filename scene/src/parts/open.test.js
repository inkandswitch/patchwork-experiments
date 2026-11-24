// @vitest-environment happy-dom
// Open (./open.js; PLANS.md §5): the target's Open is the first `open: true`
// command that applies; the Edit hand Opens the selection on a double-click
// (same thing, within DOUBLE_MS and DOUBLE_PX), in Edit only; an Open's key
// (Enter) reaches it through the key map; the menu lists it after Select.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, wallAt } from "../test/stage-harness.js";
import { openFor } from "./open.js";
import { DOUBLE_MS, DOUBLE_PX } from "./edit.js";
import { menuEntries } from "./menu.js";
import select from "./select.js";
import keys from "./keys.js";

const cmd = (id, o = {}) => ({ id, name: id, run: () => {}, state: () => ({}), ...o });

describe("openFor: the target's Open", () => {
  it("is the first `open: true` command that applies, in running order; none for the scene, a disabled one, or none at all", () => {
    const collected = [
      { id: "t.a", value: [cmd("plain"), cmd("go", { open: true, state: (t) => (t === "x" ? { label: "Go in" } : null) })] },
      { id: "t.b", value: [cmd("edit", { open: true, state: (t) => (t === "y" ? {} : null) })] },
      { id: "t.c", value: [cmd("edit-too", { open: true })] },
    ];
    expect(openFor(collected, "x", {})).toMatchObject({ ext: "t.a", command: { id: "go" }, state: { label: "Go in" } });
    expect(openFor(collected, "y", {})).toMatchObject({ ext: "t.b", command: { id: "edit" } });
    expect(openFor(collected, "z", {})).toMatchObject({ ext: "t.c", command: { id: "edit-too" } });
    expect(openFor(collected, null, {})).toBe(null);
    expect(openFor([{ id: "t.a", value: [cmd("plain")] }], "x", {})).toBe(null);
    // the one that applies is disabled (a link not open here): no Open, not the next one
    expect(openFor([{ id: "t.a", value: [cmd("go", { open: true, state: () => ({ disabled: true }) })] }, ...collected], "x", {})).toBe(null);
    // one that throws doesn't apply
    expect(openFor([{ id: "t.a", value: [cmd("go", { open: true, state: () => { throw new Error("x"); } })] }, ...collected], "x", {})).toMatchObject({ ext: "t.a", command: { id: "go" } });
  });

  it("is listed in the menu right after Select, ahead of the rest", () => {
    const collected = [
      { id: "t.a", value: [cmd("frame", { show: ["menu"] }), cmd("go", { open: true, show: ["menu"] })] },
      { id: "scene.select", value: [cmd("select", { show: ["menu"] })] },
    ];
    expect(menuEntries(collected, "x", {}).forObject.map((e) => e.command.id)).toEqual(["select", "go", "frame"]);
  });
});

describe("the Edit hand Opens", () => {
  let s = null;
  let clock = 1000;
  const runs = [];
  const OPENER = {
    meta: { id: "t.opener", type: "scene:view" },
    module: { create: () => ({ commands: [cmd("open-it", { name: "Open", open: true, key: "Enter", hand: "edit", show: ["menu", "inspector"], state: (t) => (t === "a" || t === "b" ? {} : null), run: (t) => runs.push(t) })] }) },
  };
  afterEach(() => {
    s?.unmount();
    s = null;
    runs.length = 0;
  });
  async function mount() {
    clock = 1000;
    s = await mountStage({ time: wallAt(() => clock), extensions: [{ meta: { id: "scene.select" }, module: select }, { meta: { id: "scene.keys" }, module: keys }, OPENER], doc: { objects: { a: object({ name: "A" }), b: object({ name: "B" }) }, order: ["a", "b"] } });
    s.edit(true);
    await settle();
  }
  const hitOn = (id) => {
    s.debug.viewport.pick = () => (id ? { id, point: [0, 0, 0], normal: [0, 1, 0], distance: 1 } : null);
  };
  const click = async (x, y, after = 0) => {
    clock += after;
    s.click(x, y);
    await settle();
  };

  it("on a double-click: the same thing, near enough and soon enough; never on one click, a slow second, a far one or another thing", async () => {
    await mount();
    hitOn("a");
    await click(20, 20);
    expect([s.local.get().selected, runs]).toEqual(["a", []]);
    await click(20, 20, DOUBLE_MS);
    expect(runs).toEqual(["a"]);
    // a third click starts again: it isn't a second double
    await click(20, 20, 10);
    expect(runs).toEqual(["a"]);
    // too slow
    await click(20, 20, DOUBLE_MS + 1);
    expect(runs).toEqual(["a"]);
    // too far
    await click(20 + DOUBLE_PX + 1, 20, 10);
    expect(runs).toEqual(["a"]);
    // another thing between
    await click(20, 20, 400);
    hitOn("b");
    await click(20, 20, 10);
    expect([s.local.get().selected, runs]).toEqual(["b", ["a"]]);
    await click(20, 20, 10);
    expect(runs).toEqual(["a", "b"]);
  });

  it("its key, Enter, opens the selection; with nothing selected, nothing", async () => {
    await mount();
    s.key("Enter", { code: "Enter" });
    await settle();
    expect(runs).toEqual([]);
    hitOn("b");
    await click(20, 20);
    s.key("Enter", { code: "Enter" });
    await settle();
    expect(runs).toEqual(["b"]);
  });

  it("only in Edit: without the editor a double-click opens nothing, nor Enter for an Open that is the editor's", async () => {
    await mount();
    s.edit(false);
    await settle();
    hitOn("a");
    await click(20, 20);
    await click(20, 20, 10);
    s.key("Enter", { code: "Enter" });
    await settle();
    expect(runs).toEqual([]);
  });
});
