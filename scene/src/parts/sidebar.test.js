import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { PLAY, mountStage, object } from "../test/stage-harness.js";
import sidebar, { isFolded } from "./sidebar.js";
import keys from "./keys.js";

/** An extension contributing panels, recording what the sidebar asked of them. */
function panelsExt(ids, calls) {
  return {
    create() {
      return {
        panels: ids.map((id) => ({
          id,
          title: id === "objects" ? "Objects" : id,
          pinned: id === "inspector",
          mount(el, { head }) {
            calls.mounted.push(id);
            el.textContent = `${id} here`;
            if (id === "objects") {
              const b = document.createElement("button");
              b.className = "new-group";
              head.append(b);
            }
            return {
              update(scene, local) {
                calls.updates.push(id);
                calls.last = { scene, local };
                // the inspector shows only with a selection
                if (id === "inspector") el.hidden = local.selected == null;
              },
              dispose: () => calls.disposed.push(id),
            };
          },
        })),
      };
    },
  };
}

describe("folding (pure)", () => {
  it("open unless the viewer folded it; a pinned panel never folds", () => {
    expect(isFolded("objects", new Map())).toBe(false);
    expect(isFolded("objects", new Map([["objects", true]]))).toBe(true);
    expect(isFolded("objects", new Map([["objects", false]]))).toBe(false);
    expect(isFolded("inspector", new Map([["inspector", true]]), true)).toBe(false); // pinned
  });
});

describe("scene.sidebar", () => {
  let s, calls;
  const mount = async (view = {}, again = null) => {
    calls = { mounted: [], updates: [], disposed: [], last: null };
    s = await mountStage({
      ...(again ? { repo: again.repo, handle: again.handle } : {}),
      extensions: [
        { meta: { id: "scene.sidebar", activities: ["edit"] }, module: sidebar },
        { meta: { id: "scene.keys" }, module: keys },
        {
          meta: { id: "t.core", activities: ["edit"] },
          module: panelsExt(["objects", "inspector", "dimensions"], calls),
        },
        {
          meta: { id: "t.table", traits: ["test.flag"] },
          module: panelsExt(["test.table"], calls),
        },
        PLAY,
      ],
      doc: {
        objects: { a: object({ traits: { "test.flag": {} } }) },
        order: ["a"],
        view,
      },
    });
  };
  beforeEach(() => localStorage.clear());
  afterEach(() => s?.unmount());

  const sections = () => [...s.root.querySelectorAll(".sidebar > [data-panel]")];
  const section = (id) => s.root.querySelector(`.sidebar > [data-panel="${id}"]`);

  it("orders panels by running order, all open; folding is the viewer's and remembered", async () => {
    // a doc's view.panels is not read
    await mount({ panels: ["inspector"] });
    expect(sections().map((x) => x.dataset.panel)).toEqual(["test.table", "objects", "inspector", "dimensions"]);
    expect(sections().some((x) => x.hasAttribute("data-folded"))).toBe(false);
    expect(section("test.table").textContent).toContain("test.table here");
    // the panel's head is its own to add to
    expect(section("objects").querySelector(".panel-head .new-group")).toBeTruthy();
    section("objects").querySelector("[data-collapse]").click();
    expect(section("objects").hasAttribute("data-folded")).toBe(true);
    expect(JSON.parse(localStorage.getItem(`scene-panels:${s.handle.url}`))).toEqual({ objects: true });
    // and it's remembered
    s.unmount();
    await mount({}, s);
    expect(section("objects").hasAttribute("data-folded")).toBe(true);
  }, 30_000);

  it("never folds the inspector, which hides itself without a selection", async () => {
    await mount();
    expect(section("inspector").querySelector("[data-collapse]")).toBeNull();
    expect(section("inspector").hidden).toBe(true);
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await s.settle();
    expect(section("inspector").hidden).toBe(false);
  }, 30_000);

  it("updates each mounted panel every flush, with the scene and local state", async () => {
    await mount();
    const n = calls.updates.length;
    expect(n).toBeGreaterThan(0);
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await s.settle();
    expect(calls.updates.length).toBeGreaterThan(n);
    expect(calls.last.local.hovered).toBe("a");
    expect(calls.last.scene.objects.a).toBeTruthy();
  }, 30_000);

  it("mounts and disposes panels as their extensions come and go", async () => {
    await mount();
    // running order: the scene-scope extension first, then the general ones
    expect(calls.mounted).toEqual(["test.table", "objects", "inspector", "dimensions"]);
    await s.activity("play");
    expect(calls.disposed).toEqual(expect.arrayContaining(["objects", "inspector", "dimensions"]));
    expect(s.root.querySelector(".sidebar")).toBeNull();
  }, 30_000);

  it("Panel (P) hides and shows the sidebar, as this viewer's pref", async () => {
    await mount();
    const run = () => s.api("scene.sidebar").run({ ext: "scene.sidebar", command: "panel", target: null });
    expect(s.instance("scene.sidebar").commands[0].state(null, {})).toMatchObject({ checked: true });
    expect(s.instance("scene.sidebar").commands[0].state("a", {})).toBeNull();
    expect(run()).toBe(true);
    await s.settle();
    expect(s.local.get().prefs["scene.sidebar.hidden"]).toBe(true);
    expect(s.doc().view["scene.sidebar.hidden"]).toBeUndefined();
    const edgePart = s.root.querySelector('.stage-edge[data-edge="right"] > .stage-edge-part');
    expect(edgePart.hidden).toBe(true);
    s.key("p");
    await s.settle();
    expect(s.local.get().prefs["scene.sidebar.hidden"]).toBe(false);
    expect(edgePart.hidden).toBe(false);
  }, 30_000);
});
