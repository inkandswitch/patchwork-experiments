// I5, channels (STAGE.md, "Views, stages and links", Invariants): an object's claims, holds
// and sends travel on its doc's channel, wherever the doc is open. Three
// views of one game G on a manual clock, in two pages: G alone and G linked
// into X (and mirrored there) in one page, on one repo, where the page bus
// carries between them; G linked into Y through X (and mirrored there, by
// X's own link) in a second page, on a repo of its own joined to the first
// by an in-memory network (fake-repo's connect), so what crosses pages goes
// by its handle's broadcast, as in real Patchwork.
// Every sequence of up to two claims and releases of one seat by the three
// views, then every holder × every view leaving: `claimedBy` agrees in
// every stage of G once delivered, as a first-come model says; a hold (a
// carry) taken in any view shows as that view's in every other and in both
// mirrors.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo, connect } from "../test/fake-repo.js";
import { manualTime } from "./time.js";
import { LINK } from "./links.js";

const CARD = { meta: { id: "t.card", traits: ["t.game"] }, module: { create: () => ({}) } };
const link = (url, extra = {}) => object({ name: "Game", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const SEAT = "seat:p1";

let cleanups = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
  vi.restoreAllMocks();
});

async function world() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const time = manualTime();
  const repo = new FakeRepo();
  const G = repo.add(emptyScene({ title: "G", objects: { c: object({ name: "Card" }) }, order: ["c"], traits: { "t.game": {} } }));
  const X = repo.add(emptyScene({ title: "X", objects: { L: link(G.url), M: link(G.url, { transform: { position: [4, 0, 0], rotation: [0, 0, 0], scale: 1 } }) }, order: ["L", "M"] }));
  const Y = repo.add(emptyScene({ title: "Y", objects: { LX: link(X.url) }, order: ["LX"] }));
  // the second page's repo: the same three docs, and the network between
  const far = new FakeRepo();
  for (const h of [G, X, Y]) far.add(h.doc(), h.url);
  cleanups.push(connect(repo, far));
  // the harness registers the extension (its own view: an empty scene)
  const h = await mountStage({ repo, extensions: [CARD], doc: {}, time });
  cleanups.push(() => h.unmount());
  const { default: Stage } = await import("./stage.js");
  const open = (handle, who, on = repo) => {
    const el = document.createElement("div");
    el.repo = on;
    el.viewerId = `viewer:${who}`;
    el.time = time;
    el.packageSettleMs = 0;
    document.body.append(el);
    const unmount = Stage(handle, el);
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      unmount();
      el.remove();
    };
    cleanups.push(leave);
    return { v: el.querySelector(".scene-stage").__sceneDebug.view, leave };
  };
  const views = [open(G, "ana"), open(X, "ben"), open(far.handles.get(Y.url), "cara", far)];
  const gStages = (i) => views[i].v.stages().filter((st) => st.url === G.url);
  const api = (st) => st.debug.host.record("t.card")?.api ?? null;
  await time.until(() => views.every((_, i) => gStages(i).length === (i === 0 ? 1 : 2) && gStages(i).every((st) => api(st))), { frames: 600, what: "every stage of G" });
  const acting = (i) => api(gStages(i).find((st) => st.acts));
  /** every stage of G that is still open, with whose view it is */
  const everywhere = () => views.flatMap((x, i) => (x.v.dead ? [] : gStages(i).map((st) => ({ i, role: st.role, api: api(st) }))));
  const deliver = async () => {
    await settle();
    await time.advance(400);
    await settle();
  };
  return { time, views, acting, everywhere, deliver, session: (i) => views[i].v.session };
}

describe("channels (I5): claims and holds on G's channel, wherever G is open", () => {
  it("every sequence of ≤2 claims and releases by three views: every stage of G agrees with a first-come model", async () => {
    const w = await world();
    const OPS = [0, 1, 2].flatMap((i) => [["claim", i], ["release", i]]);
    const seqs = [[]];
    for (const a of OPS) seqs.push([a]);
    for (const a of OPS) for (const b of OPS) seqs.push([a, b]);
    const releases = [null, null, null];
    let checked = 0;
    for (const seq of seqs) {
      let holder = null;
      for (const [op, i] of seq) {
        if (op === "claim") {
          const r = w.acting(i).claim("c", SEAT);
          expect(!!r).toBe(holder === null || holder === i);
          if (r) {
            releases[i] = r;
            holder = i;
          }
        } else {
          releases[i]?.();
          releases[i] = null;
          if (holder === i) holder = null;
        }
        await w.deliver();
        for (const { i: j, role, api } of w.everywhere()) {
          const by = api.claimedBy("c", SEAT);
          const want = holder === null ? null : w.session(holder);
          if ((by?.session ?? null) !== want) throw new Error(`after ${JSON.stringify(seq)}: view ${j}'s ${role} says ${by?.session ?? null}, want ${want}`);
          checked++;
        }
      }
      for (let i = 0; i < 3; i++) releases[i]?.();
      releases.fill(null);
      await w.deliver();
    }
    // 6 + 72 ops, each checked in 5 stages
    expect(checked).toBe((6 + 2 * 36) * 5);
  }, 60_000);

  it("a hold (a carry) taken in any view shows as that view's in every other stage of G, mirrors too", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) {
      expect(w.acting(i).pose.hold("c", { position: [i, 0, 0], rotation: [0, 0, 0], scale: 1 })).toBe(true);
      await w.deliver();
      for (const { i: j, role, api } of w.everywhere()) {
        if (j === i && role === "acting") continue;
        expect([j, role, api.heldBy("c")]).toEqual([j, role, w.session(i)]);
      }
      w.acting(i).pose.release("c");
      await w.deliver();
      for (const { api } of w.everywhere()) expect(api.heldBy("c")).toBe(null);
    }
  }, 30_000);

  for (const holder of [0, 1, 2])
    for (const leaver of [0, 1, 2])
      it(`view ${holder} holds the seat and view ${leaver} leaves: every stage left agrees`, async () => {
        const w = await world();
        expect(w.acting(holder).claim("c", SEAT)).toBeTypeOf("function");
        await w.deliver();
        w.views[leaver].leave();
        await w.deliver();
        const want = holder === leaver ? null : w.session(holder);
        for (const { i, role, api } of w.everywhere()) expect([i, role, api.claimedBy("c", SEAT)?.session ?? null]).toEqual([i, role, want]);
      }, 20_000);
});
