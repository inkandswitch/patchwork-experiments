// scene.seats (seats.js, seats-model.js): seats held by claims, the picker,
// name tags on the places others give a seat, the seat's view (through the
// object its camera is in, riding it), a seat as a station on the use prompt,
// what it tells the others, and the roster it contributes. On the fake world
// (test/fake-world.js): several views, sessions never heard from, crashes
// without a bye, and merges written by hand.
import { afterEach, describe, it, expect, vi } from "vitest";
import Seats from "./seats.js";
import { BENCH_RADIUS, CONFIRM_MS, SEATS, SEAT_REACH, cleanPlaces, lay, rosterOf, seatLookedAt, seatOf, seatState, seatTagAt, seatVerb, seatsOf } from "./seats-model.js";
import { applyMatrix as apply } from "../transform.js";
import * as fakes from "../test/fake-world.js";
import { emptyScene } from "../test/empty-scene.js";
import { plugins } from "../index.js";

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
  const api = w.join(session, { viewer, local, ext: "scene.seats" });
  w.view(session).collected = { seatPlaces, ...collected };
  return { api, x: w.attach(session, Seats.create(api)) };
};
const KIND = (sid) => `scene.seat:${sid}`;
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
  t.join = async (session, viewer, { walking = false, walker = true } = {}) => {
    const api = (t.api[session] = w.join(session, { viewer, local: walking ? { immersive: true } : {}, ext: "scene.seats" }));
    // what walks: sailing's crew, as far as a table knows it (firstPerson on its instance)
    if (walker) {
      const fp = (t.walker[session] = {
        enter: vi.fn(() => {
          api.local.swap((l) => ({ ...l, immersive: true }));
          return true;
        }),
        leave: vi.fn(() => api.local.swap((l) => ({ ...l, immersive: false }))),
      });
      w.view(session).collected = { seatPlaces, firstPerson: fp };
    } else w.view(session).collected = { seatPlaces };
    t.x[session] = w.attach(session, Seats.create(api));
    await step();
  };
  /** The use prompt in `session`, looking at `id` (at `point`, world) from `from`: the seat verb's state. */
  t.look = (session, id, point = null, from = t.eye(session)) => {
    const api = t.api[session];
    const ctx = { scene: api.scene(), local: api.local.get(), from, hit: { id, point, distance: null } };
    return t.cmd(session).state(id, ctx);
  };
  /** As the prompt does on F: state, then run. */
  t.press = async (session, id, point = null, from = t.eye(session)) => {
    const st = t.look(session, id, point, from);
    if (st && !st.disabled) t.cmd(session).run(id);
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
  const at = (target, point, f = from) => seatLookedAt({ snap, target, point, from: f, seats, places: cleanPlaces(seatPlaces(snap), snap.objects), drawn });
  afterEach(() => w.done?.());

  it("a tray: its seat, with or without a point; out of reach, none", () => {
    expect(at("hand1", null)).toBe("p1");
    expect(at("hand1", tbl([0.1, 0.7, 0.5]))).toBe("p1");
    expect(at("hand2", tbl([0, 0.7, -0.5]), tbl([0, 1.5, -1.1]))).toBe("p2");
    const far = tbl([0, 1.5, 1.1 + SEAT_REACH + 0.6]);
    expect(at("hand1", null, far)).toBeNull();
    // the prompt alone: no eye, nothing
    expect(seatLookedAt({ snap, target: "hand1", point: null, from: null, seats, drawn })).toBeNull();
  });

  it("the table just past a tray's edge, and the bench under a seat's eye, aboard a heeled ship", () => {
    expect(at("tbl", tbl([0.2, 0.7, 0.6]))).toBe("p1"); // the table's edge by the tray
    expect(at("tbl", tbl([0, 0.7, 0.05]))).toBeNull(); // the middle of the table: nobody's
    expect(at("ship", tbl([0.1, 0.45, 0.95 + BENCH_RADIUS * 0.6]))).toBe("p1"); // the bench, part of her hull
    expect(at("ship", tbl([0.1, 0.45, 0.95 + BENCH_RADIUS * 1.5]))).toBeNull(); // past it
    expect(at("ship", tbl([0, 0.45, -0.95]), tbl([0, 1.5, -1.2]))).toBe("p2");
  });

  it("never a loose piece (F over it is the hand's), nor anything unlocked that isn't a seat's frame", () => {
    expect(at("card", tbl([0.1, 0.703, 0.5]))).toBeNull();
    expect(at("pawn", tbl([0.35, 0.72, 0.55]))).toBeNull();
  });

  it("the seat verb: refused, asked, yours, free; standing only seated, with something to walk in", () => {
    const v = (state, o = {}) => seatVerb({ name: "Player 1", state, who: "Ben", immersive: true, canStand: false, confirming: false, ...o });
    expect(v("taken")).toEqual({ verb: "sit", label: "Ben is sitting there", disabled: true });
    expect(v("away")).toMatchObject({ verb: "confirm", label: "Sit as Player 1 (Ben is away)" });
    expect(v("away", { confirming: true })).toMatchObject({ verb: "sit", label: "Take Player 1: F again" });
    expect(v("mine")).toMatchObject({ verb: "sit", label: "Back to your seat" });
    expect(v("free")).toMatchObject({ verb: "sit", label: "Sit as Player 1" });
    expect(v("mine-elsewhere")).toMatchObject({ verb: "sit", label: "Sit as Player 1" });
    expect(v("mine", { immersive: false, canStand: true })).toMatchObject({ verb: "stand", label: "Stand up" });
    expect(v("mine", { immersive: false, canStand: false })).toBeNull();
    for (const s of ["free", "taken", "away", "mine-elsewhere"]) expect(v(s, { immersive: false, canStand: true })).toBeNull();
  });
});

describe("sitting down from first person", () => {
  it("F at a free seat: the picker's sit (claim, player, notices), then out of first person and into its view", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toEqual({ label: "Sit as Player 1", title: expect.any(String) });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(t.notices("C")).toContain("You sat down as Player 1");
    expect(t.notices("B")).toContain("Someone sat down as Player 1");
    expect(t.w.sent.filter((s) => s.type === "sat")).toEqual([{ session: "C", viewer: "carol", type: "sat", data: { seat: "p1" } }]);
    // handed over: whatever walks was asked to stop, and the seat's view took the camera when it did
    expect(t.walker.C.leave).toHaveBeenCalledOnce();
    expect(t.api.C.local.get().immersive).toBe(false);
    near(t.w.view("C").camera.position, t.at([0, 1.2, 0.95]));
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    // seated now, out of first person: the place offers standing up, not sitting
    expect(t.look("C", "hand1", null, t.at([0, 1.2, 0.95]))).toMatchObject({ label: "Stand up" });
    expect(t.look("C", "hand2", null, t.at([0, 1.2, 0.95]))).toBeNull();
    t.w.done();
  });

  it("only from the prompt, in play: no eye (the key map, the menu), editing, or a loose piece, and it isn't offered", async () => {
    const t = await cockpit(SEATS0(), { views: [["C", "carol", { walking: true }]] });
    const api = t.api.C;
    expect(t.cmd("C").state("hand1", { scene: api.scene(), local: api.local.get() })).toBeNull();
    expect(t.look("C", "card", t.at([0.1, 0.703, 0.5]))).toBeNull();
    api.local.swap((l) => ({ ...l, activities: { current: "edit", available: ["play", "edit"] } }));
    expect(t.look("C", "hand1")).toBeNull();
    t.w.done();
  });

  it("a present player's seat is refused, as the picker refuses it: greyed out, and nothing written", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: BEN } }, { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toEqual({ label: "Ben is sitting there", disabled: true });
    const writes = vi.spyOn(t.api.C, "change");
    // a press the prompt didn't stop (it raced the claim): told, nothing written
    t.look("C", "hand1");
    t.cmd("C").run("hand1");
    await t.step();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(writes).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe(BEN);
    expect(t.walker.C.leave).not.toHaveBeenCalled();
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
    expect(t.walker.C.leave).toHaveBeenCalledOnce();
    t.w.done();
  });

  it("two walking up to one seat at once: the one whose claim lost the merge is told, and writes nothing more", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN, { walking: true }], ["C", "carol", { walking: true }]] });
    // both see it free, and press together: Carol's write lands first here
    expect(t.look("B", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    t.cmd("C").run("hand1");
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
    // she was handed over to the seat's view, and is put back on her feet there
    expect(t.walker.C.leave).toHaveBeenCalledOnce();
    expect(t.walker.C.enter).toHaveBeenCalledOnce();
    expect(t.walker.C.enter.mock.calls[0][0].seat).toBe("p1");
    expect(t.api.C.local.get().immersive).toBe(true);
    expect(t.look("C", "hand1")).toMatchObject({ label: "Ben is sitting there", disabled: true });
    t.w.done();
  });

  it("sat from first person once, later from the picker: losing that race leaves you watching, not on your feet", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.api.C.local.get().immersive).toBe(false);
    // up out of it by the picker, and back to it the same way, as Ben takes it too
    await t.pickSeat("C", "");
    expect(t.player("p1")).toBe(null);
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
    // she sat from the picker this time: nothing puts her in first person
    expect(t.walker.C.enter).not.toHaveBeenCalled();
    expect(t.api.C.local.get().immersive).toBe(false);
    t.w.done();
  });

  it("a press after someone sat meanwhile (the prompt's state was stale): refused at run", async () => {
    const t = await cockpit(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1" });
    t.w.change((d) => {
      d.claims = { [KIND("p1")]: { viewer: BEN, session: "B" } };
      d.traits[SEATS].p1.player = BEN;
    });
    t.cmd("C").run("hand1");
    await t.step();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(t.player("p1")).toBe(BEN);
    expect(t.walker.C.leave).not.toHaveBeenCalled();
    t.w.done();
  });

  it("your own seat, after getting up: back to it; another seat: you move", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walking: true }]] });
    expect(t.claim("p1")?.session).toBe("C");
    expect(t.look("C", "hand1")).toMatchObject({ label: "Back to your seat" });
    const sent = t.w.sent.length;
    await t.press("C", "hand1");
    expect(t.w.sent.length).toBe(sent); // nothing to tell: she was sitting there
    expect(t.walker.C.leave).toHaveBeenCalledOnce();
    t.walker.C.enter();
    await t.step();
    await t.press("C", "hand2", null, t.at([0, 1.5, -1.1]));
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "carol"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "C"]);
    t.w.done();
  });

  it("with nothing that walks to hand over to: seated, and told how to get there", async () => {
    const t = await cockpit(SEATS0(), { views: [["C", "carol", { walking: true, walker: false }]] });
    await t.press("C", "hand1");
    expect(t.player("p1")).toBe("carol");
    expect(t.notices("C")).toContain("Leave first person (Esc) to take your seat.");
    // first person ends some other way: in the seat's view
    t.api.C.local.swap((l) => ({ ...l, immersive: false }));
    await t.step();
    near(t.w.view("C").camera.position, t.at([0, 1.2, 0.95]));
    t.w.done();
  });
});

describe("standing up", () => {
  it("F at your place: on your feet at the seat in first person, the seat still yours; back out, back in it", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
    await t.pickSeat("C", "p1"); // (in the seat's view)
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    const eye = t.at([0, 1.2, 0.95]);
    expect(t.look("C", "hand1", null, eye)).toMatchObject({ label: "Stand up" });
    const writes = vi.spyOn(t.api.C, "change");
    await t.press("C", "hand1", null, eye);
    expect(t.walker.C.enter).toHaveBeenCalledOnce();
    const spot = t.walker.C.enter.mock.calls[0][0];
    expect(spot.seat).toBe("p1");
    expect(spot.frame).toBe("tbl");
    near(spot.eye, eye);
    near(spot.target, t.at([0, 0.7, 0.95 * 0.17]));
    expect(writes).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")?.session).toBe("C");
    expect(t.notices("C")).toContain("You got up from Player 1; it's still yours.");
    expect(t.w.view("C").rides).toEqual([]);
    // walking now: the place offers sitting back down
    expect(t.look("C", "hand1")).toMatchObject({ label: "Back to your seat" });
    // first person ends (Esc): back in the seat's view
    t.walker.C.leave();
    await t.step();
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    t.w.done();
  });

  it("not offered with nothing to walk in (the picker is the way out), nor at a seat with no view", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walker: false }]] });
    expect(t.look("C", "hand1", null, t.at([0, 1.2, 0.95]))).toBeNull();
    const u = await cockpit({ p1: { name: "Player 1", player: "dan" }, p2: { name: "Player 2", player: null } }, { views: [["D", "dan"]] });
    expect(u.look("D", "hand1", null, u.at([0, 1.2, 0.95]))).toBeNull();
    u.w.done();
  });

  it("whatever walks can't: the seat's view stays", async () => {
    const t = await cockpit({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
    await t.pickSeat("C", "p1");
    t.walker.C.enter.mockReturnValue(false);
    await t.press("C", "hand1", null, t.at([0, 1.2, 0.95]));
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    expect(t.notices("C").filter((n) => /got up/.test(n))).toEqual([]);
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

  it("a seat whose camera is in no frame is set once, and rides nothing", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "Player 2", player: null } } });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("in first person, waits until it ends; and whoever is seated is put back in their seat when it does", async () => {
    const t = await aboard({ local: { immersive: true } });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toBe(null); // the walker has the camera
    expect(t.w.view("A").rides).toEqual([]);
    t.a.local.swap((m) => ({ ...m, immersive: false }));
    t.w.flush();
    near(t.w.view("A").camera.position, apply(t.a.worldOf("tbl"), [0, 1.2, 0.95]));
    expect(t.w.view("A").rides).toHaveLength(1);
    // walks again (Enter), and the walker leaves the camera off her quarter
    t.a.local.swap((m) => ({ ...m, immersive: true }));
    t.w.flush();
    t.a.camera.set({ position: [30, 6, 30], target: [0, 2, 0] });
    t.a.local.swap((m) => ({ ...m, immersive: false }));
    t.w.flush();
    near(t.w.view("A").camera.position, apply(t.a.worldOf("tbl"), [0, 1.2, 0.95]));
    expect(t.w.view("A").rides).toHaveLength(1);
    t.w.done();
  });
});

describe("name tags aboard", () => {
  it("name tags lie on the hands as drawn, at the edge nearest each seat, and follow them each frame in play", async () => {
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
  it("writes them empty where the scene has none, and only there", () => {
    const d = { traits: {}, objects: {} };
    expect(lay(d, { p1: { name: "Player 1", camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: {} })).toBe(true);
    expect(d.traits[SEATS]).toEqual({ p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "p2", player: null } });
    d.traits[SEATS].p1.player = "ann";
    expect(lay(d, { p1: { name: "Other" }, p3: { name: "Third" } })).toBe(false);
    expect(d.traits[SEATS].p1).toMatchObject({ name: "Player 1", player: "ann" });
    expect(d.traits[SEATS].p3).toBeUndefined();
    // no seats to write: no map made
    const e = { traits: {}, objects: {} };
    expect(lay(e, {})).toBe(false);
    expect(e.traits).toEqual({});
  });

  it("a seat there whose view is in a frame that's gone takes the new view; one whose frame is there keeps its own", () => {
    const d = { objects: { tbl: {} }, traits: { [SEATS]: { p1: { name: "P1", player: "ann", camera: { position: [0, 1, 1], in: "gone" } }, p2: { name: "P2", player: null, camera: { position: [0, 1, -1], in: "tbl" } } } } };
    lay(d, { p1: { camera: { position: [5, 1, 1], in: "tbl" } }, p2: { camera: { position: [9, 9, 9], in: "tbl" } } });
    expect(d.traits[SEATS].p1).toEqual({ name: "P1", player: "ann", camera: { position: [5, 1, 1], in: "tbl" } });
    expect(d.traits[SEATS].p2.camera.position).toEqual([0, 1, -1]);
  });

  it("the plugin says where to find it: `roster: true`, its trait described, in every activity", async () => {
    const p = plugins.find((x) => x.id === "scene.seats");
    expect(p).toMatchObject({ type: "scene:extension", roster: true, traits: [SEATS] });
    // no `activities`: who sits where is read while editing too, and by whatever else is being done
    expect(p.activities).toBeUndefined();
    expect(p.describes[SEATS].entries.init).toEqual({ player: null });
    expect(() => structuredClone({ ...p, load: undefined })).not.toThrow();
    const mod = await p.load();
    expect(typeof mod.create).toBe("function");
    expect(mod.lay).toBe(lay);
  });

  it("places: only well-formed ones on objects that are there", () => {
    const objects = { tray: {} };
    expect(cleanPlaces([{ seat: "p1", id: "tray", min: [0, 0, 0], max: ["1", 1, 1] }, { seat: "p1", id: "gone", min: [0, 0, 0], max: [1, 1, 1] }, { seat: 3, id: "tray", min: [], max: [] }, null, { seat: "p1", id: "tray" }], objects)).toEqual([{ seat: "p1", id: "tray", min: [0, 0, 0], max: [1, 1, 1] }]);
  });
});
