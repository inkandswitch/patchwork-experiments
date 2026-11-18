// View plugins (STAGE.md, "View plugins"): one per view, for the view's whole
// life, whatever the focus. api.focus() is the focus stage's api for it:
// what it acquires through that goes when the focus leaves.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { editing } from "./bodies.js";
import { keyOf } from "./paths.js";

const T = { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 };

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

/** A host A (a table, and L: a live link to B) and one view plugin, which counts its starts and stops. */
async function mountHost({ time = null, create = () => ({}) } = {}) {
  const repo = new FakeRepo();
  const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
  const counts = { creates: 0, disposes: 0 };
  const plugin = {
    meta: { id: "t.view", type: "scene:view" },
    module: {
      create: (api) => (counts.creates++, { commands: [{ id: "c", name: "C", run() {} }], ...create(api), dispose: () => counts.disposes++ }),
    },
  };
  const objects = { table: object({ name: "Table" }), L: object({ name: "B", sourceUrl: b.url, providerId: LINK, renderUrl: null }) };
  s = await mountStage({ repo, time, extensions: [plugin], doc: { title: "A", objects, order: Object.keys(objects) } });
  const view = s.debug.view;
  await until(() => view.stageAt(["L"]) && s.instance("t.view"), 2000);
  return { view, counts, api: s.api("t.view") };
}

describe("view plugins", () => {
  // Over every sequence of up to four events (the focus in at A, out to B, a
  // pose held through A's facet, let go): 341 sequences, on one view. After
  // every event: the plugin started once and never stopped; A's facet lives
  // until the focus leaves A, held or not, and coming back makes a new one;
  // the view offers the plugin's command once, from the focus, and A's
  // reader never does.
  it("over every order of ≤4 of in, out, busy and idle: started once, never stopped; a facet lives until the focus leaves", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const EVENTS = ["in", "out", "busy", "idle"];
    const seqs = [[]];
    for (let n = 1; n <= 4; n++) for (const s0 of seqs.filter((q) => q.length === n - 1)) for (const e of EVENTS) seqs.push([...s0, e]);
    expect(seqs.length).toBe(341);
    const { view, counts, api } = await mountHost();
    const A = view.stage(0);
    for (const seq of seqs) {
      view.focusOn([]);
      let fa = api.focus();
      fa.pose.release("table");
      let alive = true;
      const where = seq.join(",") || "(none)";
      for (const e of seq) {
        if (e === "in") {
          view.focusOn([]);
          const f = api.focus();
          expect([where, e, f === fa]).toEqual([where, e, alive]);
          fa = f;
          alive = true;
        } else if (e === "out") {
          view.focusOn(["L"]);
          alive = false;
        } else if (e === "busy") {
          // (a facet given back holds nothing)
          expect([where, e, fa.pose.hold("table", T)]).toEqual([where, e, alive]);
        } else fa.pose.release("table");
        expect([where, e, counts.creates, counts.disposes]).toEqual([where, e, 1, 0]);
        expect([where, e, !fa.signal.aborted, A.debug.facets()]).toEqual([where, e, alive, alive ? ["t.view"] : []]);
        expect([where, e, A.reader.collect("commands").some((x) => x.id === "t.view")]).toEqual([where, e, false]);
        expect([where, e, view.collect("commands").filter((x) => x.id === "t.view").map((x) => x.stage)]).toEqual([where, e, [view.focusStage().n]]);
      }
    }
  }, 120_000);

  it("what it acquired through a facet goes with the focus; its own chrome, its tab and the editor in hand stay; uninstalled, everything goes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const panel = document.createElement("div");
    const { view, counts, api } = await mountHost({
      create: (a) => {
        a.overlay().className += " t-overlay";
        a.use("drawer").dock(panel, { title: "T" });
        return {};
      },
    });
    const layersAt = (st) => view.viewport.layers.get(keyOf(st.n, "t.view"))?.size ?? 0;
    s.edit(true);
    const A = view.stage(0);
    api.focus().world();
    expect(layersAt(A)).toBe(1);
    expect(view.focusOn(["L"])).toBe(true);
    const B = view.stageAt(["L"]);
    api.focus().world();
    // A's layer went with the focus; B's is B's
    expect([layersAt(A), layersAt(B)]).toEqual([0, 1]);
    // the view's: its overlay, its tab, the editor in hand
    expect(view.root.querySelectorAll(".t-overlay").length).toBe(1);
    expect(view.plugins.instanceOf("scene.drawer").panes().order.length).toBe(1);
    expect(editing(view.atom.get())).toBe(true);
    expect(view.leave()).toBe(true);
    expect([layersAt(A), layersAt(B), editing(view.atom.get())]).toEqual([0, 0, true]);
    expect(counts).toEqual({ creates: 1, disposes: 0 });
    await s.uninstall("t.view");
    expect(counts).toEqual({ creates: 1, disposes: 1 });
    expect(view.root.querySelectorAll(".t-overlay").length).toBe(0);
    expect(view.plugins.instanceOf("scene.drawer").panes().order.length).toBe(0);
    expect(A.debug.facets()).toEqual([]);
  });
});
