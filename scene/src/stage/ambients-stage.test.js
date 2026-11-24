// @vitest-environment happy-dom
// One world's ambients (W2), and the atmosphere through them (W9): every
// stage's api.ambient(name) is the outermost stage's stacked value or null,
// `mine` exactly at the outermost. Here, a pinned link, whatever the host
// offers (nothing, one extension, two in their running order): nothing the
// pinned doc offers reaches its host, and the viewport's atmosphere is the
// outermost's. (No body or focus: `ambient` reads neither; placement.test.js
// has body × ambient.)

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";

const ME = "automerge:ana";

// two offering extensions, each by its own trait, so a doc chooses which run;
// each offers the name "x" (its id and the doc's title, so a leak shows whose)
// and an atmosphere of its own
const offering = (id) => ({
  meta: { id, traits: [id] },
  module: {
    create: (api) => ({
      ambient: () => ({ x: { by: id, doc: api.doc().title }, atmosphere: { sky: { top: id === "t.a" ? "#111111" : "#222222" } } }),
      // what it reads, kept for the test
      read: (name) => api.ambient(name),
    }),
  },
});
const EXTENSIONS = [offering("t.a"), offering("t.b")];

/** What a doc offers: nothing, one extension, or both (in whatever running order the stage starts them; a and b are alike). */
const OFFERS = { none: {}, a: { "t.a": {} }, both: { "t.a": {}, "t.b": {} } };

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

async function view(repo, handle) {
  const { default: Stage } = await import("./stage.js");
  const el = document.createElement("div");
  el.repo = repo;
  el.viewerId = ME;
  el.packageSettleMs = 0;
  document.body.append(el);
  const unmount = Stage(handle, el);
  cleanups.push(() => {
    unmount();
    el.remove();
  });
  await settle();
  return el.querySelector(".scene-stage").__sceneDebug.view;
}

/** The value the outermost stage stacks under "x": its last running offering extension's. */
function expected(world) {
  const running = world.debug.host.running().map((r) => r.id).filter((id) => id === "t.a" || id === "t.b");
  return running.length ? { by: running.at(-1), doc: world.doc().title } : null;
}

// I13: every api.ambient(name) is the outermost's stacked value, `mine` only at the outermost
describe("one world's ambients (W2): the outermost's, everywhere in the view", () => {
  // (alone, linked and two deep, with every body and focus: placement.test.js's ambient reads; the stack: ambients.test.js)
  for (const [hostOffers, hostTraits] of Object.entries(OFFERS))
    it(`pinned, the outermost offering ${hostOffers}; the pinned doc offering both`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const repo = new FakeRepo();
      const s = await mountStage({ repo, viewerId: ME, extensions: EXTENSIONS, doc: { objects: {}, order: [] } });
      cleanups.push(() => s.unmount());
      const G = repo.add(emptyScene({ title: "G", traits: OFFERS.both }));
      const H = repo.add(emptyScene({ title: "H", traits: hostTraits, objects: { P: link(G.url, { at: { heads: G.heads() } }) }, order: ["P"] }));
      const v = await view(repo, H);
      const ready = (st) => !Object.keys(st.doc().traits ?? {}).length || st.debug.host.running().some((r) => r.id === "t.a" || r.id === "t.b");
      await until(() => v.stages().length === 2 && v.stages().every(ready), 4000);
      await settle();
      const world = v.outermost();
      const value = expected(world);
      let checked = 0;
      for (const st of v.stages()) {
        for (const ext of ["t.a", "t.b"]) {
          const inst = st.debug.host.instanceOf(ext);
          if (!inst) continue;
          const a = inst.read("x");
          if (value === null) expect(a).toBeNull();
          else {
            // the same frozen object to every caller
            expect(a.value).toBe(world.ambients().x);
            expect(a.value).toEqual(value);
            expect(a.mine).toBe(st === world);
          }
          checked++;
        }
      }
      // the sky is the outermost's, never a linked doc's
      const sky = world.debug.viewport.atmosphere?.sky?.top ?? null;
      expect(sky).toBe(value ? (value.by === "t.a" ? "#111111" : "#222222") : null);
      // the pinned doc runs both, so something was read
      expect(checked > 0).toBe(true);
    }, 20_000);
});
