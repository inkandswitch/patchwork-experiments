// A seat as a station (seat-verbs.js, extension.js): walk up to a seat in
// first person and F sits you there, as the picker would; seated, F at your
// place stands you up into first person; and the hand-off between the two.
import { afterEach, describe, it, expect, vi } from "vitest";
import { HIDDEN, SEATS, ZONE } from "./visibility.js";
import Extension from "./extension.js";
import { BENCH_RADIUS, CONFIRM_MS, SEAT_REACH, seatLookedAt, seatVerb } from "./seat-verbs.js";
import { apply } from "./frame.js";
import * as fakes from "../test/fakes.js";

afterEach(() => vi.useRealTimers());

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const ANA = "automerge:2AnaAnaAnaAnaAnaAnaAnaAna1";
const BEN = "automerge:2BenBenBenBenBenBenBenBen1";
const KIND = (sid) => `tabletop.seat:${sid}`;
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.065], max: [0.3, 0.15, 0.065] } });
const near = (got, want, digits = 6) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));

// a ship turned and heeled, a table across her cockpit, a tray at each end, each seat's eye over its bench
const SHIP = T([10, 0, 5], [0.12, 0.7, -0.08]);
const seatCam = (z) => ({ position: [0, 1.2, z], target: [0, 0.7, z * 0.17], in: "tbl" });
const SEATS0 = () => ({ p1: { name: "Player 1", player: null, camera: seatCam(0.95) }, p2: { name: "Player 2", player: null, camera: seatCam(-0.95) } });
function doc(seats = SEATS0(), claims) {
  return {
    objects: {
      ship: { name: "Ship", transform: SHIP },
      tbl: { name: "Card table", parent: "ship", transform: T([0, 0, 2.85], [0, Math.PI / 2, 0]), locked: true },
      hand1: { name: "Hand 1", parent: "tbl", transform: T([0, 0.7, 0.5]), traits: zone("p1"), locked: true },
      hand2: { name: "Hand 2", parent: "tbl", transform: T([0, 0.7, -0.5], [0, Math.PI, 0]), traits: zone("p2"), locked: true },
      card: { name: "Card", parent: "tbl", transform: T([0.1, 0.702, 0.5]), traits: { [HIDDEN]: { by: DECK } }, tags: ["card"] },
      pawn: { name: "Pawn", parent: "tbl", transform: T([0.35, 0.7, 0.55]) },
    },
    traits: { [SEATS]: seats },
    ...(claims ? { claims } : {}),
  };
}

/** The table, and views on it: each [session, viewer, { walking }]. */
async function room(seats, { claims, views = [] } = {}) {
  const repo = fakes.fakeRepo();
  repo.add({ name: "Ana" }, ANA);
  repo.add({ name: "Ben" }, BEN);
  repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: {} }, DECK);
  const w = fakes.fakeWorld(doc(seats, claims), { repo });
  const t = { w, api: {}, x: {}, walker: {} };
  const step = async () => {
    for (let i = 0; i < 3; i++) {
      w.flush();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  t.step = step;
  t.join = async (session, viewer, { walking = false, walker = true } = {}) => {
    const api = (t.api[session] = w.join(session, { viewer, local: walking ? { immersive: true } : {} }));
    // what walks: sailing's crew, as far as a table knows it (firstPerson on its instance)
    if (walker) {
      const fp = (t.walker[session] = {
        enter: vi.fn(() => {
          api.local.swap((l) => ({ ...l, immersive: true }));
          return true;
        }),
        leave: vi.fn(() => api.local.swap((l) => ({ ...l, immersive: false }))),
      });
      w.view(session).collected = { firstPerson: fp };
    }
    t.x[session] = w.attach(session, Extension.create(api));
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
  const w = fakes.fakeWorld(doc());
  const snap = w.scene();
  const seats = SEATS0();
  const drawn = (id) => w.scene().world(id);
  const tbl = (p) => apply(snap.world("tbl"), p);
  const from = tbl([0.3, 1.5, 1.1]);
  const at = (target, point, f = from) => seatLookedAt({ snap, target, point, from: f, seats, drawn });
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
    const t = await room(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
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
    const t = await room(SEATS0(), { views: [["C", "carol", { walking: true }]] });
    const api = t.api.C;
    expect(t.cmd("C").state("hand1", { scene: api.scene(), local: api.local.get() })).toBeNull();
    expect(t.look("C", "card", t.at([0.1, 0.703, 0.5]))).toBeNull();
    api.local.swap((l) => ({ ...l, activities: { current: "edit", available: ["play", "edit"] } }));
    expect(t.look("C", "hand1")).toBeNull();
    t.w.done();
  });

  it("a present player's seat is refused, as the picker refuses it: greyed out, and nothing written", async () => {
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: BEN } }, { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol", { walking: true }]] });
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
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: BEN } }, { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol", { walking: true }]] });
    t.w.grace = false;
    await vi.advanceTimersByTimeAsync(6500);
    await t.step();
    expect(t.look("C", "hand1")).toMatchObject({ label: "Sit as Player 1 (Ben is away)" });
    await t.press("C", "hand1");
    expect(t.notices("C")).toEqual(["Ben is away. Press F again to take their seat; you'll see their hand."]);
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
    const t = await room(SEATS0(), { views: [["B", BEN, { walking: true }], ["C", "carol", { walking: true }]] });
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
    const t = await room(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
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
    const t = await room(SEATS0(), { views: [["B", BEN], ["C", "carol", { walking: true }]] });
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
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walking: true }]] });
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
    const t = await room(SEATS0(), { views: [["C", "carol", { walking: true, walker: false }]] });
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
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
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
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol", { walker: false }]] });
    expect(t.look("C", "hand1", null, t.at([0, 1.2, 0.95]))).toBeNull();
    const u = await room({ p1: { name: "Player 1", player: "dan" }, p2: { name: "Player 2", player: null } }, { views: [["D", "dan"]] });
    expect(u.look("D", "hand1", null, u.at([0, 1.2, 0.95]))).toBeNull();
    u.w.done();
  });

  it("whatever walks can't: the seat's view stays", async () => {
    const t = await room({ ...SEATS0(), p1: { ...SEATS0().p1, player: "carol" } }, { views: [["C", "carol"]] });
    await t.pickSeat("C", "p1");
    t.walker.C.enter.mockReturnValue(false);
    await t.press("C", "hand1", null, t.at([0, 1.2, 0.95]));
    expect(t.w.view("C").rides.map((r) => r.id)).toEqual(["tbl"]);
    expect(t.notices("C").filter((n) => /got up/.test(n))).toEqual([]);
    t.w.done();
  });
});
