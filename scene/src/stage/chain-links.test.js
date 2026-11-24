// @vitest-environment happy-dom
// I8, the chain across links (STAGE.md, "The input chain", Invariants): for a hit
// anywhere in a composition three docs deep, the chain is each acting stage
// on the hit's path, innermost first, out to the outermost, each its own
// segment (its holders nearest first, then its root's), then the general
// parts of the focus stage, whatever the focus; each (stage, extension)
// once; nothing from a pin. Checked over every object of every stage
// (and nothing) × every focus × a widget winning or not, against those
// rules read off the view's stages.
//
//   Y: deck ⟶ A (link to X), S (link to H)
//   X: table ⟶ B (link to G: G acts here, first in path order)
//   H: h1, PG (link to G fixed at its heads: G pinned)
//   G: box ⟶ card

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK, linkOpener } from "../test/links.js";
import { keyOf, parseKey } from "./paths.js";

const holder = (id, traits) => ({ meta: { id, traits }, module: { create: () => ({ input: { press: () => null } }) } });
const EXTENSIONS = [
  holder("t.root-y", ["t.y"]),
  holder("t.root-x", ["t.x"]),
  holder("t.root-g", ["t.g"]),
  holder("t.root-h", ["t.h"]),
  holder("t.deck", ["t.deck"]),
  holder("t.table", ["t.table"]),
  holder("t.box", ["t.box"]),
  holder("t.card", ["t.card"]),
  // view plugins: the view's, seated at the focus stage
  { meta: { id: "t.view-1", type: "scene:view" }, module: { create: () => ({ input: { press: () => null } }) } },
  { meta: { id: "t.view-2", type: "scene:view" }, module: { create: () => ({ input: { press: () => null } }) } },
  linkOpener(),
];
const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const thing = (trait, extra = {}) => object({ name: trait, ...(trait ? { traits: { [trait]: {} } } : {}), ...extra });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("the chain across links (I8)", () => {
  it("every hit × every focus × a widget or not: inner segments first, out to the outermost, each once, none from a pin, then the view plugins, in the focus stage's frame", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const G = repo.add(emptyScene({ title: "G", traits: { "t.g": {} }, objects: { box: thing("t.box"), card: thing("t.card", { parent: "box" }) }, order: ["box", "card"] }));
    const H = repo.add(emptyScene({ title: "H", traits: { "t.h": {} }, objects: { h1: thing(null), PG: link(G.url, { at: { heads: G.heads() } }) }, order: ["h1", "PG"] }));
    const X = repo.add(emptyScene({ title: "X", traits: { "t.x": {} }, objects: { table: thing("t.table"), B: link(G.url, { parent: "table" }) }, order: ["table", "B"] }));
    s = await mountStage({
      repo,
      extensions: EXTENSIONS,
      doc: { title: "Y", traits: { "t.y": {} }, objects: { deck: thing("t.deck"), A: link(X.url, { parent: "deck" }), S: link(H.url) }, order: ["deck", "A", "S"] },
    });
    const view = s.debug.view;
    const stageAtPath = (p) => view.stages().find((st) => JSON.stringify(st.path) === JSON.stringify(p)) ?? null;
    await until(() => [["A"], ["A", "B"], ["S"], ["S", "PG"]].every((p) => stageAtPath(p)?.debug.host.running().length) && stageAtPath(["A", "B"]).debug.host.instanceOf("t.card"), 3000);
    expect(stageAtPath(["S", "PG"]).role).toBe("pinned");

    // every object of every stage, as the viewport keys it, and nothing
    const hits = [null];
    for (const st of view.stages()) for (const id of Object.keys(st.doc()?.objects ?? {})) hits.push(keyOf(st.n, id));
    const foci = [[], ["A"], ["A", "B"], ["S"]];
    const WIDGET = { owner: keyOf(stageAtPath(["A", "B"]).n, "t.card"), onTop: true };
    let checked = 0;
    for (const focus of foci) {
      expect(view.focusOn(focus)).toBe(true);
      // (the view plugins, in the focus stage's keys)
      const f = view.focusStage();
      const generals = view.plugins.running().map((p) => keyOf(f.n, p.id));
      expect(generals).toEqual(["t.view-1", "t.view-2", "t.links"].map((ext) => keyOf(f.n, ext)));
      for (const hitKey of hits)
        for (const widget of [null, WIDGET]) {
          const { order } = view.chainFor({ hit: hitKey == null ? null : { id: hitKey, point: [0, 0, 0], distance: 1 }, widget });
          const where = `focus ${JSON.stringify(focus)}, hit ${JSON.stringify(hitKey)}, widget ${!!widget}`;
          // each (stage, extension) once
          expect(new Set(order).size, where).toBe(order.length);
          const rest = widget ? order.slice(1) : order;
          if (widget) expect(order[0], where).toBe(WIDGET.owner);
          // the view plugins close it, every one
          expect(rest.slice(-generals.length), where).toEqual(generals);
          // (the widget's owner, first, comes again nowhere)
          const segs = rest.slice(0, -generals.length);
          if (widget) expect(segs.includes(WIDGET.owner), where).toBe(false);
          // the stages on the hit's path that act, innermost first (the outermost alone for nothing)
          const hitStage = hitKey == null ? null : view.stage(parseKey(hitKey).n);
          const path = hitStage ? [...hitStage.path, parseKey(hitKey).id] : null;
          const want = path ? view.stages().filter((st) => st.acts && path.length > st.path.length && st.path.every((x, i) => x === path[i])).sort((a, b) => b.path.length - a.path.length) : [];
          const stagesWanted = want.length ? want : [view.outermost()];
          const seen = [];
          for (const k of segs) {
            const n = parseKey(k).n;
            if (seen.at(-1) !== n) seen.push(n);
          }
          expect(seen, where).toEqual(stagesWanted.map((st) => st.n));
          // nothing from a pin, nor from a stage off the hit's path
          expect(segs.every((k) => view.stage(parseKey(k).n).acts), where).toBe(true);
          // within a stage: its holders nearest first, then its root's
          if (!widget && hitStage === stageAtPath(["A", "B"]) && parseKey(hitKey).id === "card") {
            const n = hitStage.n;
            const own = segs.filter((k) => parseKey(k).n === n).map((k) => parseKey(k).id);
            expect(own, where).toEqual(["t.card", "t.box", "t.root-g"]);
          }
          checked++;
        }
    }
    expect(checked).toBe(foci.length * hits.length * 2);
  });
});

// I8, the camera: the applied ride is the current body's, in its own
// stage's frame, whatever the focus; a pin rides nothing. Every stack of
// up to three bodies, one from each acting stage of the composition (the
// outermost, a link deep, two deep), in every order × every focus; and the
// pin's extension asking to ride its card, ignored, while Look holds.
describe("the camera across links (I8)", () => {
  it("every body stack ≤3 × every focus: the top body's ride applies; a pin's ride never does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rider = (id, traits, body, on) => ({
      meta: { id, traits },
      module: { create: (api) => ({ bodies: [{ id: body, label: body, enter: () => ({ input: {}, ride: { id: on }, leave() {} }) }], rideMine: () => api.camera.ride(on) }) },
    });
    const repo = new FakeRepo();
    const G = repo.add(emptyScene({ title: "G", objects: { card: thing("t.card") }, order: ["card"] }));
    const H = repo.add(emptyScene({ title: "H", objects: { PG: link(G.url, { at: { heads: G.heads() } }) }, order: ["PG"] }));
    const X = repo.add(emptyScene({ title: "X", objects: { table: thing("t.table"), B: link(G.url, { parent: "table" }) }, order: ["table", "B"] }));
    s = await mountStage({
      repo,
      extensions: [rider("t.deck", ["t.deck"], "b-y", "deck"), rider("t.table", ["t.table"], "b-x", "table"), rider("t.card", ["t.card"], "b-g", "card"), linkOpener()],
      doc: { objects: { deck: thing("t.deck"), A: link(X.url, { parent: "deck" }), S: link(H.url) }, order: ["deck", "A", "S"] },
    });
    const view = s.debug.view;
    const at = (p) => view.stages().find((st) => JSON.stringify(st.path) === JSON.stringify(p)) ?? null;
    await until(() => at(["A", "B"])?.debug.host.instanceOf("t.card") && at(["S", "PG"])?.debug.host.instanceOf("t.card"), 3000);
    expect(at(["S", "PG"]).role).toBe("pinned");
    const rideKey = { "b-y": keyOf(0, "deck"), "b-x": keyOf(at(["A"]).n, "table"), "b-g": keyOf(at(["A", "B"]).n, "card") };
    const current = () => view.viewport.rides.current()?.id ?? null;
    // the pin's extension asks to ride its card: a drawn stage moves no camera
    at(["S", "PG"]).debug.host.instanceOf("t.card").rideMine();
    expect(current()).toBe(null);
    const BODIES = Object.keys(rideKey);
    const stacks = [[]];
    for (const a of BODIES) {
      stacks.push([a]);
      for (const b of BODIES.filter((x) => x !== a)) {
        stacks.push([a, b]);
        for (const c of BODIES.filter((x) => x !== a && x !== b)) stacks.push([a, b, c]);
      }
    }
    let checked = 0;
    for (const focus of [[], ["A"], ["A", "B"], ["S"]]) {
      expect(view.focusOn(focus)).toBe(true);
      for (const stack of stacks) {
        view.enterBody("look", null);
        for (const b of stack) expect(view.enterBody(b, null), `${b} in ${JSON.stringify(stack)}`).toBeTruthy();
        expect([JSON.stringify(focus), stack.join(">"), current()]).toEqual([JSON.stringify(focus), stack.join(">"), stack.length ? rideKey[stack.at(-1)] : null]);
        checked++;
      }
    }
    view.enterBody("look", null);
    expect(checked).toBe(4 * 16);
  });
});
