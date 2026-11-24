// @vitest-environment happy-dom
// A view tells the host which linked docs it shows live (./announce.js), so
// the providers around it treat them as its own: a draft clones them and a
// history checkpoint pins them with the scene. Over every shape of link —
// alone, linked, linked twice, pinned, two deep — exactly the docs shown live
// are announced (a doc linked twice once; a pin's not at all, it keeps its
// own version), a link taken away retracts its doc, and unmounting retracts all.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import { TOOL_ID } from "./announce.js";

const ME = "automerge:ana";
let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
});

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

/** Mount a view of `handle`, recording what it announces: url → mounted minus unmounted, and every event. */
async function view(repo, handle) {
  const { default: Stage } = await import("./stage.js");
  const el = document.createElement("div");
  el.repo = repo;
  el.viewerId = ME;
  el.packageSettleMs = 0;
  const net = new Map();
  const events = [];
  el.addEventListener("patchwork:mounted", (e) => {
    events.push(e.detail);
    net.set(e.detail.url, (net.get(e.detail.url) ?? 0) + 1);
  });
  el.addEventListener("patchwork:unmounted", (e) => {
    events.push(e.detail);
    net.set(e.detail.url, (net.get(e.detail.url) ?? 0) - 1);
  });
  document.body.append(el);
  let unmount = Stage(handle, el);
  const stop = () => {
    unmount?.();
    unmount = null;
  };
  cleanups.push(() => {
    stop();
    el.remove();
  });
  await settle();
  const announced = () => [...net].filter(([, n]) => n !== 0).map(([url, n]) => (n === 1 ? url : `${url}×${n}`)).sort();
  return { v: el.querySelector(".scene-stage").__sceneDebug.view, announced, events, stop };
}

describe("a view announces the linked docs it shows live", () => {
  for (const shape of ["alone", "linked", "linked twice", "pinned", "two deep"])
    it(shape, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const repo = new FakeRepo();
      // (registers the scene's plugins)
      const s = await mountStage({ repo, viewerId: ME, doc: { objects: {}, order: [] } });
      cleanups.push(() => s.unmount());
      const G = repo.add(emptyScene({ title: "G" }));
      const X = repo.add(emptyScene({ title: "X", objects: { L: link(G.url) }, order: ["L"] }));
      const objects =
        shape === "alone"
          ? {}
          : shape === "linked"
            ? { L: link(G.url) }
            : shape === "linked twice"
              ? { L: link(G.url), M: link(G.url, { transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 } }) }
              : shape === "pinned"
                ? { P: link(G.url, { at: { heads: G.heads() } }) }
                : { LX: link(X.url) };
      const H = repo.add(emptyScene({ title: "H", objects, order: Object.keys(objects) }));
      const { v, announced, events, stop } = await view(repo, H);
      // (linked twice: the second link is closed, a repeat, with no stage)
      const stages = shape === "alone" ? 1 : shape === "linked" || shape === "pinned" || shape === "linked twice" ? 2 : 3;
      await until(() => v.stages().length === stages, 4000);
      await settle();

      const want = shape === "alone" || shape === "pinned" ? [] : shape === "two deep" ? [G.url, X.url].sort() : [G.url];
      expect(announced()).toEqual(want);
      for (const e of events) expect(e.toolId).toBe(TOOL_ID);

      // a link taken away retracts its doc
      if (shape === "linked") {
        H.change((d) => {
          delete d.objects.L;
          d.order = [];
        });
        await until(() => v.stages().length === 1, 4000);
        await settle();
        expect(announced()).toEqual([]);
      }

      // unmounting retracts everything
      stop();
      expect(announced()).toEqual([]);
    });
});
