// Ambients on a stage's path (W2), and the atmosphere through them (W9):
// every stage's api.ambient(name) is the outermost offer under that name on
// the stage's own path (the outermost doc first, the stage's own doc last),
// or null when nothing on it offers one; `mine` exactly where the stage
// offers it itself, its frame the stage's own in the offering doc's root
// and its clock the offering doc's. Enumerated over link shapes (alone,
// linked, mirrored, pinned, two deep) × what each doc on the path offers
// (nothing, one extension, the other, and at the outermost both in their
// running order), two names that the offers cover differently (so a name
// resolves on its own), the focus (outside, inside) and the viewer's body.
// Nothing a linked doc offers reaches its host or a sibling; the viewport's
// atmosphere is the outermost's.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./links.js";
import { composeMatrix, multiplyMatrices } from "../transform.js";

const ME = "automerge:ana";

// two offering extensions, each by its own trait, so a doc chooses which run:
// t.a offers "x"; t.b offers "x" and "y" (its id and the doc's title, so a
// leak shows whose); each an atmosphere of its own
const NAMES = { "t.a": ["x"], "t.b": ["x", "y"] };
const offering = (id) => ({
  meta: { id, traits: [id] },
  module: {
    create: (api) => ({
      ambient: () => ({
        ...Object.fromEntries(NAMES[id].map((name) => [name, { by: id, doc: api.doc().title }])),
        atmosphere: { sky: { top: id === "t.a" ? "#111111" : "#222222" } },
      }),
      // what it reads, kept for the test
      read: (name) => api.ambient(name),
    }),
  },
});
const EXTENSIONS = [offering("t.a"), offering("t.b"), { meta: { id: "t.walk" }, module: { create: () => ({ bodies: [{ id: "t.walk", label: "Walk", enter: () => ({ input: {}, leave() {} }) }] }) } }];

/** What a doc offers: nothing, one extension, the other, or both (in whatever running order the stage starts them). */
const OFFERS = { none: {}, a: { "t.a": {} }, b: { "t.b": {} }, both: { "t.a": {}, "t.b": {} } };
const INNER = ["none", "a", "b"];

// the links' placements: turned and moved, so a frame says which doc it is in
const AT_L = { position: [2, 0, 1], rotation: [0, 0.3, 0], scale: 1 };
const AT_M = { position: [5, 0, 0], rotation: [0, 0.4, 0], scale: 1 };
const AT_LX = { position: [-4, 0, 3], rotation: [0, -0.7, 0], scale: 2 };

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

/** The value a stage stacks under `name`, worked out from what runs there: its last running extension offering the name's, or null. */
function stacked(st, name) {
  const running = st.debug.host.running().map((r) => r.id).filter((id) => NAMES[id]?.includes(name));
  return running.length ? { by: running.at(-1), doc: st.doc().title } : null;
}

/** The stages on `st`'s path, the outermost first, `st` last: found by path prefix among the view's stages. */
function pathOf(v, st) {
  const out = [v.outermost()];
  for (let k = 1; k < st.path.length; k++) out.push(v.stages().find((s) => s.path.length === k && s.path.every((x, i) => x === st.path[i])));
  if (st !== v.outermost()) out.push(st);
  return out;
}

const close = (a, b) => {
  expect(a === null).toBe(b === null);
  if (a) a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));
};

/** Every case: [shape, the outermost's offers, the middle doc's (two deep), the inner doc's]. */
function cases() {
  const out = [];
  for (const h of Object.keys(OFFERS)) {
    out.push(["alone", h, null, null]);
    for (const shape of ["linked", "mirrored", "pinned"]) for (const g of INNER) out.push([shape, h, null, g]);
    for (const x of INNER) for (const g of INNER) out.push(["two deep", h, x, g]);
  }
  return out;
}

describe("ambients on a stage's path (W2): each name the outermost offer on the stage's own path", () => {
  for (const [shape, hostOffers, midOffers, innerOffers] of cases())
    it(`${shape}: the outermost offering ${hostOffers}${midOffers ? `, the middle ${midOffers}` : ""}${innerOffers ? `, the linked doc ${innerOffers}` : ""}`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const repo = new FakeRepo();
      const s = await mountStage({ repo, viewerId: ME, extensions: EXTENSIONS, doc: { objects: {}, order: [] } });
      cleanups.push(() => s.unmount());
      const G = repo.add(emptyScene({ title: "G", traits: OFFERS[innerOffers ?? "none"] }));
      const X = repo.add(emptyScene({ title: "X", traits: OFFERS[midOffers ?? "none"], objects: { L: link(G.url, { transform: AT_L }) }, order: ["L"] }));
      const H = repo.add(
        emptyScene({
          title: "H",
          traits: OFFERS[hostOffers],
          ...(shape === "alone"
            ? {}
            : shape === "linked"
              ? { objects: { L: link(G.url, { transform: AT_L }) }, order: ["L"] }
              : shape === "mirrored"
                ? { objects: { L: link(G.url, { transform: AT_L }), M: link(G.url, { transform: AT_M }) }, order: ["L", "M"] }
                : shape === "pinned"
                  ? { objects: { P: link(G.url, { at: { heads: G.heads() }, transform: AT_L }) }, order: ["P"] }
                  : { objects: { LX: link(X.url, { transform: AT_LX }) }, order: ["LX"] }),
        }),
      );
      const v = await view(repo, H);
      const want = shape === "alone" ? 1 : shape === "linked" || shape === "pinned" ? 2 : 3;
      const ready = (st) => !Object.keys(st.doc().traits ?? {}).length || st.debug.host.running().some((r) => r.id === "t.a" || r.id === "t.b");
      await until(() => v.stages().length === want && v.stages().every(ready), 4000);
      await settle();
      const world = v.outermost();
      // every linked doc's clock paused, the outermost's running: a value's clock says whose it is
      for (const st of v.stages()) {
        if (st === world || !st.acts) continue;
        const rec = ["t.a", "t.b"].map((id) => st.debug.host.record(id)).find(Boolean);
        rec?.api.clock.pause();
      }
      await settle();
      // each link's own placement in the doc that holds it, composed independently of the stage
      const linkMatrix = { L: composeMatrix(AT_L), M: composeMatrix(AT_M), P: composeMatrix(AT_L), LX: composeMatrix(AT_LX) };
      let checked = 0;
      for (const focus of shape === "alone" || shape === "pinned" ? ["outside"] : ["outside", "inside"]) {
        if (focus === "inside") expect(v.enter(shape === "two deep" ? ["LX", "L"] : ["L"])).toBe(true);
        for (const body of ["look", "edit", "t.walk"]) {
          expect(v.enterBody(body, null)).toBeTruthy();
          await settle();
          for (const st of v.stages()) {
            const path = pathOf(v, st);
            for (const ext of ["t.a", "t.b"]) {
              const inst = st.debug.host.instanceOf(ext);
              if (!inst) continue;
              for (const name of ["x", "y"]) {
                const a = inst.read(name);
                // the outermost stage on the path whose doc offers the name
                const from = path.find((p) => stacked(p, name) !== null) ?? null;
                if (!from) {
                  expect(a).toBeNull();
                  continue;
                }
                // the same frozen object to every caller, the offering stage's own
                expect(a.value).toBe(from.ambients()[name]);
                expect(a.value).toEqual(stacked(from, name));
                expect(a.mine).toBe(from === st);
                expect(a.clock.running).toBe(from.worldTime().running);
                if (!a.clock.running) expect(a.clock.t).toBe(from.worldTime().t);
                // (and a paused doc's clock does say so, where one offers)
                if (from !== world && from.acts) expect(a.clock.running).toBe(false);
                // the frame: none where it's mine; the stage's own in the world where the outermost offers;
                // two deep with the middle doc offering, the link L's own placement in it
                const frame = a.frame?.matrix ?? null;
                if (from === st) expect(frame).toBeNull();
                else if (from === world) close(frame, st.frame().matrix);
                else close(frame, linkMatrix[st.path.at(-1)]);
                checked++;
              }
            }
          }
          // the sky is the outermost's, never a linked doc's (W9)
          const sky = world.debug.viewport.atmosphere?.sky?.top ?? null;
          const top = stacked(world, "x")?.by;
          expect(sky).toBe(top ? (top === "t.a" ? "#111111" : "#222222") : null);
          v.enterBody("look", null);
        }
        if (focus === "inside") v.leave();
        await settle();
      }
      // something was read wherever some doc runs an offering extension
      const anyOffers = [hostOffers, midOffers, innerOffers].some((o) => o && o !== "none");
      expect(checked > 0).toBe(anyOffers);
      // the two deep frames really differ by doc: the middle doc's placement is turned and scaled
      if (shape === "two deep") expect(multiplyMatrices(linkMatrix.LX, linkMatrix.L)[0]).not.toBeCloseTo(linkMatrix.L[0], 3);
    }, 20_000);
});
