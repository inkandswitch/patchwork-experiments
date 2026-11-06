// Claims (STAGE.md, "Claims"): doc fields naming who holds what, counted only
// while their holder's session is in presence, settled by Automerge when two
// views take one at once. Mounted with the stage harness, two views at a time:
// on one shared handle (one doc, broadcasts delivered to both), or on two real
// Automerge docs that merge when the test says (for concurrent writes).
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as Automerge from "@automerge/automerge";
import { PLAY, mountStage, object, settle, until } from "../test/stage-harness.js";
import { CLAIM_GRACE_MS } from "./stage.js";

const CREW = { meta: { id: "t.crew", activities: ["edit"] }, module: { create: () => ({}) } };
const OTHER = { meta: { id: "t.other" }, module: { create: () => ({}) } };
const EXTENSIONS = [CREW, OTHER, PLAY];

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  vi.restoreAllMocks();
});

const objects = () => ({ ship: object({ name: "Ship" }), helm: object({ name: "Helm", parent: "ship" }) });

/** Until each view has heard the other's presence (A answers B's hello at its next send slot). */
async function met(A, B) {
  await until(() => Object.hasOwn(A.debug.presence.get(), B.debug.presence.session) && Object.hasOwn(B.debug.presence.get(), A.debug.presence.session));
}

/** Two views of one doc on one handle, each hearing the other's broadcasts. */
async function twoViews(doc = {}) {
  const A = await mountStage({ extensions: EXTENSIONS, doc: { objects: objects(), order: ["ship", "helm"], ...doc }, viewerId: "viewer:alice" });
  mounted.push(A);
  A.handle.broadcast = (message) => A.handle.emit("ephemeral-message", { message });
  const B = await mountStage({ handle: A.handle, repo: A.repo, viewerId: "viewer:bob" });
  mounted.push(B);
  await met(A, B);
  return { A, B, a: A.api("t.crew"), b: B.api("t.crew") };
}

// A stand-in DocHandle over a real Automerge doc. Two of them start from one
// doc (as two peers would) and only see each other's changes on sync(), so
// writes made in between are concurrent. Broadcasts go across at once.
function automergePair(init) {
  const all = [];
  const make = (doc) => {
    const listeners = new Map();
    const h = {
      url: "automerge:2zaP7rXkGBkF5y3Gq9KHzK2xqvT8",
      d: doc,
      doc: () => h.d,
      heads: () => Automerge.getHeads(h.d),
      change(fn) {
        h.d = Automerge.change(h.d, fn);
        h.emit("change", { handle: h, doc: h.d });
      },
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev).add(fn);
      },
      off: (ev, fn) => listeners.get(ev)?.delete(fn),
      emit: (ev, payload) => [...(listeners.get(ev) ?? [])].forEach((fn) => fn(payload)),
      broadcast: (message) => all.filter((o) => o !== h).forEach((o) => o.emit("ephemeral-message", { message })),
    };
    all.push(h);
    return h;
  };
  const a = make(Automerge.from(init));
  const b = make(Automerge.load(Automerge.save(a.d))); // a peer of its own (a new actor)
  return {
    a,
    b,
    sync() {
      const [da, db] = [a.d, b.d];
      a.d = Automerge.merge(a.d, Automerge.clone(db));
      b.d = Automerge.merge(b.d, Automerge.clone(da));
      a.emit("change", { handle: a, doc: a.d });
      b.emit("change", { handle: b, doc: b.d });
    },
  };
}

async function twoPeers(doc = {}) {
  let pair = null;
  const repo = {
    add: (init) => (pair = automergePair(init)).a,
    find: async (url) => {
      throw new Error(`unavailable: ${url}`);
    },
  };
  const A = await mountStage({ extensions: EXTENSIONS, repo, doc: { objects: objects(), order: ["ship", "helm"], ...doc }, viewerId: "viewer:alice" });
  mounted.push(A);
  const B = await mountStage({ handle: pair.b, repo, viewerId: "viewer:bob" });
  mounted.push(B);
  await met(A, B);
  return { A, B, a: A.api("t.crew"), b: B.api("t.crew"), pair };
}

describe("claims on one view", () => {
  it("taking writes the field on the object; claimedBy says whose; releasing deletes it", async () => {
    const { A, a } = await twoViews();
    expect(a.claimedBy("helm", "station")).toBeNull();
    const release = a.claim("helm", "station");
    expect(typeof release).toBe("function");
    expect(A.doc().objects.helm.claims.station).toEqual({ viewer: "viewer:alice", session: a.session });
    expect(a.claimedBy("helm", "station")).toEqual({ viewer: "viewer:alice", session: a.session, mine: true });
    // every extension of this view reads it as this view's
    expect(A.api("t.other").claimedBy("helm", "station").mine).toBe(true);
    release();
    expect(A.doc().objects.helm.claims.station).toBeUndefined();
    expect(a.claimedBy("helm", "station")).toBeNull();
    release(); // twice is harmless
  });

  it("a scene-wide claim (id null) lives at doc.claims", async () => {
    const { A, a } = await twoViews();
    const release = a.claim(null, "sim");
    expect(A.doc().claims.sim.session).toBe(a.session);
    expect(a.claimedBy(null, "sim").mine).toBe(true);
    expect(a.claimedBy(undefined, "sim").mine).toBe(true);
    release();
    expect(A.doc().claims.sim).toBeUndefined();
  });

  it("kinds are separate; taking it again from the same extension gives the same release; another extension here is refused", async () => {
    const { A, a } = await twoViews();
    const station = a.claim("helm", "station");
    const held = a.claim("helm", "held");
    expect(Object.keys(A.doc().objects.helm.claims).sort()).toEqual(["held", "station"]);
    expect(a.claim("helm", "station")).toBe(station);
    expect(A.api("t.other").claim("helm", "station")).toBeNull();
    held();
    expect(Object.keys(A.doc().objects.helm.claims)).toEqual(["station"]);
  });

  it("nothing to claim: a missing object, or no kind", async () => {
    const { a } = await twoViews();
    expect(a.claim("nope", "station")).toBeNull();
    expect(a.claim("helm", "")).toBeNull();
    expect(a.claim("helm")).toBeNull();
    expect(a.claimedBy("helm")).toBeNull();
  });

  it("released when the extension stops, without an onLost", async () => {
    const { A, a } = await twoViews();
    const onLost = vi.fn();
    a.claim("helm", "station", { onLost });
    await A.activity("play"); // t.crew takes part in editing only
    expect(A.api("t.crew")).toBeNull();
    expect(A.doc().objects.helm.claims.station).toBeUndefined();
    await settle();
    expect(onLost).not.toHaveBeenCalled();
    // and a stopped extension's api takes nothing
    expect(a.claim("helm", "station")).toBeNull();
  });

  it("lost when its object is removed", async () => {
    const { A, a } = await twoViews();
    const onLost = vi.fn();
    a.claim("helm", "station", { onLost });
    A.change((d) => {
      delete d.objects.helm;
      d.order = ["ship"];
    });
    await settle();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(A.debug.claims()).toEqual([]);
  });

  it("let go on pagehide, and taken back as the new session on return", async () => {
    const { A, B, a, b } = await twoViews();
    const onLost = vi.fn();
    a.claim("helm", "station", { onLost });
    const first = a.session;
    globalThis.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(A.doc().objects.helm.claims.station).toBeUndefined();
    expect(b.claimedBy("helm", "station")).toBeNull();
    const back = new Event("pageshow");
    Object.defineProperty(back, "persisted", { value: true });
    globalThis.dispatchEvent(back);
    await settle();
    expect(a.session).not.toBe(first);
    expect(A.doc().objects.helm.claims.station).toEqual({ viewer: "viewer:alice", session: a.session });
    expect(b.claimedBy("helm", "station")).toMatchObject({ session: a.session, mine: false });
    expect(onLost).not.toHaveBeenCalled();
    expect(B.debug.claims()).toEqual([]);
  });
});

describe("claims between views", () => {
  it("another view's live claim: claimedBy names it, and claim is refused", async () => {
    const { a, b } = await twoViews();
    a.claim("helm", "station");
    expect(b.claimedBy("helm", "station")).toEqual({ viewer: "viewer:alice", session: a.session, mine: false });
    expect(b.claim("helm", "station")).toBeNull();
  });

  it("released by the holder stopping: the other view can take it", async () => {
    const { A, a, b } = await twoViews();
    a.claim("helm", "station");
    A.unmount();
    mounted.splice(mounted.indexOf(A), 1);
    await settle();
    expect(b.claimedBy("helm", "station")).toBeNull();
    expect(typeof b.claim("helm", "station")).toBe("function");
  });

  it("lapses when its holder's session leaves presence: the next taker writes over it, and the old holder is told once", async () => {
    const { A, a, b } = await twoViews();
    const onLost = vi.fn();
    a.claim("helm", "station", { onLost });
    // A's tab dies without a word to the doc: only its presence goes
    A.debug.presence.goodbye();
    await settle();
    expect(A.doc().objects.helm.claims.station.session).toBe(a.session); // still written
    expect(b.claimedBy("helm", "station")).toBeNull(); // but lapsed
    const release = b.claim("helm", "station");
    expect(typeof release).toBe("function");
    expect(A.doc().objects.helm.claims.station.session).toBe(b.session);
    await settle();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(A.debug.claims()).toEqual([]);
    // the old holder letting go now leaves the new one's claim alone
    a.claim("helm", "station"); // refused: b is here
    expect(A.doc().objects.helm.claims.station.session).toBe(b.session);
  });

  it("a claim by a session not yet in presence counts for a grace period from when this view first read it", async () => {
    let now = Date.now();
    const ghost = { viewer: "viewer:ghost", session: "ghost" };
    const { a } = await twoViews({ objects: { ...objects(), helm: object({ name: "Helm", claims: { station: ghost } }) } });
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect(a.claimedBy("helm", "station")).toEqual({ ...ghost, mine: false });
    expect(a.claim("helm", "station")).toBeNull();
    now += CLAIM_GRACE_MS - 1;
    expect(a.claimedBy("helm", "station")).not.toBeNull();
    now += 1;
    expect(a.claimedBy("helm", "station")).toBeNull();
    expect(typeof a.claim("helm", "station")).toBe("function");
  });

  it("a just-joined holder whose hello arrives within the grace period keeps its claim", async () => {
    let now = Date.now();
    const { A, a } = await twoViews({ objects: { ...objects(), helm: object({ name: "Helm", claims: { station: { viewer: "viewer:new", session: "new" } } }) } });
    vi.spyOn(Date, "now").mockImplementation(() => now);
    expect(a.claimedBy("helm", "station").session).toBe("new");
    now += 500;
    A.handle.emit("ephemeral-message", { message: { type: "scene:presence", session: "new", viewer: "viewer:new", seq: 1, at: now, keys: {} } });
    now += CLAIM_GRACE_MS * 2;
    expect(a.claimedBy("helm", "station")).toMatchObject({ session: "new", mine: false });
  });
});

describe("concurrent claims, settled by Automerge", () => {
  it("two peers take the helm at once: both succeed locally, the merge keeps one on both, and the other is told once", async () => {
    const { A, B, a, b, pair } = await twoPeers();
    const lostA = vi.fn();
    const lostB = vi.fn();
    expect(typeof a.claim("helm", "station", { onLost: lostA })).toBe("function");
    expect(typeof b.claim("helm", "station", { onLost: lostB })).toBe("function");
    expect(a.claimedBy("helm", "station").mine).toBe(true);
    expect(b.claimedBy("helm", "station").mine).toBe(true);
    pair.sync();
    await settle();
    const winner = A.doc().objects.helm.claims.station.session;
    expect(B.doc().objects.helm.claims.station.session).toBe(winner);
    expect([a.session, b.session]).toContain(winner);
    const [won, lost, wonFn, lostFn, loser] = winner === a.session ? [a, b, lostA, lostB, B] : [b, a, lostB, lostA, A];
    expect(lostFn).toHaveBeenCalledTimes(1);
    expect(wonFn).not.toHaveBeenCalled();
    expect(won.claimedBy("helm", "station").mine).toBe(true);
    expect(lost.claimedBy("helm", "station")).toMatchObject({ session: winner, mine: false });
    expect(loser.debug.claims()).toEqual([]);
    // nothing more to settle: another round changes nothing
    pair.sync();
    await settle();
    expect(lostFn).toHaveBeenCalledTimes(1);
    expect(A.doc().objects.helm.claims.station.session).toBe(winner);
  });

  it("two peers giving an object its first claims (different kinds) at once both keep theirs", async () => {
    const { A, B, a, b, pair } = await twoPeers();
    const lostA = vi.fn();
    const lostB = vi.fn();
    a.claim("helm", "station", { onLost: lostA });
    b.claim("helm", "sim", { onLost: lostB });
    pair.sync();
    // two `claims` maps made at once: the merge keeps one, so one claim is missing for now
    expect(Object.keys(A.doc().objects.helm.claims)).toHaveLength(1);
    await settle();
    // its holder lost no contest, so it writes it again into the map that won
    pair.sync();
    await settle();
    for (const d of [A.doc(), B.doc()]) {
      expect(d.objects.helm.claims.station.session).toBe(a.session);
      expect(d.objects.helm.claims.sim.session).toBe(b.session);
    }
    expect(lostA).not.toHaveBeenCalled();
    expect(lostB).not.toHaveBeenCalled();
  });
});
