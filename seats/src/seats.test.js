// seats (seats.js, model.js, body.js): seats held by claims, the picker,
// name tags on the places others give a seat, the seat's view (through the
// object its camera is in, riding it), a seat as a station on the use prompt,
// what it tells the others, and the roster it contributes. On the fake world
// (test/fake-world.js): several views, sessions never heard from, crashes
// without a bye, and merges written by hand.
import { afterEach, describe, it, expect, vi } from "vitest";
import Seats from "./seats.js";
import { BENCH_RADIUS, CONFIRM_MS, SEATS, allSeats, arrivalSeat, cleanPlaces, lay, mySeat, placeOn, rosterOf, seatLookedAt, seatOf, seatState, seatTagAt, seatVerb, seatsOf } from "./model.js";
import { applyMatrix as apply } from "./transform.js";
import * as fakes from "./test/fake-world.js";
import { emptyScene } from "./test/empty-scene.js";
import { plugins } from "./index.js";

afterEach(() => vi.useRealTimers());

/** A scene doc as the scene makes one, with these objects in it, listed in order. */
const sceneOf = (objects, traits = {}, more = {}) => emptyScene({ objects, order: Object.keys(objects), traits, ...more });

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
// A seat's places are someone else's to give (a table's hand trays): here, a
// test trait, contributed as `seatPlaces` the way that someone would.
const ZONE = "t.zone";
const zone = (seat, half = 0.05) => ({ [ZONE]: { seat, min: [-0.3, 0, -half], max: [0.3, 0.15, half] } });
const seatPlaces = (snap) => Object.entries(snap.objects).flatMap(([id, o]) => (o?.traits?.[ZONE] ? [{ id, ...o.traits[ZONE] }] : []));
/** A view of the world with the seats part in it, and what the others contribute. */
const withSeats = (w, session, viewer, { local = {}, collected = {} } = {}) => {
  const api = w.join(session, { viewer, local, ext: "seats" });
  w.view(session).collected = { seatPlaces, ...collected };
  return { api, x: w.attach(session, Seats.create(api)) };
};
const KIND = (sid) => `seat:${sid}`;
const near = (got, want, digits = 6) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
// contacts, with names
const ANA = "automerge:2AnaAnaAnaAnaAnaAnaAnaAna1";
const BEN = "automerge:2BenBenBenBenBenBenBenBen1";

const objects = () => ({
  // two hand trays, one turned round, each a seat's place 0.6 × 0.1 m, 0.15 m high
  hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1") },
  hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
  board: { name: "Board", transform: T([0, 0, 0]) },
});
const seats = (p1 = null, p2 = null) => ({ p1: { name: "Player 1", player: p1 }, p2: { name: "Player 2", player: p2 } });

describe("seats, held by claims", () => {
  /** A table (seats p1/p2, hands hand1/hand2) and its views, each [session, viewer]. */
  async function room(seated, { claims, views = [] } = {}) {
    const repo = fakes.fakeRepo();
    repo.add({ name: "Ana" }, ANA);
    repo.add({ name: "Ben" }, BEN);
    const doc = sceneOf(objects(), { [SEATS]: seated }, claims ? { claims } : {});
    const w = fakes.fakeWorld(doc, { repo });
    const t = { w, api: {}, x: {} };
    t.join = async (session, viewer) => {
      ({ api: t.api[session], x: t.x[session] } = withSeats(w, session, viewer));
      await t.step();
      return t.api[session];
    };
    /** let the views hear the doc, and their microtasks (reconcile) and lookups run, twice over */
    t.step = async () => {
      for (let i = 0; i < 3; i++) {
        w.flush();
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    t.pick = async (session, seat) => {
      const sel = w.view(session).overlay.querySelector(".seats-pick");
      sel.value = seat;
      sel.dispatchEvent(new Event("change"));
      await t.step();
    };
    t.options = (session) => [...w.view(session).overlay.querySelector(".seats-pick").options].map((o) => o.textContent);
    t.picked = (session) => w.view(session).overlay.querySelector(".seats-pick").value;
    t.notices = (session) => w.view(session).notices.map((n) => n.text);
    t.claim = (sid) => w.doc.claims?.[KIND(sid)] ?? null;
    t.player = (sid) => w.doc.traits[SEATS][sid].player;
    for (const [s, v] of views) await t.join(s, v);
    return t;
  }

  it("seatState: whose a seat is, from the doc's player and the live claim", () => {
    const seat = (player = null) => ({ name: "Seat", player });
    const by = (viewer, mine = false) => ({ viewer, session: `s-${viewer}`, mine });
    const table = [
      [seat(), null, "free"],
      [undefined, null, "free"],
      [seat("a"), null, "mine"], // yours in the doc, not claimed yet (a reload)
      [seat("b"), null, "away"],
      [seat(), by("a", true), "mine"],
      [seat("b"), by("a", true), "mine"], // a split merge: the claim's holder writes itself back
      [seat("a"), by("a"), "mine-elsewhere"], // your other tab
      [seat("a"), by("b"), "taken"], // you lost it, or it's theirs now
      [seat(), by("b"), "taken"], // they're sitting down
      [seat("b"), by("b"), "taken"],
      [seat(), by(null), "taken"],
    ];
    for (const [s, b, want] of table) expect([s?.player, b?.viewer, b?.mine, seatState(s, b, "a")]).toEqual([s?.player, b?.viewer, b?.mine, want]);
    expect(seatState(seat(), by(null), null)).toBe("taken");
  });

  it("sit, and the seat's camera; the seat is claimed as well as written down", async () => {
    const t = await room(seats(), { views: [["C", "carol"]] });
    t.w.change((d) => (d.traits[SEATS].p1.camera = { position: [0, 1, 1], target: [0, 0, 0] }));
    await t.step();
    expect(t.options("C")).toEqual(["Watching", "Player 1", "Player 2"]);
    await t.pick("C", "p1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(t.w.view("C").camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    expect(t.picked("C")).toBe("p1");
    // moving seats lets go of the last one
    await t.pick("C", "p2");
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "carol"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "C"]);
    t.w.done();
  });

  it("a view that has just opened sees a present player's seat as taken, and can't take it", async () => {
    // Ben sat down in a session this view hasn't heard from yet: it counts (the stage's grace)
    const t = await room(seats(BEN), { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol"]] });
    expect(t.options("C")).toEqual(["Watching", "Player 1 (taken)", "Player 2"]);
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    await t.pick("C", "p1");
    expect(confirm).not.toHaveBeenCalled();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(t.player("p1")).toBe(BEN);
    expect(t.claim("p1").session).toBe("Sben");
    expect(t.picked("C")).toBe("");
    confirm.mockRestore();
    t.w.done();
  });

  it("once that claim has lapsed unheard, the seat is away, and taken only after asking", async () => {
    const t = await room(seats(BEN), { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol"]] });
    expect(t.options("C")[1]).toBe("Player 1 (taken)");
    // no presence event says it lapsed: the view looks again after the grace period
    t.w.grace = false;
    await vi.advanceTimersByTimeAsync(6500);
    expect(t.options("C")[1]).toBe("Player 1 (away)");
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    await t.pick("C", "p1");
    expect(confirm).toHaveBeenCalledWith("Ben is away. Take their seat? You'll see what's theirs.");
    expect(t.player("p1")).toBe(BEN);
    expect(t.picked("C")).toBe("");
    confirm.mockReturnValue(true);
    await t.pick("C", "p1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    confirm.mockRestore();
    t.w.done();
  });

  it("two sitting at once: the one whose claim lost the merge is told once, and writes nothing", async () => {
    const t = await room(seats(), { views: [["B", BEN], ["C", "carol"]] });
    await t.pick("C", "p1");
    expect(t.claim("p1").session).toBe("C");
    const writes = vi.spyOn(t.api.C, "change");
    const claims = vi.spyOn(t.api.C, "claim");
    // Ben sat down at the same moment, and the merge kept his claim and his player
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    await vi.advanceTimersByTimeAsync(7000);
    await t.step();
    expect(t.notices("C").filter((n) => /first/.test(n))).toEqual(["Ben sat in Player 1 first; you're watching"]);
    expect(writes).not.toHaveBeenCalled();
    expect(claims).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe(BEN);
    expect(t.picked("C")).toBe("");
    expect(t.options("C")[1]).toBe("Player 1 (taken)");
    t.w.done();
  });

  it("a seat taken while this view went unheard, long after it sat down, says so", async () => {
    const t = await room(seats(), { views: [["B", BEN], ["C", "carol"]] });
    await t.pick("C", "p1");
    await vi.advanceTimersByTimeAsync(20_000);
    const writes = vi.spyOn(t.api.C, "change");
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    expect(t.notices("C").at(-1)).toBe("Ben took Player 1 while you were away; you're watching");
    expect(writes).not.toHaveBeenCalled();
    t.w.done();
  });

  it("a merge that split the claim from the player: the claim's holder writes itself back in, once", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    const writesA = vi.spyOn(t.api.A, "change");
    const writesB = vi.spyOn(t.api.B, "change");
    // the claims key went to Alice, the player key to Bob
    t.w.change((d) => (d.traits[SEATS].p1.player = "bob"));
    await t.step();
    expect(t.player("p1")).toBe("alice");
    expect(writesA).toHaveBeenCalledOnce();
    // and that's the end of it: no write answers a write
    t.w.change((d) => (d.view = { touched: true }));
    await t.step();
    expect(writesA).toHaveBeenCalledOnce();
    expect(writesB).not.toHaveBeenCalled();
    expect(t.picked("B")).toBe("");
    t.w.done();
  });

  it("a reload (a new session, the same viewer) claims its seat again", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    // a clean close: its claim goes with it, its player stays
    t.w.leave("A");
    await t.step();
    expect([t.claim("p1"), t.player("p1")]).toEqual([null, "alice"]);
    expect(t.options("B")[1]).toBe("Player 1 (away)");
    await t.join("A2", "alice");
    expect(t.claim("p1")).toEqual({ viewer: "alice", session: "A2" });
    expect(t.picked("A2")).toBe("p1");
    expect(t.options("B")[1]).toBe("Player 1 (taken)");
    // a crash leaves its claim behind, lapsed: taken over just the same
    t.w.leave("A2", { bye: false });
    expect(t.claim("p1").session).toBe("A2");
    await t.join("A3", "alice");
    expect(t.claim("p1")).toEqual({ viewer: "alice", session: "A3" });
    t.w.done();
  });

  it("one person in two tabs: both seated; the tab that loses the claim says nothing", async () => {
    const t = await room(seats(), { views: [["A", "alice"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    // the second tab is seated too, and leaves the claim with the first
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p1", "p1"]);
    expect(t.options("A2")[1]).toBe("Player 1");
    expect(t.claim("p1").session).toBe("A");
    await t.pick("A2", "p1");
    expect(t.claim("p1").session).toBe("A");
    // both sat down at once and the second tab's claim won: the first just stays seated
    t.w.change((d) => (d.claims[KIND("p1")] = { viewer: "alice", session: "A2" }));
    await t.step();
    expect(t.notices("A").filter((n) => /first|sitting there/.test(n))).toEqual([]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p1", "p1"]);
    expect(t.player("p1")).toBe("alice");
    // the second tab closes: the first takes the claim back
    t.w.leave("A2");
    await t.step();
    expect(t.claim("p1").session).toBe("A");
    t.w.done();
  });

  it("one person in two tabs: the second moves to another seat, and the first lets go rather than writing itself back", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    expect(t.picked("A2")).toBe("p1");
    let writes = 0;
    for (const s of ["A", "A2"]) {
      const change = t.api[s].change;
      t.api[s].change = (fn) => (writes++, change(fn));
    }
    await t.pick("A2", "p2");
    for (let i = 0; i < 20; i++) await t.step();
    // A2 claimed p2 and wrote alice there (and out of p1), once; A let go of p1 and wrote nothing
    expect(writes).toBe(1);
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "alice"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "A2"]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p2", "p2"]);
    expect(t.options("B")).toEqual(["Watching", "Player 1", "Player 2 (taken)"]);
    expect(t.notices("A").filter((n) => /first|sitting there|away/.test(n))).toEqual([]);
    t.w.done();
  });

  it("one person in two tabs: Watching in the one without the claim stands them up in both", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    let writes = 0;
    for (const s of ["A", "A2"]) {
      const change = t.api[s].change;
      t.api[s].change = (fn) => (writes++, change(fn));
    }
    await t.pick("A2", "");
    for (let i = 0; i < 20; i++) await t.step();
    expect(writes).toBe(1);
    expect([t.player("p1"), t.claim("p1")]).toEqual([null, null]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["", ""]);
    expect(t.options("B")[1]).toBe("Player 1");
    t.w.done();
  });

  it("Watching lets go of the claim, and says nothing", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.pick("A", "");
    expect([t.claim("p1"), t.player("p1")]).toEqual([null, null]);
    expect(t.w.sent.map((s) => s.type)).toEqual(["sat"]);
    expect(t.options("B")[1]).toBe("Player 1");
    t.w.done();
  });

  it("a name tag on each of a seat's places: its seat, who sits there, and whether they're here", async () => {
    const t = await room(seats(ANA, BEN), { views: [["A", ANA], ["C", "carol"]] });
    const tags = () => t.w.view("C").labels.map(({ key, text, position, data }) => ({ key, text, position, state: data.state }));
    expect(tags()).toEqual([
      // on each tray, in the world (these seats have no camera to say which edge is theirs: the middle)
      { key: "hand1", text: "Player 1 · Ana", position: [0, 0, 0.5], state: "taken" },
      { key: "hand2", text: "Player 2 · Ben (away)", position: [0, 0, -0.5], state: "away" },
    ]);
    expect(t.w.view("A").labels[0].text).toBe("Player 1 · Ana");
    await t.pick("A", "");
    expect(tags().map((x) => x.text)).toEqual(["Player 1 · free", "Player 2 · Ben (away)"]);
    // and what peers say comes from them by name
    t.x.C.receive("sat", { seat: "p2" }, { session: "B", viewer: BEN });
    expect(t.notices("C").at(-1)).toBe("Ben sat down as Player 2");
    t.w.done();
  });
});

// ─── a seat as a station ────────────────────────────────────────────────────

// a ship turned and heeled, a table across her cockpit, a tray at each end, each seat's eye over its bench
const SHIP = T([10, 0, 5], [0.12, 0.7, -0.08]);
const seatCam = (z) => ({ position: [0, 1.2, z], target: [0, 0.7, z * 0.17], in: "tbl" });
const SEATS0 = () => ({ p1: { name: "Player 1", player: null, camera: seatCam(0.95) }, p2: { name: "Player 2", player: null, camera: seatCam(-0.95) } });
function shipDoc(seats = SEATS0(), claims) {
  const objects = {
      ship: { name: "Ship", transform: SHIP },
      tbl: { name: "Card table", parent: "ship", transform: T([0, 0, 2.85], [0, Math.PI / 2, 0]), locked: true },
      hand1: { name: "Hand 1", parent: "tbl", transform: T([0, 0.7, 0.5]), traits: zone("p1", 0.065), locked: true },
      hand2: { name: "Hand 2", parent: "tbl", transform: T([0, 0.7, -0.5], [0, Math.PI, 0]), traits: zone("p2", 0.065), locked: true },
      card: { name: "Card", parent: "tbl", transform: T([0.1, 0.702, 0.5]), tags: ["card"] },
      pawn: { name: "Pawn", parent: "tbl", transform: T([0.35, 0.7, 0.55]) },
  };
  return emptyScene({ objects, order: Object.keys(objects), traits: { [SEATS]: seats }, ...(claims ? { claims } : {}) });
}

/** The table, and views on it: each [session, viewer, { walking }]. */
async function cockpit(seats, { claims, views = [] } = {}) {
  const repo = fakes.fakeRepo();
  repo.add({ name: "Ana" }, ANA);
  repo.add({ name: "Ben" }, BEN);
  const w = fakes.fakeWorld(shipDoc(seats, claims), { repo });
  const t = { w, api: {}, x: {}, walker: {} };
  const step = async () => {
    for (let i = 0; i < 3; i++) {
      w.flush();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  t.step = step;
  t.join = async (session, viewer, { walking = false } = {}) => {
    const api = (t.api[session] = w.join(session, { viewer, ext: "seats" }));
    // a body to walk in: as far as a table knows one (scene/TOOLS.md §4), entered here as a walker would be
    const input = (t.walker[session] = { suspended: vi.fn(), resumed: vi.fn() });
    const walk = { id: "walk", label: "Walk", lock: true, reach: 2.5, enter: () => ({ input, leave() {} }) };
    w.view(session).collected = { seatPlaces, bodies: [walk] };
    t.x[session] = w.attach(session, Seats.create(api));
    if (walking) api.body.enter("walk");
    await step();
  };
  /** The body on top of a view's stack. */
  t.body = (session) => t.api[session].local.get().body.id;
  /** The use prompt in `session`, looking at `id` (at `point`, world) from `from`: the seat verb's state (reach is the stage's: the command says `reach: true`). */
  t.ctx = (session, id, point = null, from = t.eye(session)) => {
    const api = t.api[session];
    return { scene: api.scene(), local: api.local.get(), from, hit: { id, point, distance: null } };
  };
  t.look = (session, id, point = null, from = t.eye(session)) => t.cmd(session).state(id, t.ctx(session, id, point, from));
  /** The verb's run, in the context of a look at `id` now (as the stage's run passes it). */
  t.run = (session, id, point = null, from = t.eye(session)) => t.cmd(session).run(id, undefined, t.ctx(session, id, point, from));
  /** As the prompt does on F: state, then run, in one context. */
  t.press = async (session, id, point = null, from = t.eye(session)) => {
    const ctx = t.ctx(session, id, point, from);
    const st = t.cmd(session).state(id, ctx);
    if (st && !st.disabled) t.cmd(session).run(id, undefined, ctx);
    await step();
    return st;
  };
  /** Pick a seat in a view's picker, as a person does. */
  t.pickSeat = async (session, sid) => {
    const select = w.view(session).overlay.querySelector("select");
    select.value = sid;
    select.dispatchEvent(new Event("change"));
    await step();
  };
  t.cmd = (session) => t.x[session].commands.find((c) => c.id === "seat");
  /** A point in the table's frame, in the world (as drawn). */
  t.at = (p) => apply(w.scene().world("tbl"), p);
  /** Standing in the cockpit beside a seat (its bench), eye high. */
  t.eye = () => t.at([0.3, 1.5, 1.1]);
  t.player = (sid) => w.doc.traits[SEATS][sid].player;
  t.claim = (sid) => w.doc.claims?.[KIND(sid)] ?? null;
  t.notices = (session) => w.view(session).notices.map((n) => n.text);
  for (const [s, v, o] of views) await t.join(s, v, o);
  return t;
}

describe("which seat a look is at (pure)", () => {
  const w = fakes.fakeWorld(shipDoc());
  const snap = w.scene();
  const seats = SEATS0();
  const drawn = (id) => w.scene().world(id);
  const tbl = (p) => apply(snap.world("tbl"), p);
  const from = tbl([0.3, 1.5, 1.1]);
  const at = (target, point) => {
    const r = seatLookedAt({ snap, target, point, places: cleanPlaces(seatPlaces(snap), snap.objects), drawn });
    if (r) expect(r.of).toBeNull(); // the table's seats are the doc's own
    return r?.seat ?? null;
  };
  afterEach(() => w.done?.());

  it("a tray: its seat, with or without a point (reach is the stage's: the verb says reach: true)", () => {
    expect(at("hand1", null)).toBe("p1");
    expect(at("hand1", tbl([0.1, 0.7, 0.5]))).toBe("p1");
    expect(at("hand2", tbl([0, 0.7, -0.5]), tbl([0, 1.5, -1.1]))).toBe("p2");
  });

  it("the table just past a tray's edge, and the bench under a seat's eye, aboard a heeled ship", () => {
    expect(at("tbl", tbl([0.2, 0.7, 0.6]))).toBe("p1"); // the table's edge by the tray
    expect(at("tbl", tbl([0, 0.7, 0.05]))).toBeNull(); // the middle of the table: nobody's
    expect(at("ship", tbl([0.1, 0.45, 0.95 + BENCH_RADIUS * 0.6]))).toBe("p1"); // the bench, part of her hull
    expect(at("ship", tbl([0.1, 0.45, 0.95 + BENCH_RADIUS * 1.5]))).toBeNull(); // past it
    expect(at("ship", tbl([0, 0.45, -0.95]))).toBe("p2");
  });

  it("never a loose piece (F over it is the hand's), nor anything unlocked that isn't a seat's frame", () => {
    expect(at("card", tbl([0.1, 0.703, 0.5]))).toBeNull();
    expect(at("pawn", tbl([0.35, 0.72, 0.55]))).toBeNull();
  });

  it("the seat verb: walking, refused, asked, yours, free; seated in your own, standing up", () => {
    const v = (state, o = {}) => seatVerb({ name: "Player 1", state, who: "Ben", walking: true, seated: false, confirming: false, ...o });
    expect(v("taken")).toEqual({ verb: "sit", label: "Ben is sitting there", disabled: true });
    expect(v("away")).toMatchObject({ verb: "confirm", label: "Sit as Player 1 (Ben is away)" });
    expect(v("away", { confirming: true })).toMatchObject({ verb: "sit", label: "Take Player 1: F again" });
    expect(v("mine")).toMatchObject({ verb: "sit", label: "Back to your seat" });
    expect(v("free")).toMatchObject({ verb: "sit", label: "Sit as Player 1" });
    expect(v("mine-elsewhere")).toMatchObject({ verb: "sit", label: "Sit as Player 1" });
    expect(v("mine", { walking: false, seated: true })).toMatchObject({ verb: "stand", label: "Stand up" });
    expect(v("mine", { walking: false, seated: false })).toBeNull();
    for (const s of ["free", "taken", "away", "mine-elsewhere"]) expect(v(s, { walking: false, seated: true })).toBeNull();
  });

  it("the seat body: a seat's own, entered with a place, never offered by the chip; its verb needs reach", () => {
    const x = Seats.create(w.join("Z", { ext: "seats" }));
    expect(x.bodies.map((b) => [b.id, b.here, b.lock, b.reach, b.keys])).toEqual([["seat", false, false, 2, []]]);
    expect(x.commands.find((c) => c.id === "seat").reach).toBe(true);
  });
});

describe("several places on one object (a machine's ports along its front)", () => {
  // N places side by side along x on one object, each 0.25 wide, at
  // y 0.8..1, z 0.3..0.4 in its frame; the object as it stands, or moved and
  // turned. Points on a grid in the object's frame, never on a boundary (a
  // turn's rounding would make "on" a coin toss), and who sits: nobody, or
  // each place's seat.
  const boxes = (n) => Array.from({ length: n }, (_, i) => ({ seat: `s${i}`, of: "m", id: "m", min: [i * 0.25, 0.8, 0.3], max: [(i + 1) * 0.25, 1, 0.4] }));
  // a seat of m's, as placeOn names it
  const M = (seat) => (seat == null ? null : { of: "m", seat });
  const c = Math.cos(0.7), s = Math.sin(0.7);
  const poses = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 2, 0.5, -3, 1],
  ];
  const xs = Array.from({ length: 26 }, (_, i) => -0.2 + i * 0.0573);
  it("the place the point is in; else your own, if you sit at one of them; else the nearest; with no point, yours or the first", () => {
    let cases = 0;
    for (const n of [1, 2, 3, 4]) {
      const trays = boxes(n);
      for (const m of poses)
        for (const mine of [null, ...trays.map((z) => z.seat)])
          for (const x of xs)
            for (const y of [0.5, 0.91, 1.3])
              for (const z of [0.35, 0.7]) {
                const inX = x > 0 && x < n * 0.25;
                const column = Math.min(n - 1, Math.max(0, Math.floor(x / 0.25)));
                const inside = inX && y > 0.8 && y < 1 && z > 0.3 && z < 0.4;
                const want = n === 1 ? "s0" : inside ? `s${column}` : (mine ?? `s${column}`);
                expect(placeOn(trays, m, apply(m, [x, y, z]), M(mine))).toEqual(M(want));
                cases++;
              }
      for (const mine of [null, ...trays.map((z) => z.seat)]) expect(placeOn(trays, null, null, M(mine))).toEqual(M(n === 1 ? "s0" : (mine ?? "s0")));
      // your own seat at another object (or the doc's of the same name) is not one of these
      for (const other of [{ of: "k", seat: "s1" }, { of: null, seat: "s1" }]) expect(placeOn(trays, null, null, other)).toEqual(M("s0"));
    }
    expect(cases).toBe((1 + 2 + 3 + 4 + 4) * 2 * 26 * 3 * 2);
  });

  it("through seatLookedAt: a look at the object is at the place the rule picks, among its own seats", () => {
    // the seats are m's own (on m), as a machine lays its ports; the doc has seats of the same names, which are never these
    const snap = { objects: { m: { traits: { [SEATS]: { s0: { name: "P1", lasting: false }, s1: { name: "P2", lasting: false } } } } }, traits: { [SEATS]: { s0: { name: "Table 1" } } }, parents: new Map(), world: () => poses[1] };
    const at = (p, mine = null) => seatLookedAt({ snap, target: "m", point: apply(poses[1], p), places: boxes(2), drawn: () => poses[1], mine: M(mine) });
    expect(at([0.1, 0.9, 0.35])).toEqual(M("s0"));
    expect(at([0.4, 0.9, 0.35])).toEqual(M("s1"));
    expect(at([0.4, 1.3, 0.35])).toEqual(M("s1")); // above the places: the nearest
    expect(at([0.24, 1.3, 0.35], "s1")).toEqual(M("s1")); // seated at P2, looking at the middle: your own
    expect(at([0.1, 0.9, 0.35], "s1")).toEqual(M("s0")); // but a look on P1's place is P1's
    // a place for a seat its owner doesn't have counts for nothing
    expect(seatLookedAt({ snap, target: "m", point: null, places: [{ ...boxes(1)[0], seat: "s9" }], drawn: () => poses[1] })).toBeNull();
  });
});

describe("sitting down from walking", () => {
  it("F at a free seat: the picker's sit (claim, player, notices), then the seat body on top of the walk, in its view", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toEqual({ label: "Sit as Player 1", title: expect.any(String) });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(t.notices("C")).toContain("You sat down as Player 1");
    expect(t.notices("B")).toContain("Someone sat down as Player 1");
    expect(t.w.sent.filter((s) => s.type === "sat")).toEqual([{ session: "C", viewer: "carol", type: "sat", data: { seat: "p1" } }]);
    // the seat body over the walk, which waits under it
    expect(t.w.view("C").bodies.map((b) => b.id)).toEqual(["look", "walk", "seat"]);
    expect(t.walker.C.suspended).toHaveBeenCalledOnce();
    near(t.w.view("C").camera.position, t.at([0, 1.2, 0.95]));
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    // seated now: the place offers standing up, not sitting
    expect(t.look("C", "hand1", null, t.at([0, 1.2, 0.95]))).toMatchObject({ label: "Stand up" });
    expect(t.look("C", "hand2", null, t.at([0, 1.2, 0.95]))).toBeNull();
    t.w.done();
  });

  it("only walking, and never at a loose piece: in Look it isn't offered", async () => {
    const t = await cockpit(SEATS0(), { views: [["C", "carol", { walking: true }], ["D", "dan"]] });
    expect(t.look("C", "card", t.at([0.1, 0.703, 0.5]))).toBeNull();
    expect(t.look("D", "hand1")).toBeNull();
    t.w.done();
  });

  it("a present player's seat is refused, as the picker refuses it: greyed out, and nothing written", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: BEN } }, { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toEqual({ label: "Ben is sitting there", disabled: true });
    const writes = vi.spyOn(t.api.C, "change");
    // a press the prompt didn't stop (it raced the claim): told, nothing written
    t.look("C", "hand1");
    t.run("C", "hand1");
    await t.step();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(writes).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe(BEN);
    expect(t.body("C")).toBe("walk");
    t.w.done();
  });

  it("an away player's seat: F says whose hand you'd see, F again takes it; too late, it asks again", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: BEN } }, { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol", { walking: true }]] });
    t.w.grace = false;
    await vi.advanceTimersByTimeAsync(6500);
    await t.step();
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1 (Ben is away)" });
    await t.press("C", "hand1");
    expect(t.notices("C")).toEqual(["Ben is away. Press F again to take their seat; you'll see what's theirs."]);
    expect(t.player("p1")).toBe(BEN);
    // too late: asked again
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 10);
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1 (Ben is away)" });
    await t.press("C", "hand1");
    expect(t.look("C", "hand1")).toMatchObject({ label: "Take Player 1: F again" });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(t.body("C")).toBe("seat");
    t.w.done();
  });

  it("two walking up to one seat at once: the one whose claim lost the merge is told, and writes nothing more", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN, { walking: true }], ["C", "carol", { walking: true }]] });
    // both see it free, and press together: Carol's write lands first here
    expect(t.look("B", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    t.run("C", "hand1");
    // Ben's claim, taken in his view before Carol's arrived, wins the merge
    const writes = vi.spyOn(t.api.C, "change");
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    await vi.advanceTimersByTimeAsync(7000);
    await t.step();
    expect(t.notices("C").filter((n) => /first/.test(n))).toEqual(["Ben sat in Player 1 first; you're watching"]);
    expect(writes).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe(BEN);
    // she sat, and is put back on her feet there: the seat body comes off, the walk carries on
    expect(t.walker.C.suspended).toHaveBeenCalledOnce();
    expect(t.walker.C.resumed).toHaveBeenCalledOnce();
    expect(t.body("C")).toBe("walk");
    expect(t.look("C", "hand1")).toMatchObject({ label: "Ben is sitting there", disabled: true });
    t.w.done();
  });

  it("sat from walking once, later from the picker: losing that race leaves you watching, not on your feet", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.body("C")).toBe("seat");
    // up out of it by the picker, and back to it the same way, as Ben takes it too
    await t.pickSeat("C", "");
    expect(t.player("p1")).toBe(null);
    expect(t.body("C")).toBe("walk");
    await vi.advanceTimersByTimeAsync(7000);
    await t.pickSeat("C", "p1");
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    await vi.advanceTimersByTimeAsync(7000);
    await t.step();
    expect(t.notices("C").filter((n) => /first/.test(n))).toEqual(["Ben sat in Player 1 first; you're watching"]);
    // she sat from the picker this time: she stays in the seat's view, watching
    expect(t.body("C")).toBe("seat");
    expect(t.walker.C.resumed).toHaveBeenCalledOnce();
    t.w.done();
  });

  it("a press after someone sat meanwhile (the prompt's state was stale): refused at run", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    t.w.change((d) => {
      d.claims = { [KIND("p1")]: { viewer: BEN, session: "B" } };
      d.traits[SEATS].p1.player = BEN;
    });
    t.run("C", "hand1");
    await t.step();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(t.player("p1")).toBe(BEN);
    expect(t.body("C")).toBe("walk");
    t.w.done();
  });

  it("your own seat, after getting up: back to it; another seat: you move", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walking: true }]] });
    expect(t.claim("p1")?.session).toBe("C");
    expect(t.look("C", "hand1")).toMatchObject({ label: "Back to your seat" });
    const sent = t.w.sent.length;
    await t.press("C", "hand1");
    expect(t.w.sent.length).toBe(sent); // nothing to tell: she was sitting there
    expect(t.body("C")).toBe("seat");
    // up again (Leave), and over to the other seat
    t.api.C.body.leave();
    await t.step();
    await t.press("C", "hand2", null, t.at([0, 1.5, -1.1]));
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "carol"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "C"]);
    t.w.done();
  });
});

describe("standing up", () => {
  it("F at your place: the seat body comes off, the seat still yours; what you sat from carries on", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walking: true }]] });
    await t.pickSeat("C", "p1"); // (in the seat's view, over the walk)
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    expect(t.x.C.roster.sitting()).toEqual({ of: null, seat: "p1" });
    const eye = t.at([0, 1.2, 0.95]);
    expect(t.look("C", "hand1", null, eye)).toMatchObject({ label: "Stand up" });
    const writes = vi.spyOn(t.api.C, "change");
    await t.press("C", "hand1", null, eye);
    expect(t.body("C")).toBe("walk");
    expect(t.walker.C.resumed).toHaveBeenCalledOnce();
    expect(writes).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")?.session).toBe("C");
    expect(t.notices("C")).toContain("You got up from Player 1; it's still yours.");
    expect(t.x.C.roster.sitting()).toBeNull(); // up: not sitting, though the seat is still yours
    expect(t.w.view("C").rides).toEqual([]);
    // walking now: the place offers sitting back down
    expect(t.look("C", "hand1")).toMatchObject({ label: "Back to your seat" });
    await t.press("C", "hand1");
    expect(t.body("C")).toBe("seat");
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    t.w.done();
  });

  it("walking from your seat (a body over it), F at your place goes back down to the seat: its view again, never a second seat body", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
    await t.pickSeat("C", "p1");
    t.api.C.body.enter("walk"); // up out of it, walking (sailing's Enter does this from a seat)
    t.api.C.camera.set({ position: [9, 9, 9], target: [0, 0, 0] });
    expect(t.w.view("C").bodies.map((b) => b.id)).toEqual(["look", "seat", "walk"]);
    expect(t.x.C.roster.sitting()).toBeNull(); // walking off from it is not sitting
    expect(t.look("C", "hand1")).toMatchObject({ label: "Back to your seat" });
    await t.press("C", "hand1");
    expect(t.w.view("C").bodies.map((b) => b.id)).toEqual(["look", "seat"]);
    near(t.w.view("C").camera.position, t.at([0, 1.2, 0.95]));
    t.w.done();
  });

  it("from a seat entered from Look, standing up is Look again; not offered at a seat with no view", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
    await t.pickSeat("C", "p1");
    await t.press("C", "hand1", null, t.at([0, 1.2, 0.95]));
    expect(t.body("C")).toBe("look");
    const u = await cockpit({ p1: { name: "Player 1", player: "dan" }, p2: { name: "Player 2", player: null } }, { views: [["D", "dan"]] });
    expect(u.look("D", "hand1", null, u.at([0, 1.2, 0.95]))).toBeNull();
    u.w.done();
    t.w.done();
  });
});

// ─── the seat's view, and name tags, at a table aboard ──────────────────────

// a ship turned 0.7, a table across her cockpit, a turned-round hand for p2
const SHIP2 = T([10, 0, 5], [0, 0.7, 0]);
const TBL = T([0, 0.72, 2.85], [0, Math.PI / 2, 0]);
async function aboard({ local = {}, seated: who = { p1: { name: "Player 1", player: null, camera: seatCam(0.95) }, p2: { name: "Player 2", player: null, camera: seatCam(-0.95) } } } = {}) {
  const objects = {
    ship: { name: "Ship", transform: SHIP2 },
    tbl: { name: "Card table", parent: "ship", transform: TBL, locked: true },
    hand1: { name: "Hand 1", parent: "tbl", transform: T([0, 0.7, 0.5]), traits: zone("p1") },
    hand2: { name: "Hand 2", parent: "tbl", transform: T([0, 0.7, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
  };
  const w = fakes.fakeWorld(sceneOf(objects, { [SEATS]: who }));
  const { api: a } = withSeats(w, "A", "alice", { local });
  withSeats(w, "B", "bob");
  w.flush();
  await vi.advanceTimersByTimeAsync(10);
  /** Pick a seat in a view's picker, as a person does. */
  const pick = async (session, sid) => {
    const select = w.view(session).overlay.querySelector("select");
    select.value = sid;
    select.dispatchEvent(new Event("change"));
    w.flush();
    await vi.advanceTimersByTimeAsync(10);
  };
  /** The ship drawn somewhere the doc hasn't caught up with yet (a peer simulating her). */
  const sail = (t) => w.holds.set("ship", { session: "SIM", transform: t, at: Date.now() });
  return { w, a, pick, sail };
}

describe("the seat's view aboard", () => {
  it("is put through the table as drawn, and rides it", async () => {
    const t = await aboard();
    const drawn = T([14, 0.2, 9], [0.05, 1.4, 0.03]);
    t.sail(drawn);
    await t.pick("A", "p1");
    const m = t.a.worldOf("tbl");
    expect(t.w.view("A").camera.in).toBeUndefined();
    near(t.w.view("A").camera.position, apply(m, [0, 1.2, 0.95]));
    near(t.w.view("A").camera.target, apply(m, [0, 0.7, 0.95 * 0.17]));
    expect(t.w.view("A").rides).toEqual([{ id: "tbl", opts: { at: [0, 0.7, 0.95 * 0.17] } }]);
    // another seat: one ride, the new one's
    await t.pick("A", "p2");
    expect(t.w.view("A").rides.map((r) => r.id)).toEqual(["tbl"]);
    near(t.w.view("A").camera.position, apply(m, [0, 1.2, -0.95]));
    // standing up: no ride
    await t.pick("A", "");
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("a seat whose camera is in a frame that's gone (its table deleted) leaves the view as it is", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: null, camera: { ...seatCam(0.95), in: "gone" } }, p2: { name: "Player 2", player: null } } });
    t.a.camera.set({ position: [30, 6, 30], target: [0, 2, 0] });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toEqual({ position: [30, 6, 30], target: [0, 2, 0] });
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("a seat whose camera is in no frame is set once, and rides its doc's root (a game linked onto a table rides the table; the outermost's root, nothing)", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "Player 2", player: null } } });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    expect(t.w.view("A").rides).toEqual([{ id: null, opts: { at: [0, 0, 0] } }]);
    t.w.done();
  });

  it("leaving the seat body some other way (the chip's Leave) is standing up: the view rides nothing, the seat stays yours", async () => {
    const t = await aboard();
    await t.pick("A", "p1");
    expect(t.w.view("A").rides).toHaveLength(1);
    t.a.body.leave();
    t.w.flush();
    expect(t.w.view("A").rides).toEqual([]);
    expect(t.w.doc.traits[SEATS].p1.player).toBe("alice");
    // the picker again: back in it
    await t.pick("A", "p1");
    expect(t.w.view("A").rides).toHaveLength(1);
    t.w.done();
  });
});

describe("name tags aboard", () => {
  it("name tags lie on the hands as drawn, at the edge nearest each seat, and follow them each frame", async () => {
    const t = await aboard();
    const tag = (k) => t.w.view("A").labels.find((l) => l.key === k).position;
    // p1 sits on hand1's +z side; hand2 is turned round, so p2's side is its +z too
    near(tag("hand1"), apply(t.a.worldOf("hand1"), [0, 0, 0.05]), 3);
    near(tag("hand2"), apply(t.a.worldOf("hand2"), [0, 0, 0.05]), 3);
    t.sail(T([12, 0.4, 7.5], [0.1, 0.95, 0]));
    t.w.tick(1 / 60);
    near(tag("hand1"), apply(t.a.worldOf("hand1"), [0, 0, 0.05]), 3);
    t.w.done();
  });

  it("seatTagAt: the tray's floor at the edge nearest the eye, else its middle", () => {
    const z = { min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] };
    expect(seatTagAt(z, [0, 0.5, 0.45])).toEqual([0, 0, 0.05]);
    expect(seatTagAt(z, [0.9, 0.5, -2])).toEqual([0.3, 0, -0.05]);
    expect(seatTagAt(z, null)).toEqual([0, 0, 0]);
  });
});

// ─── the roster, and writing seats ──────────────────────────────────────────

describe("the roster (pure in the snapshot)", () => {
  const snap = (s) => ({ traits: { [SEATS]: s } });
  it("every seat in seat order, who is seated, which are open, and a seated viewer's seat name", async () => {
    const w = fakes.fakeWorld(sceneOf(objects(), { [SEATS]: seats("ann", null) }));
    const { x } = withSeats(w, "A", "ann");
    const r = x.roster;
    const s = w.scene();
    expect(r.seats(s)).toEqual([{ id: "p1", name: "Player 1", viewer: "ann" }, { id: "p2", name: "Player 2", viewer: null }]);
    expect(r.viewers(s)).toEqual(["ann"]);
    expect(r.open(s)).toEqual(["Player 2"]);
    expect([r.nameOf(s, "ann"), r.nameOf(s, "bob"), r.nameOf(s, null)]).toEqual(["Player 1", null, null]);
    // it answers for the snapshot it's given, not the one it last saw
    const later = snap(seats("ann", "bob"));
    expect(r.viewers(later)).toEqual(["ann", "bob"]);
    expect(r.open(later)).toEqual([]);
    expect(r.viewers(s)).toEqual(["ann"]);
    w.done();
  });

  it("parties, for undo: whoever is seated, here or away, for every object at the table, by the snapshot it's given", async () => {
    const w = fakes.fakeWorld(sceneOf(objects(), { [SEATS]: seats("ann", null) }));
    const { x } = withSeats(w, "A", "ann");
    for (const [s, want] of [
      [snap(seats(null, null)), []],
      [snap(seats("ann", null)), ["ann"]],
      [snap(seats(null, "bob")), ["bob"]],
      [snap(seats("ann", "bob")), ["ann", "bob"]],
    ]) {
      const of = x.parties(s);
      for (const id of ["card", "anything", null]) expect(of(id)).toEqual(want);
    }
    w.done();
  });

  it("reads the doc alone: claims and presence change nothing", () => {
    const base = snap(seats("ann", null));
    for (const claims of [undefined, { [KIND("p2")]: { viewer: "bob", session: "S" } }]) expect(rosterOf({ ...base, d: { claims } })).toEqual(rosterOf(base));
    expect(rosterOf({})).toEqual([]);
    expect(rosterOf(snap({ a: { player: "" }, b: {}, c: { name: "C", player: 7 } }))).toEqual([{ id: "a", name: "a", viewer: null }, { id: "b", name: "b", viewer: null }, { id: "c", name: "C", viewer: null }]);
    expect(seatOf(seatsOf(base), "ann")).toBe("p1");
  });

  it("who: a contact's name once it's known, else their seat's, else Someone", async () => {
    const repo = fakes.fakeRepo();
    repo.add({ name: "Ana" }, ANA);
    const w = fakes.fakeWorld(sceneOf(objects(), { [SEATS]: seats(ANA, "bob") }), { repo });
    const { x } = withSeats(w, "C", "carol");
    w.flush();
    expect(x.roster.who("bob")).toBe("Player 2");
    expect(x.roster.who("nobody")).toBe("Someone");
    x.roster.who(ANA);
    await vi.advanceTimersByTimeAsync(0);
    expect(x.roster.who(ANA)).toBe("Ana");
    w.done();
  });
});

describe("lay: seats written into a scene being set up", () => {
  it("writes them empty, making the map where the scene has none (a game is a doc of its own: its seats are its doc's)", () => {
    const d = { traits: {}, objects: {} };
    lay(d, { p1: { name: "Player 1", camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: {} });
    expect(d.traits[SEATS]).toEqual({ p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "p2", player: null } });
    // no seats to write: no map made
    const e = { traits: {}, objects: {} };
    lay(e, {});
    expect(e.traits).toEqual({});
  });

  it("laid again (the game set up again in its doc): a seat there keeps its player and takes the new name and view", () => {
    const d = { objects: {}, traits: { [SEATS]: { p1: { name: "P1", player: "ann", camera: { position: [0, 1, 1] } } } } };
    lay(d, { p1: { name: "Player 1", camera: { position: [5, 1, 1] } }, p2: { name: "Player 2" } });
    expect(d.traits[SEATS]).toEqual({ p1: { name: "Player 1", player: "ann", camera: { position: [5, 1, 1] } }, p2: { name: "Player 2", player: null } });
  });

  it("the plugin says where to find it: `roster: true`, its trait described", async () => {
    const p = plugins.find((x) => x.id === "seats");
    expect(p).toMatchObject({ type: "scene:extension", roster: true, traits: [SEATS] });
    expect(p.describes[SEATS].entries.init).toEqual({ player: null });
    expect(() => structuredClone({ ...p, load: undefined })).not.toThrow();
    const mod = await p.load();
    expect(typeof mod.create).toBe("function");
    expect(mod.lay).toBe(lay);
  });

  it("places: only well-formed ones on objects that are there", () => {
    const objects = { tray: {} };
    expect(cleanPlaces([{ seat: "p1", id: "tray", min: [0, 0, 0], max: ["1", 1, 1] }, { seat: "p1", id: "gone", min: [0, 0, 0], max: [1, 1, 1] }, { seat: 3, id: "tray", min: [], max: [] }, null, { seat: "p1", id: "tray" }], objects)).toEqual([{ seat: "p1", of: null, id: "tray", min: [0, 0, 0], max: [1, 1, 1] }]);
    // an object's seat: `of` names an object that's there
    expect(cleanPlaces([{ seat: "p1", of: "tray", id: "tray", min: [0, 0, 0], max: [1, 1, 1] }, { seat: "p1", of: "gone", id: "tray", min: [0, 0, 0], max: [1, 1, 1] }, { seat: "p1", of: 7, id: "tray", min: [0, 0, 0], max: [1, 1, 1] }], objects)).toEqual([{ seat: "p1", of: "tray", id: "tray", min: [0, 0, 0], max: [1, 1, 1] }]);
  });
});

describe("arriving seated (view.start = { body: \"seat\" }, no seat named)", () => {
  it("arrivalSeat: your own seat if the doc seats you and it has a view, else the first with a view, watching; none: nothing (every case of two seats)", () => {
    const cam = { position: [0, 1, 1], target: [0, 0, 0] };
    const who = [null, "me", "other"];
    let cases = 0;
    for (const c1 of [true, false])
      for (const c2 of [true, false])
        for (const p1 of who)
          for (const p2 of who) {
            const seats = { p1: { player: p1, ...(c1 ? { camera: cam } : {}) }, p2: { player: p2, ...(c2 ? { camera: cam } : {}) } };
            const mine = p1 === "me" ? "p1" : p2 === "me" ? "p2" : null;
            const first = c1 ? "p1" : c2 ? "p2" : null;
            const want = mine && seats[mine].camera ? { sid: mine, mine: true } : first ? { sid: first, mine: false } : null;
            expect(arrivalSeat(seats, "me"), JSON.stringify(seats)).toEqual(want);
            cases++;
          }
    expect(cases).toBe(36);
    expect(arrivalSeat({}, "me")).toBeNull();
  });

  it("not seated: watching from the first seat's view, writing nothing; sitting goes over it, and getting up comes back to it", async () => {
    vi.useFakeTimers();
    const t = await cockpit(SEATS0(), { views: [["C", "carol"]] });
    const before = JSON.stringify(t.w.doc.traits[SEATS]);
    expect(t.api.C.body.enter("seat", null)).toBe(true);
    expect(t.api.C.local.get().body).toMatchObject({ id: "seat", label: "Watching", depth: 1 });
    await t.step();
    expect(JSON.stringify(t.w.doc.traits[SEATS])).toBe(before);
    expect(t.claim("p1")).toBeNull();
    await t.pickSeat("C", "p2");
    expect(t.player("p2")).toBe("carol");
    expect(t.api.C.local.get().body).toMatchObject({ id: "seat", label: "Seated", depth: 2 });
    await t.pickSeat("C", "");
    expect(t.player("p2")).toBeNull();
    expect(t.api.C.local.get().body).toMatchObject({ id: "seat", label: "Watching", depth: 1 });
  });

  it("seated by the doc (back at the table): in your own seat's view, as sitting there", async () => {
    vi.useFakeTimers();
    const t = await cockpit({ ...SEATS0(), p2: { ...SEATS0().p2, player: BEN } }, { views: [["B", BEN]] });
    expect(t.api.B.body.enter("seat", null)).toBe(true);
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Seated", depth: 1 });
    await t.step();
    expect(t.claim("p2")).toMatchObject({ viewer: BEN });
    // standing up (Watching in the picker): watching from the first seat's view, as if
    // they'd arrived watching and sat (the boat and the room alike), writing nothing more
    await t.pickSeat("B", "");
    expect(t.player("p2")).toBeNull();
    expect(t.claim("p2")).toBeNull();
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Watching", depth: 1 });
    // sitting again goes over it, and getting up comes back to it
    await t.pickSeat("B", "p1");
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Seated", depth: 2 });
    await t.pickSeat("B", "");
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Watching", depth: 1 });
  });

  it("seated by the doc, moving to another seat and then up: watching (one Watching under the seat, never two)", async () => {
    vi.useFakeTimers();
    const t = await cockpit({ ...SEATS0(), p2: { ...SEATS0().p2, player: BEN } }, { views: [["B", BEN]] });
    expect(t.api.B.body.enter("seat", null)).toBe(true);
    await t.step();
    await t.pickSeat("B", "p1");
    expect(t.player("p1")).toBe(BEN);
    expect(t.player("p2")).toBeNull();
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Seated", depth: 2 });
    await t.pickSeat("B", "");
    expect(t.api.B.local.get().body).toMatchObject({ id: "seat", label: "Watching", depth: 1 });
  });

  it("seated by the doc, Leave (the stage's): Look, as Leave always falls back; nothing re-enters", async () => {
    vi.useFakeTimers();
    const t = await cockpit({ ...SEATS0(), p2: { ...SEATS0().p2, player: BEN } }, { views: [["B", BEN]] });
    expect(t.api.B.body.enter("seat", null)).toBe(true);
    await t.step();
    expect(t.api.B.body.leave()).toBe(true);
    await t.step();
    expect(t.api.B.local.get().body.id).toBe("look");
  });
});



// ─── an object's own seats ──────────────────────────────────────────────────

describe("an object's own seats (a machine's ports): its own, and held only while someone sits in them", () => {
  // The table (the doc's own seats p1, p2, on hand trays) and a cabinet m
  // with a knob on it. m's two seats are laid on m (lay(d, …, "m")), not
  // lasting, each a view of m's front in m's frame; their places are a strip
  // across m's front, given (`seatPlaces`) with `of: m`.
  const PORTS = "t.ports";
  const portPlaces = (snap) =>
    Object.entries(snap.objects).flatMap(([id, o]) => (o?.traits?.[PORTS] ? ["p1", "p2"].map((seat, i) => ({ seat, of: id, id, min: [i * 0.3 - 0.3, 0.8, 0.29], max: [i * 0.3, 1, 0.31] })) : []));
  const both = (snap) => [...seatPlaces(snap), ...portPlaces(snap)];
  const PORT_SEATS = {
    p1: { name: "Cab · P1", lasting: false, camera: { position: [-0.15, 1.2, 1.2], target: [0, 1.2, 0], in: "m" } },
    p2: { name: "Cab · P2", lasting: false, camera: { position: [0.15, 1.2, 1.2], target: [0, 1.2, 0], in: "m" } },
  };
  // the table's seats, each with a view
  const tableSeats = () => ({ p1: { name: "Player 1", player: null, camera: { position: [0, 1.2, 1], target: [0, 0, 0.5] } }, p2: { name: "Player 2", player: null, camera: { position: [0, 1.2, -1], target: [0, 0, -0.5] } } });
  function arcadeDoc() {
    const objs = { ...objects(), m: { name: "Cabinet", transform: T([2, 0, 0]), traits: { [PORTS]: true } }, knob: { name: "Knob", parent: "m", transform: T([0, 1, 0.3]) } };
    const d = sceneOf(objs, { [SEATS]: tableSeats() });
    lay(d, PORT_SEATS, "m");
    return d;
  }
  async function arcade(views = [["C", "carol"], ["D", "dan"]]) {
    const w = fakes.fakeWorld(arcadeDoc());
    const t = { w, api: {}, x: {} };
    t.step = async () => {
      for (let i = 0; i < 3; i++) {
        w.flush();
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    t.join = async (session, viewer) => {
      t.api[session] = w.join(session, { viewer, ext: "seats" });
      w.view(session).collected = { seatPlaces: both };
      t.x[session] = w.attach(session, Seats.create(t.api[session]));
      await t.step();
    };
    /** Attention on `id` (selected), or on nothing. */
    t.attend = async (session, id) => {
      t.api[session].local.swap((l) => ({ ...l, selected: id }));
      await t.step();
    };
    const sel = (session) => w.view(session).overlay.querySelector(".seats-pick");
    t.options = (session) => (sel(session).closest(".seats-bar").hidden ? null : [...sel(session).options].map((o) => o.textContent));
    t.pick = async (session, value) => {
      sel(session).value = value;
      sel(session).dispatchEvent(new Event("change"));
      await t.step();
    };
    t.portClaim = (sid, id = "m") => w.doc.objects[id]?.claims?.[KIND(sid)] ?? null;
    t.notices = (session) => w.view(session).notices.map((n) => n.text);
    t.body = (session) => t.api[session].local.get().body.id;
    /** Every seat's entry, the doc's own and every object's, as the doc has it. */
    t.seatsNow = () => JSON.stringify(allSeats(w.doc));
    for (const [s, v] of views) await t.join(s, v);
    return t;
  }

  it("the picker shows the seats of what has your attention: the cabinet's (or the cabinet's, for a thing on it), else the table's; nothing, hidden", async () => {
    const t = await arcade();
    const cab = ["Watching", "Cab · P1", "Cab · P2"];
    const table = ["Watching", "Player 1", "Player 2"];
    for (const [at, want] of [
      [null, null],
      ["m", cab],
      ["knob", cab],
      ["board", table],
      ["hand1", table],
      ["m", cab],
      [null, null],
    ]) {
      await t.attend("C", at);
      expect([at, t.options("C")]).toEqual([at, want]);
    }
    // the look and the selection, on different things: whichever is on something with seats of its own, the look first
    for (const [look, selected, want] of [
      ["board", "m", cab],
      ["m", "board", cab],
      ["knob", null, cab],
      ["board", null, table],
      ["board", "hand1", table],
    ]) {
      t.api.C.look = () => ({ id: look, point: null, distance: null });
      await t.attend("C", "hand2"); // (attention moves: the picker is drawn again)
      await t.attend("C", selected);
      expect([look, selected, t.options("C")]).toEqual([look, selected, want]);
    }
    t.w.done();
  });

  it("sitting at the cabinet: its claim, on the cabinet; nothing written; the table's seat stays yours, and the table's roster and parties never count the cabinet", async () => {
    const t = await arcade();
    await t.attend("C", "board");
    await t.pick("C", "p1");
    expect(t.w.doc.traits[SEATS].p1.player).toBe("carol");
    // seated, the picker is the seat's owner's, wherever attention is: up first (the seat stays hers)
    await t.attend("C", "m");
    expect(t.options("C")).toEqual(["Watching", "Player 1", "Player 2"]);
    t.api.C.body.leave();
    await t.attend("C", null);
    await t.attend("C", "m");
    const before = JSON.stringify(t.w.doc.objects.m.traits[SEATS]);
    await t.pick("C", "p1");
    expect(t.portClaim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(JSON.stringify(t.w.doc.objects.m.traits[SEATS])).toBe(before); // nothing written: the claim is the whole of it
    expect(t.w.doc.traits[SEATS].p1.player).toBe("carol"); // her hand at the table is still hers
    expect(t.x.C.roster.sitting()).toEqual({ of: "m", seat: "p1" });
    expect(t.body("C")).toBe("seat");
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["m"]);
    expect(t.options("C")).toEqual(["Watching", "Cab · P1", "Cab · P2"]);
    // the table's roster is the table's: the cabinet's seats are never its players
    const r = t.x.C.roster;
    const snap = t.w.scene();
    expect(r.seats(snap)).toEqual([{ id: "p1", name: "Player 1", viewer: "carol" }, { id: "p2", name: "Player 2", viewer: null }]);
    expect([r.viewers(snap), r.open(snap), r.nameOf(snap, "carol")]).toEqual([["carol"], ["Player 2"], "Player 1"]);
    expect(t.x.C.parties(snap)("anything")).toEqual(["carol"]);
    // Dan, at the cabinet: P1 is taken, and stays Carol's while she's here
    await t.attend("D", "m");
    expect(t.options("D")).toEqual(["Watching", "Cab · P1 (taken)", "Cab · P2"]);
    await t.pick("D", "p1");
    expect(t.notices("D").at(-1)).toBe("Someone is sitting there.");
    expect(t.portClaim("p1").session).toBe("C");
    // name tags: one on each of the cabinet's places, and the table's
    const tags = Object.fromEntries(t.w.view("D").labels.map((l) => [l.key, l.text]));
    expect(tags).toEqual({ hand1: "Player 1 · someone", hand2: "Player 2 · free", "m:p1": "Cab · P1 · someone", "m:p2": "Cab · P2 · free" });
    t.w.done();
  });

  // Every way Carol can stop sitting at the cabinet's P1. After each, P1 is
  // free for Dan (never "away": nobody asks him to take over), no seat entry
  // anywhere changed, and Carol sits where the way put her (nowhere, the
  // table's p1, or the cabinet's P2). Leaving, she comes back to nothing.
  const WAYS = ["stand up", "the chip's Leave", "watching", "the table", "the other port", "leaving", "a crash", "the cabinet removed"];
  for (const way of WAYS)
    it(`up from the cabinet by ${way}: P1 is free, and nothing was ever written`, async () => {
      const t = await arcade();
      await t.attend("C", "m");
      await t.pick("C", "p1");
      expect(t.portClaim("p1")?.session).toBe("C");
      const seatsBefore = t.seatsNow();
      switch (way) {
        case "stand up": {
          const cmd = t.x.C.commands.find((c) => c.id === "seat");
          const ctx = { scene: t.api.C.scene(), local: t.api.C.local.get(), from: null, hit: { id: "m", point: null, distance: null } };
          expect(cmd.state("m", ctx)).toEqual({ label: "Stand up", title: "Get up from Cab · P1" });
          cmd.run("m", undefined, ctx);
          break;
        }
        case "the chip's Leave":
          t.api.C.body.leave();
          break;
        case "watching":
          await t.pick("C", "");
          break;
        case "the table":
          await t.attend("C", null); // (seated at the cabinet, the picker is the cabinet's: up first, then the table's)
          t.api.C.body.leave();
          await t.attend("C", "board");
          await t.pick("C", "p1");
          break;
        case "the other port":
          await t.pick("C", "p2");
          break;
        case "leaving":
          t.w.leave("C");
          break;
        case "a crash":
          t.w.leave("C", { bye: false });
          t.w.grace = false;
          await vi.advanceTimersByTimeAsync(6500);
          break;
        case "the cabinet removed":
          t.w.change((d) => {
            delete d.objects.m;
            delete d.objects.knob;
            d.order = d.order.filter((id) => id !== "m" && id !== "knob");
          });
          break;
      }
      await t.step();
      const removed = way === "the cabinet removed";
      const gone = way === "leaving" || way === "a crash";
      // nothing written to any seat, by any of it (the table's p1 is Carol's only when she sat there)
      if (way === "the table") expect(t.w.doc.traits[SEATS].p1.player).toBe("carol");
      else if (!removed) expect(t.seatsNow()).toBe(seatsBefore);
      else expect(t.seatsNow()).toBe(JSON.stringify(allSeats({ traits: { [SEATS]: tableSeats() } })));
      // where Carol sits now
      if (!gone) expect(t.x.C.roster.sitting()).toEqual(way === "the table" ? { of: null, seat: "p1" } : way === "the other port" ? { of: "m", seat: "p2" } : null);
      if (!gone && way !== "the table" && way !== "the other port") expect(t.body("C")).toBe("look");
      // P1 is free for Dan, and his to take; or, removed, the cabinet's seats are nowhere
      await t.attend("D", removed ? null : "m");
      await t.attend("D", removed ? "board" : "m");
      if (removed) {
        expect(t.options("D")).toEqual(["Watching", "Player 1", "Player 2"]);
        expect(t.w.view("D").labels.map((l) => l.key)).toEqual(["hand1", "hand2"]);
        expect(t.x.C.roster.sitting()).toBeNull();
      } else {
        expect(t.options("D")[1]).toBe("Cab · P1");
        await t.pick("D", "p1");
        expect(t.portClaim("p1")).toEqual({ viewer: "dan", session: "D" });
        expect(t.x.D.roster.sitting()).toEqual({ of: "m", seat: "p1" });
      }
      // gone and back (a new session, the same viewer): nothing to come back to
      if (gone) {
        await t.join("C2", "carol");
        await t.attend("C2", "m");
        expect(t.options("C2")[1]).toBe("Cab · P1 (taken)");
        expect(t.x.C2.roster.sitting()).toBeNull();
        expect(t.portClaim("p1").session).toBe("D");
      }
      t.w.done();
    });

  // The roster's stateOf and sit, for another package (a machine's Play):
  // every state a seat can be in for Carol, on both owners (the table's
  // lasting seats, the cabinet's that don't last), and every way of naming
  // no seat. A free seat (or her own, or her other tab's) is sat in as the
  // picker sits her; taken, away or none is refused, and nothing is said,
  // written or claimed.
  const ROSTER_CASES = [
    // [name, ref, setup(t), state before, sits]
    ["the cabinet's free P1", { of: "m", seat: "p1" }, async () => {}, "free", true],
    ["the table's free P1", { of: null, seat: "p1" }, async () => {}, "free", true],
    ["the cabinet's P1, hers already", { of: "m", seat: "p1" }, async (t) => (await t.attend("C", "m"), await t.pick("C", "p1")), "mine", true],
    ["the table's P1, hers already", { of: null, seat: "p1" }, async (t) => (await t.attend("C", "board"), await t.pick("C", "p1")), "mine", true],
    ["the table's P1, held by her other tab", { of: null, seat: "p1" }, async (t) => (await t.join("C2", "carol"), await t.attend("C2", "board"), await t.pick("C2", "p1")), "mine-elsewhere", true],
    ["the cabinet's P1, Dan's", { of: "m", seat: "p1" }, async (t) => (await t.attend("D", "m"), await t.pick("D", "p1")), "taken", false],
    ["the table's P1, Dan's", { of: null, seat: "p1" }, async (t) => (await t.attend("D", "board"), await t.pick("D", "p1")), "taken", false],
    ["the table's P2, Bob's while he's away", { of: null, seat: "p2" }, async (t) => (t.w.change((d) => void (d.traits[SEATS].p2.player = "bob")), await t.step()), "away", false],
    ["the table's P2, with no view", { of: null, seat: "p2" }, async (t) => (t.w.change((d) => void delete d.traits[SEATS].p2.camera), await t.step()), "free", true],
    ["a seat the cabinet hasn't", { of: "m", seat: "p9" }, async () => {}, null, false],
    ["a seat of an object that isn't there", { of: "gone", seat: "p1" }, async () => {}, null, false],
    ["a seat of an object with none", { of: "board", seat: "p1" }, async () => {}, null, false],
    ["nothing", null, async () => {}, null, false],
    ["no seat named", { of: "m" }, async () => {}, null, false],
    ["an empty seat id", { of: "m", seat: "" }, async () => {}, null, false],
    ["an owner that isn't an id", { of: 5, seat: "p1" }, async () => {}, null, false],
  ];
  for (const [name, ref, setup, before, sits] of ROSTER_CASES)
    it(`the roster's stateOf and sit, for another package: ${name}`, async () => {
      const t = await arcade();
      await setup(t);
      const r = t.x.C.roster;
      expect(r.stateOf(ref)).toBe(before);
      const seatsBefore = t.seatsNow();
      const claimsBefore = JSON.stringify([t.w.doc.claims ?? null, t.w.doc.objects.m.claims ?? null]);
      const sittingBefore = r.sitting();
      const notices = t.notices("C").length;
      const got = r.sit(ref);
      await t.step();
      expect(got).toBe(sits);
      if (sits) {
        // as the picker sits her: in that seat's body (a seat with no view: none, where she was), its claim hers, and (a lasting seat) her name on it
        const view = !!(ref.of ? t.w.doc.objects[ref.of] : t.w.doc).traits[SEATS][ref.seat].camera;
        expect(r.sitting()).toEqual(view ? { of: ref.of, seat: ref.seat } : null);
        expect(t.body("C")).toBe(view ? "seat" : "look");
        expect(r.stateOf(ref)).toBe(before === "mine-elsewhere" ? "mine-elsewhere" : "mine");
        if (ref.of === null) expect(t.w.doc.traits[SEATS][ref.seat].player).toBe("carol");
        else expect(t.portClaim(ref.seat)).toEqual({ viewer: "carol", session: "C" });
        // the notice is the picker's, said once, and only for a seat she wasn't in already
        expect(t.notices("C").slice(notices)).toEqual(before === "free" ? [`You sat down as ${ref.of ? "Cab · P" : "Player "}${ref.seat.slice(1)}`] : []);
      } else {
        // refused: nothing said, written or claimed, and she sits where she sat
        expect(t.notices("C").length).toBe(notices);
        expect(t.seatsNow()).toBe(seatsBefore);
        expect(JSON.stringify([t.w.doc.claims ?? null, t.w.doc.objects.m.claims ?? null])).toBe(claimsBefore);
        expect(r.sitting()).toEqual(sittingBefore);
        expect(r.stateOf(ref)).toBe(before);
      }
      t.w.done();
    });

  it("a copy of the cabinet has seats of its own: sitting at one's P1 is nothing to the other's", async () => {
    const t = await arcade();
    t.w.change((d) => {
      const { claims, ...rest } = structuredClone(d.objects.m);
      d.objects.m2 = { ...rest, transform: T([4, 0, 0]) };
      d.order.push("m2");
    });
    await t.step();
    await t.attend("C", "m");
    await t.pick("C", "p1");
    await t.attend("D", "m2");
    expect(t.options("D")).toEqual(["Watching", "Cab · P1", "Cab · P2"]);
    await t.pick("D", "p1");
    expect([t.portClaim("p1", "m")?.session, t.portClaim("p1", "m2")?.session]).toEqual(["C", "D"]);
    expect([t.x.C.roster.sitting(), t.x.D.roster.sitting()]).toEqual([{ of: "m", seat: "p1" }, { of: "m2", seat: "p1" }]);
    // removing one takes its seats with it, and leaves the other's
    t.w.change((d) => {
      delete d.objects.m;
      d.order = d.order.filter((id) => id !== "m");
    });
    await t.step();
    expect(t.x.C.roster.sitting()).toBeNull();
    expect(t.x.D.roster.sitting()).toEqual({ of: "m2", seat: "p1" });
    expect(t.portClaim("p1", "m2")?.session).toBe("D");
    t.w.done();
  });

  it("seatState for a seat that doesn't last: its claim alone says (your other tab's is that tab's); never away", () => {
    const by = (viewer, mine = false) => ({ viewer, session: `s-${viewer}`, mine });
    let cases = 0;
    for (const keeps of [true, false])
      for (const player of [null, "a", "b"])
        for (const b of [null, by("a", true), by("a"), by("b"), by(null)]) {
          const seat = { name: "S", player, ...(keeps ? {} : { lasting: false }) };
          const got = seatState(seat, b, "a");
          if (keeps) expect(got).toBe(seatState({ name: "S", player }, b, "a")); // as ever
          else expect(got).toBe(b ? (b.mine ? "mine" : "taken") : "free");
          cases++;
        }
    expect(cases).toBe(30);
  });

  it("the roster, mySeat and lay over owners: the doc's own seats are the table's; an object's are laid on it, and only where it is", () => {
    const snap = arcadeDoc();
    snap.objects.m.traits[SEATS].p1.player = "carol"; // (a player written on a seat that doesn't last is no one)
    expect(rosterOf(snap).map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(rosterOf({ traits: { [SEATS]: { p1: { name: "P", player: "carol", lasting: false } } } })).toEqual([{ id: "p1", name: "P", viewer: null }]);
    expect(mySeat(snap, "carol")).toBeNull();
    snap.objects.m.traits[SEATS].p2.lasting = true;
    snap.objects.m.traits[SEATS].p2.player = "carol";
    expect(mySeat(snap, "carol")).toEqual({ of: "m", seat: "p2" });
    expect(allSeats(snap).map(({ of, seat }) => [of, seat])).toEqual([[null, "p1"], [null, "p2"], ["m", "p1"], ["m", "p2"]]);
    // lay on an object: on it; on one that isn't there: nothing; laid again: lasting as said now
    const d = { traits: {}, objects: { m: {} } };
    lay(d, { p1: { name: "P1", lasting: false } }, "m");
    lay(d, { p1: { name: "P1" } }, "gone");
    expect(d).toEqual({ traits: {}, objects: { m: { traits: { [SEATS]: { p1: { name: "P1", player: null, lasting: false } } } } } });
    lay(d, { p1: { name: "P1" } }, "m");
    expect(d.objects.m.traits[SEATS].p1).toEqual({ name: "P1", player: null });
    lay(d, { p1: { name: "P1", lasting: false } }, "m");
    expect(d.objects.m.traits[SEATS].p1).toEqual({ name: "P1", player: null, lasting: false });
  });
});
