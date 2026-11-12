// The dice extension against a fake stage (test/fakes.js): two views of one
// doc, each with its own api. What a die is comes from what the stage says
// it built (api.content(id).extras.dice), as in a real scene. Every roll's
// seed comes from lots, which here is scripted (what api.collect("dice.lots")
// gives each view: the draws asked, and a state the test sets); the real
// lots are tested on their own (lots.test.js, lots-ext.test.js) and with
// this extension in the probes.
import { afterEach, describe, it, expect, vi } from "vitest";
import Extension, { LAND_GRACE_MS, MAX_THROWN, MESSAGES, THROW_MS, TOLD_MS, TRUST_MS } from "./extension.js";
import { DIE, PROVIDER } from "./ids.js";
import { PRESETS, dieOf } from "./die.js";
import { builtDie } from "./die-glb.js";
import { eulerMatrix, matrixEuler } from "./m3.js";
import { AIR_SECONDS, LAND_SECONDS, ROLL_LIFT, ROLL_SKID, faceOfSeed, faceUp, middleAt, rollPlan, seedFor, seedFromLots, seedOfThrow, showing, turnTo } from "./roll.js";
import * as fakes from "./test/fakes.js";
// (loaded here so the dock's own import of it is a cached module, not a first load racing the test's wait)
import "./tool.js";
import { emptyScene } from "./test/empty-scene.js";

const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const built = (preset) => builtDie(dieOf(PRESETS[preset].make()));
const content = (preset) => ({ loaded: true, extras: { dice: built(preset), connectors: [], snapRadius: null, legend: null } });
const die = (o = {}) => ({ name: "d6", sourceUrl: "automerge:die", providerId: PROVIDER, transform: T([0.1, 0, 0.2], [0, 0.3, 0]), traits: { [DIE]: {} }, ...o });
/** Frames for a throw whose draw is known at once to land: its least time in the air, then its way down, and a few more. */
const FRAMES = Math.ceil((AIR_SECONDS + LAND_SECONDS) * 60) + 4;
const LAND_FRAMES = Math.ceil(LAND_SECONDS * 60) + 3;
const play = { activities: { current: "play", available: ["edit", "play"] } };
const edit = { activities: { current: "edit", available: ["edit", "play"] } };
/** A draw's seed as lots gives it: 64 hex digits, the roll's 32 bits first. */
const hex = (seed) => (seed >>> 0).toString(16).padStart(8, "0") + "0".repeat(56);

/**
 * Scripted lots: each view's draw(id, o) is recorded and leaves a draw under
 * way on `id`; `drawnAs(id, seed)` makes it drawn, its seed everyone's.
 */
function scriptedLots(write = () => {}) {
  const states = new Map();
  const draws = [];
  let n = 0;
  return {
    states,
    draws,
    forViewer: (viewer) => ({
      draw(id, o = {}) {
        const draw = o.draw ?? `dfake${n++}xx`;
        draws.push({ id, by: viewer, ...o, draw });
        // a draw is in the doc, on the die, as the real one's round is (what's in it is the script's to say)
        write((d) => d.objects[id] && (d.objects[id].traits[DIE].round = { draw }));
        states.set(id, { draw, by: viewer, of: [...(o.of ?? [])], phase: "committing", public: false, seed: null, contributors: null, members: ["alice", "bob"], waiting: ["bob"], protests: [], spoiled: null });
        return draw;
      },
      // `own`: this view's client made the attempt (lots.js derive), so for its asker's alone, unless the script says
      // the attempt there was written by someone else (`madeBy`)
      state: (id) => {
        const st = states.get(id);
        return st ? { forged: [], excluded: [], ...st, own: (st.madeBy ?? st.by) === viewer } : null;
      },
    }),
    drawnAs(id, seed, more = {}) {
      states.set(id, { ...states.get(id), phase: "open", public: true, seed: hex(seed), contributors: ["alice", "bob"], members: ["alice", "bob"], waiting: [], ...more });
    },
  };
}

/**
 * A scene with dice; A is alice, B is bob, both playing. `dice`: id → preset
 * (what the stage built for it); `objects`: more of the doc.
 */
function world({ dice = { d1: "d6" }, objects = {}, local = {}, lots = true } = {}) {
  const made = Object.fromEntries(Object.keys(dice).map((id, i) => [id, die({ name: id, transform: T([0.1 + 0.05 * i, 0, 0.2], [0, 0.3, 0]) })]));
  const doc = emptyScene({ objects: { ...made, pawn: { name: "Pawn", transform: T([0, 0, 0]) }, ...objects }, order: [...Object.keys(made), "pawn", ...Object.keys(objects)] });
  doc.order = Object.keys(doc.objects);
  const stuff = Object.fromEntries(Object.entries(dice).map(([id, preset]) => [id, content(preset)]));
  const w = fakes.fakeWorld(doc, { content: stuff });
  const script = scriptedLots((fn) => w.change(fn));
  const a = w.join("A", { viewer: "alice", local });
  const b = w.join("B", { viewer: "bob" });
  if (lots) {
    w.view("A").collected = { "dice.lots": script.forViewer("alice") };
    w.view("B").collected = { "dice.lots": script.forViewer("bob") };
  }
  const xa = w.attach("A", Extension.create(a));
  const xb = w.attach("B", Extension.create(b));
  w.flush();
  const writes = [];
  const change = a.change;
  a.change = (fn) => (writes.push(fn), change(fn));
  const cmd = (x, id) => x.commands.find((c) => c.id === id);
  const state = (id, target, x = xa, api = x === xa ? a : b) => cmd(x, id).state(target, { scene: api.scene(), local: api.local.get() });
  /** Run a verb; then both views hear of whatever the doc now says (a draw is a doc change). */
  const run = (id, target, value, x = xa) => {
    const out = cmd(x, id).run(target, value);
    sync();
    return out;
  };
  const sync = () => {
    w.change(() => {});
    w.flush();
  };
  /** The draw on `lead` is drawn, its seed `seed`: everyone hears. */
  const draw = (seed, lead = "d1", more) => {
    script.drawnAs(lead, seed, more);
    sync();
  };
  const notices = (s) => w.view(s).notices.map((n) => n.text);
  const shows = (id) => faceUp(doc.objects[id].transform.rotation, stuff[id].extras.dice);
  const label = (id) => stuff[id].extras.dice.faces[shows(id)].label;
  /** What a die was drawn to show by a draw's seed, as die `k` of `n` in its throw. */
  const drawn = (id, seed, k = 0, n = 1) => {
    const faces = stuff[id].extras.dice.faces;
    return faces[faceOfSeed(seedOfThrow(seedFromLots(hex(seed)), k, n), faces.length)].label;
  };
  return { w, a, b, xa, xb, doc, writes, cmd, state, run, sync, draw, lots: script, notices, shows, label, drawn, stuff };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the dice's verbs", () => {
  it("are Roll (R), Roll all (G), Turn (T) and Edit die, on the use prompt, the menu and the inspector as each needs", () => {
    const t = world();
    expect(t.xa.commands.map((c) => [c.id, c.name, c.key ?? null, c.show])).toEqual([
      ["roll", "Roll", "r", ["use", "menu", "inspector"]],
      ["roll-all", "Roll all", "g", ["use", "menu"]],
      ["turn", "Turn", "t", ["use", "menu", "inspector"]],
      ["open", "Edit die", null, ["menu", "inspector"]],
    ]);
    t.w.done();
  });

  it("Roll applies to a die in play only (R is the gizmo's Rotate while editing), never to what isn't a die, is locked, or is only turned by hand", () => {
    const t = world({ dice: { d1: "d6", cube: "doubling", locked: "d6" }, objects: {} });
    t.a.change((d) => (d.objects.locked.locked = true));
    expect(t.state("roll", "d1")).toEqual({ title: "Roll the die (R)" });
    expect(t.state("roll", "pawn")).toBeNull();
    expect(t.state("roll", "locked")).toBeNull();
    expect(t.state("roll", "cube")).toBeNull();
    expect(t.state("roll", null)).toBeNull();
    expect(t.state("roll", "nope")).toBeNull();
    expect(t.cmd(t.xa, "roll").state("d1", { scene: t.a.scene(), local: edit })).toBeNull();
    // and running it there does nothing
    t.a.local.swap((m) => ({ ...m, ...edit }));
    t.run("roll", "d1");
    expect(t.w.holds.size).toBe(0);
    t.w.done();
  });

  it("back in play after editing with Rotate (R) or Move (G), the hand is the tool again; while editing it's left alone", () => {
    const t = world({ local: { tool: "rotate", ...edit } });
    t.w.flush();
    expect(t.a.local.get().tool).toBe("rotate");
    t.a.local.swap((m) => ({ ...m, ...play }));
    t.w.flush();
    expect(t.a.local.get().tool).toBe("hand");
    t.w.done();
  });

  it("a die whose GLB hasn't arrived can't be rolled, turned or read yet", () => {
    const t = world();
    t.w.content.d1 = null;
    expect(t.state("roll", "d1")).toEqual({ disabled: true, title: "That die is still being made" });
    expect(t.state("turn", "d1")).toEqual({ disabled: true, title: "That die is still being made" });
    t.run("roll", "d1");
    t.run("turn", "d1");
    expect(t.w.holds.size).toBe(0);
    expect(t.writes).toHaveLength(0);
    expect(t.notices("A")).toEqual(Array(2).fill("That die is still being made"));
    t.w.done();
  });

  it("the trait on something whose GLB doesn't say it's a die does nothing: no verb applies", () => {
    const t = world({ objects: { g: { kind: "group", name: "Dice", group: null } } });
    for (const other of [{ loaded: true, extras: { connectors: [] } }, { loaded: true, extras: { dice: { v: 99 } } }, { loaded: true, extras: null }]) {
      t.w.content.d1 = other;
      expect(t.state("roll", "d1")).toBeNull();
      expect(t.state("turn", "d1")).toBeNull();
      t.run("roll", "d1");
      t.run("turn", "d1");
    }
    expect(t.w.holds.size).toBe(0);
    expect(t.writes).toHaveLength(0);
    expect(t.notices("A")).toEqual([]);
    // nor does it count among a group's dice
    t.a.change((d) => (d.objects.d1.group = "g"));
    expect(t.state("roll", "g")).toBeNull();
    t.w.done();
  });

  it("anything whose GLB says it's a die is one, whoever built it: a plain GLB file with the trait", () => {
    const t = world();
    t.a.change((d) => (d.objects.d1.providerId = "file-glb"));
    expect(t.state("roll", "d1")).toEqual({ title: "Roll the die (R)" });
    expect(t.state("turn", "d1")).toMatchObject({ value: 0 });
    // but it has no die doc to open
    expect(t.state("open", "d1")).toBeNull();
    t.w.done();
  });
});

describe("rolling a die", () => {
  it("is in the air the moment it's thrown, for everyone, and stays there until its draw is known; then lands as the draw says, in one write; everyone is told from the doc", () => {
    const t = world();
    const B = t.stuff.d1.extras.dice;
    const before = structuredClone(t.doc.objects.d1.transform);
    t.run("roll", "d1");
    // one draw, of this die, nothing sealed
    expect(t.lots.draws).toEqual([{ id: "d1", by: "alice", sealers: [], of: ["d1"], draw: "dfake0xx" }]);
    expect(t.state("roll", "d1")).toEqual({ disabled: true, title: "It's rolling" });
    t.w.tick(1 / 60, 2);
    // two frames in, it's off the table, in A's hands, where everyone sees it
    const first = t.w.holds.get("d1");
    expect(first.session).toBe("A");
    expect(middleAt(B, first.transform)[1]).toBeGreaterThan(0.008 + 0.005);
    // two seconds and no draw yet: still in the air, a toss above where it lay; the doc unmoved
    t.w.tick(1 / 60, 120);
    expect(middleAt(B, t.w.holds.get("d1").transform)[1]).toBeCloseTo(0.008 + ROLL_LIFT, 6);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform).toEqual(before);
    // drawn: it comes down on its seed's face, where its seed says, in one write
    t.draw(9);
    t.w.tick(1 / 60, LAND_FRAMES - 4);
    expect(t.writes).toHaveLength(0);
    t.w.tick(1 / 60, 4);
    expect(t.writes).toHaveLength(1);
    const to = t.doc.objects.d1.transform;
    expect(to).toEqual(rollPlan(9, { built: B, from: before }).to);
    expect(middleAt(B, to)[1]).toBeCloseTo(0.008, 5);
    expect(Math.hypot(to.position[0] - before.position[0], to.position[2] - before.position[2])).toBeLessThan(0.03);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: true }]);
    // nothing sent: each view tells it from the doc
    expect(t.w.sent).toEqual([]);
    t.sync();
    expect(t.notices("A")).toEqual([`You rolled ${t.label("d1")}`]);
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}`]);
    expect(t.state("roll", "d1")).toEqual({ title: "Roll the die (R)" });
    t.w.done();
  });

  it("drawn at once (alone in the scene), it is still in the air a moment: a throw looks like one", () => {
    const t = world();
    t.run("roll", "d1");
    t.draw(4, "d1", { contributors: ["alice"], members: ["alice"] });
    t.w.tick(1 / 60, Math.floor(AIR_SECONDS * 60) - 1);
    expect(t.writes).toHaveLength(0);
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(1);
    t.sync();
    // drawn by alice alone, with nobody else a member: nothing to remark
    expect(t.notices("A")).toEqual([`You rolled ${t.label("d1")}`]);
    t.w.done();
  });

  it("lands as its draw's seed says: every face of every shape, by its seed", () => {
    for (const preset of ["d4", "d6", "d8", "d10", "d12", "d20", "coin", "plus-minus"]) {
      const n = built(preset).faces.length;
      for (let seed = 0; seed < n; seed++) {
        const t = world({ dice: { d1: preset } });
        const from = structuredClone(t.doc.objects.d1.transform);
        t.run("roll", "d1");
        t.draw(seed);
        t.w.tick(1 / 60, FRAMES);
        expect(t.doc.objects.d1.transform).toEqual(rollPlan(seed, { built: built(preset), from }).to);
        expect(t.shows("d1")).toBe(seed);
        t.sync();
        expect(t.notices("A")).toEqual([`You rolled ${built(preset).faces[seed].label}`]);
        expect(t.notices("B")).toEqual([`Someone rolled ${built(preset).faces[seed].label}`]);
        t.w.done();
      }
    }
  });

  it("asks one draw for a roll, and one for a whole throw of several, of every die in it in order, on the first", () => {
    const t = world({ dice: { d1: "d6", d2: "d6" }, objects: { g: { kind: "group", name: "Dice", group: null } } });
    t.a.change((d) => (d.objects.d1.group = d.objects.d2.group = "g"));
    t.w.flush();
    t.run("roll", "d1");
    t.draw(4);
    t.w.tick(1 / 60, FRAMES);
    t.sync();
    t.run("roll", "g");
    expect(t.lots.draws.map(({ id, of, sealers }) => ({ id, of, sealers }))).toEqual([
      { id: "d1", of: ["d1"], sealers: [] },
      { id: "d1", of: ["d1", "d2"], sealers: [] },
    ]);
    t.w.done();
  });

  it("on a tilted, turned, scaled parent it lands flat on the parent, and is read against the parent", () => {
    for (let seed = 0; seed < 20; seed++) {
      const t = world({ dice: { d1: "d20" }, objects: { ship: { name: "Ship", transform: T([3, 0.5, -2], [0.45, 0.9, -0.3], 2) } } });
      t.a.change((d) => {
        d.objects.d1.parent = "ship";
        d.objects.d1.transform = T([0.05, 0.02, 0], [0, 0, 0]);
      });
      t.w.flush();
      const b = t.stuff.d1.extras.dice;
      t.run("roll", "d1");
      t.draw(seed);
      t.w.tick(1 / 60, FRAMES);
      const to = t.doc.objects.d1.transform;
      expect(t.shows("d1")).toBe(seed);
      // in the ship's frame: the face's up along the ship's +Y, lowest corners level at the height it stood on (0.02)
      const m = eulerMatrix(to.rotation);
      const up = m.map((r) => r[0] * b.faces[seed].up[0] + r[1] * b.faces[seed].up[1] + r[2] * b.faces[seed].up[2]);
      expect(up[1]).toBeCloseTo(1, 5);
      const c = middleAt(b, to);
      const ys = b.verts.map((v) => c[1] + m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2]);
      expect(Math.min(...ys)).toBeCloseTo(0.02, 5);
      expect(ys.filter((y) => Math.abs(y - 0.02) < 1e-5).length).toBe(3);
      // a skid is 2 cm in the world: 1 cm in the ship's units
      expect(Math.hypot(c[0] - 0.05, c[2])).toBeLessThanOrEqual(0.01 + 1e-5);
      t.w.done();
    }
  });

  it("pressing R again while it's rolling doesn't roll it twice", () => {
    const t = world();
    t.run("roll", "d1");
    t.w.tick(1 / 60, 5);
    t.run("roll", "d1");
    t.draw(2);
    t.w.tick(1 / 60, FRAMES * 2);
    expect(t.lots.draws).toHaveLength(1);
    expect(t.writes).toHaveLength(1);
    t.sync();
    expect(t.notices("A")).toHaveLength(1);
    t.w.done();
  });

  it("a die a peer is holding can't be rolled; nor any die while lots aren't running here", () => {
    const t = world();
    t.b.pose.hold("d1", t.doc.objects.d1.transform);
    expect(t.state("roll", "d1")).toEqual({ disabled: true, title: "Someone has that die" });
    t.run("roll", "d1");
    t.w.tick(1 / 60, FRAMES);
    expect(t.lots.draws).toHaveLength(0);
    expect(t.writes).toHaveLength(0);
    expect(t.notices("A")).toEqual(["Someone has that die"]);
    t.w.done();
    const u = world({ lots: false });
    expect(u.state("roll", "d1")).toEqual({ disabled: true, title: "Rolls are drawn by lots, which aren't running here yet" });
    u.run("roll", "d1");
    u.w.tick(1 / 60, FRAMES);
    expect(u.w.holds.size).toBe(0);
    expect(u.writes).toHaveLength(0);
    u.w.done();
  });

  it("a peer who catches it mid-air has it: no write, and nobody lands it from their hand; what it was drawn to show is told", () => {
    const t = world();
    t.run("roll", "d1");
    t.w.tick(1 / 60, 10);
    t.w.holds.set("d1", { session: "B", transform: structuredClone(t.doc.objects.d1.transform), at: Date.now() - 1 });
    t.w.tick(1 / 60, 5);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: false }]);
    expect(t.w.view("A").loops).toHaveLength(0);
    // the draw comes in, and the grace passes: B has it in hand (drawn where B holds it), so nobody writes it down
    const before = structuredClone(t.doc.objects.d1.transform);
    t.w.holds.set("d1", { session: "B", transform: T([0.3, 0.2, 0.3]), at: Date.now() - 1 });
    t.draw(3);
    t.w.tick(1 / 60, FRAMES);
    vi.advanceTimersByTime(LAND_GRACE_MS + 6000);
    t.sync();
    expect(t.doc.objects.d1.transform).toEqual(before);
    // a drawn throw is told whatever becomes of it: the seed was everyone's, so a catch hides nothing
    expect(t.notices("A")).toEqual([`Your roll of d1 didn't come down as drawn: drawn to show ${t.drawn("d1", 3)}`]);
    expect(t.notices("B")).toEqual([`Someone's roll of d1 didn't come down as drawn: drawn to show ${t.drawn("d1", 3)}`]);
    t.w.done();
  });

  it("a die a peer moved in the doc mid-roll is left where they put it; one removed mid-roll is just gone", () => {
    const t = world({ dice: { d1: "d6", d2: "d6" } });
    t.run("roll", "d1");
    t.run("roll", "d2");
    t.w.tick(1 / 60, 10);
    t.b.change((d) => (d.objects.d1.transform.position = [0.4, 0, 0.4]));
    t.b.change((d) => delete d.objects.d2);
    t.draw(1, "d1");
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform.position).toEqual([0.4, 0, 0.4]);
    expect(t.w.view("A").loops).toHaveLength(0);
    t.w.done();
  });

  it("stops rolling when the extension stops", () => {
    const t = world();
    t.run("roll", "d1");
    t.w.tick(1 / 60, 5);
    t.xa.dispose();
    expect(t.w.view("A").loops).toHaveLength(0);
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(0);
    t.w.done();
  });
});

describe("a roll whose draw doesn't come", () => {
  it("spoiled, taken by another throw, or still waiting when its time is up: nothing lands, it's put back as it lay, and the thrower is told why", () => {
    for (const how of ["spoiled", "taken", "waiting"]) {
      const t = world();
      const before = structuredClone(t.doc.objects.d1.transform);
      t.run("roll", "d1");
      t.w.tick(1 / 60, 30);
      if (how === "spoiled") t.lots.states.set("d1", { ...t.lots.states.get("d1"), phase: "spoiled", spoiled: { by: "bob", why: "opening" } });
      if (how === "taken") t.lots.states.set("d1", { ...t.lots.states.get("d1"), draw: "dOTHERxx", by: "bob" });
      if (how === "waiting") t.w.tick(1 / 10, Math.ceil(THROW_MS / 100) + 2);
      t.w.tick(1 / 60, 2);
      expect(t.writes).toHaveLength(0);
      expect(t.doc.objects.d1.transform).toEqual(before);
      expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: false }]);
      expect(t.w.view("A").loops).toHaveLength(0);
      const said = { spoiled: /spoiled/, taken: /^Someone threw that die before yours was drawn: that is the throw\.$/, waiting: /still waiting for 1 more\. Nothing was rolled\./ }[how];
      expect(t.notices("A").at(-1)).toMatch(said);
      expect(t.state("roll", "d1")).toEqual({ title: "Roll the die (R)" });
      t.w.done();
    }
  });
});

describe("a throw is the doc's", () => {
  it("drawn, and its thrower gone before landing it: another view that saw it thrown lands it, after a grace, exactly as its seed says, and tells it", () => {
    const t = world();
    const from = structuredClone(t.doc.objects.d1.transform);
    t.run("roll", "d1");
    t.w.tick(1 / 60, 10);
    t.w.leave("A");
    t.draw(5);
    vi.advanceTimersByTime(LAND_GRACE_MS - 100);
    expect(t.doc.objects.d1.transform).toEqual(from);
    vi.advanceTimersByTime(200);
    expect(t.doc.objects.d1.transform).toEqual(rollPlan(5, { built: built("d6"), from }).to);
    t.sync();
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}`]);
    t.w.done();
  });

  it("drawn by one alone while others were members, it is told so; alone in the scene, it isn't remarked", () => {
    const t = world();
    t.run("roll", "d1", undefined, t.xb);
    t.draw(2, "d1", { by: "bob", contributors: ["bob"], members: ["alice", "bob"] });
    t.w.tick(1 / 60, 2);
    // B's own loop: B threw it, so land it as B (B's ticks run B's loops too)
    t.w.tick(1 / 60, FRAMES);
    t.sync();
    expect(t.notices("A")).toEqual([`Someone rolled ${t.label("d1")} (drawn by someone alone)`]);
    expect(t.notices("B")).toEqual([`You rolled ${t.label("d1")} (drawn by you alone)`]);
    t.w.done();
  });

  it("a throw whose dice don't lie as its draw says isn't told as a roll: it's told as not come down as drawn, with what it was drawn to show", () => {
    const t = world();
    t.run("roll", "d1", undefined, t.xb);
    t.w.leave("B", { bye: false });
    t.draw(2, "d1", { by: "bob" });
    // a modified client writes the die down on another face than its seed's
    const wrong = turnTo(built("d6"), (2 + 1) % 6, t.doc.objects.d1.transform);
    t.a.change((d) => (d.objects.d1.transform = wrong));
    t.sync();
    vi.advanceTimersByTime(TOLD_MS + 100);
    t.sync();
    expect(t.notices("A")).toEqual([`d1 didn't come down as drawn: drawn to show ${t.drawn("d1", 2)}`.replace(/^d1/, "Someone's roll of d1")]);
    t.w.done();
  });

  it("a drawn throw thrown again before it landed is told, with what it was drawn to show, however its dice were nudged first", () => {
    for (const nudge of [0, 2e-6, 0.01]) {
      const t = world();
      t.run("roll", "d1", undefined, t.xb);
      t.w.tick(1 / 60, 2);
      t.draw(4, "d1", { by: "bob" });
      // B's client sees the face coming, drops that throw, nudges the die (or not), and throws again
      t.w.view("B").loops.length = 0;
      t.b.pose.release("d1");
      if (nudge) t.b.change((d) => (d.objects.d1.transform.position[0] += nudge));
      t.sync();
      t.lots.forViewer("bob").draw("d1", { sealers: [], of: ["d1"] });
      t.sync();
      // (nudged in the doc, it has come down, though not as drawn: that is told at once, and the new throw adds nothing)
      const told = nudge ? `Someone's roll of d1 didn't come down as drawn: drawn to show ${t.drawn("d1", 4)}` : `Someone threw d1 again before it landed: drawn to show ${t.drawn("d1", 4)}`;
      expect(t.notices("A"), `nudged ${nudge}`).toEqual([told]);
      t.w.done();
    }
  });

  it("a throw not yet drawn, taken by another thrown at the same moment, is nobody's to tell: nobody knew its face", () => {
    const t = world();
    t.run("roll", "d1");
    // B's throw, written at once (B never saw A's), wins the merge
    t.lots.forViewer("bob").draw("d1", { sealers: [], of: ["d1"] });
    t.sync();
    t.w.tick(1 / 60, 3);
    expect(t.notices("A")).toEqual(["Someone threw that die before yours was drawn: that is the throw."]);
    expect(t.notices("B")).toEqual([]);
    t.w.done();
  });

  it("A's own throw, written over in A's name by someone else, isn't landed by A, nor by anyone; landed by its forger, it's told as no fair roll", () => {
    const t = world();
    const from = structuredClone(t.doc.objects.d1.transform);
    t.run("roll", "d1");
    t.w.tick(1 / 60, 3);
    // the attempt there now is A's draw, asked in A's name, made by someone else; A's client says so (lots.js "forged")
    t.draw(5, "d1", { madeBy: "bob", forged: ["alice"] });
    t.w.tick(1 / 60, FRAMES);
    expect(t.notices("A")).toEqual(["Someone wrote the lots for that throw in your name: nothing was rolled."]);
    // nobody lands it for its thrower, past the grace (and every retry of it)
    vi.advanceTimersByTime(LAND_GRACE_MS + 8 * 500 + 100);
    t.sync();
    expect(t.doc.objects.d1.transform).toEqual(from);
    expect(LAND_GRACE_MS + 8 * 500 + 100).toBeLessThan(TOLD_MS);
    // its forger lands it as its seed says
    t.b.change((d) => (d.objects.d1.transform = rollPlan(seedOfThrow(seedFromLots("00000005" + "0".repeat(56)), 0, 1), { built: built("d6"), from }).to));
    t.sync();
    expect(t.notices("B")).toEqual([`d1 came down on ${t.label("d1")} (someone says someone wrote its lots in their name: no fair roll)`]);
    t.w.done();
  });

  it("a throw told before anyone said it was forged is told again", () => {
    const t = world();
    t.run("roll", "d1", undefined, t.xb);
    t.draw(2, "d1", { by: "bob" });
    t.w.tick(1 / 60, FRAMES);
    t.sync();
    expect(t.notices("A")).toEqual([`Someone rolled ${t.label("d1")}`]);
    t.lots.states.set("d1", { ...t.lots.states.get("d1"), forged: ["carol"] });
    t.sync();
    expect(t.notices("A").at(-1)).toBe("Someone says someone wrote its lots in their name: the roll of d1 told before is no fair roll.");
    t.w.done();
  });

  it("drawn again without someone who didn't open, it says so", () => {
    const t = world();
    t.run("roll", "d1", undefined, t.xb);
    t.draw(2, "d1", { by: "bob", contributors: ["alice", "bob"], members: ["alice", "bob"], excluded: ["carol"] });
    t.w.tick(1 / 60, FRAMES);
    t.sync();
    expect(t.notices("A")).toEqual([`Someone rolled ${t.label("d1")} (someone didn't open their part, and it was drawn again without them)`]);
    t.w.done();
  });
});

describe("rolling several together", () => {
  const pair = () => world({ dice: { tens: "d10-tens", units: "d10", lone: "d6", cube: "doubling" }, objects: { g: { kind: "group", name: "Percentile dice", group: null } } });
  const filed = (t, ids = ["tens", "units"]) => {
    t.a.change((d) => ids.forEach((id) => (d.objects[id].group = "g")));
    t.w.flush();
    t.writes.length = 0;
  };

  it("Roll all (G) is offered on a die filed in a group with other dice, and Roll on the group itself", () => {
    const t = pair();
    expect(t.state("roll-all", "tens")).toBeNull();
    expect(t.state("roll", "g")).toBeNull(); // an empty group
    filed(t);
    expect(t.state("roll-all", "tens")).toEqual({ label: "Roll all 2", title: "Roll every die in this one's group together (G)" });
    expect(t.state("roll-all", "units")).toMatchObject({ label: "Roll all 2" });
    expect(t.state("roll-all", "lone")).toBeNull();
    expect(t.state("roll-all", "g")).toBeNull();
    expect(t.state("roll-all", "pawn")).toBeNull();
    expect(t.state("roll", "g")).toEqual({ label: "Roll 2 dice", title: "Roll every die in this group together (R)" });
    // each can still be rolled alone
    expect(t.state("roll", "tens")).toEqual({ title: "Roll the die (R)" });
    expect(t.cmd(t.xa, "roll-all").state("tens", { scene: t.a.scene(), local: edit })).toBeNull();
    t.w.done();
  });

  it("they're one draw, tumble together, land in one write, and are told in one line listing each in order", () => {
    for (const [verb, target] of [["roll-all", "units"], ["roll", "g"]]) {
      const t = pair();
      filed(t);
      const from = { tens: structuredClone(t.doc.objects.tens.transform), units: structuredClone(t.doc.objects.units.transform) };
      t.run(verb, target);
      expect(t.lots.draws.map(({ id, of }) => ({ id, of }))).toEqual([{ id: "tens", of: ["tens", "units"] }]);
      t.w.tick(1 / 60, 10);
      expect([...t.w.holds.keys()].sort()).toEqual(["tens", "units"]);
      t.draw(77, "tens");
      expect(t.writes).toHaveLength(0);
      t.w.tick(1 / 60, FRAMES);
      expect(t.writes).toHaveLength(1);
      // each die's own seed, by its place in the throw
      // (thrown together, each skids no further than half its own width)
      const skid = (p) => Math.min(ROLL_SKID, 0.5 * Math.max(...built(p).verts.map((v) => Math.hypot(...v))));
      const want = { tens: rollPlan(seedFor(77, 0), { built: built("d10-tens"), from: from.tens, skid: skid("d10-tens") }), units: rollPlan(seedFor(77, 1), { built: built("d10"), from: from.units, skid: skid("d10") }) };
      expect(t.doc.objects.tens.transform).toEqual(want.tens.to);
      expect(t.doc.objects.units.transform).toEqual(want.units.to);
      expect(t.w.released).toEqual([{ session: "A", id: "tens", landed: true }, { session: "A", id: "units", landed: true }]);
      t.sync();
      expect(t.notices("A")).toEqual([`You rolled ${t.label("tens")}, ${t.label("units")}`]);
      expect(t.notices("B")).toEqual([`Someone rolled ${t.label("tens")}, ${t.label("units")}`]);
      // the others were left alone
      expect(t.doc.objects.lone.transform).toEqual(T([0.2, 0, 0.2], [0, 0.3, 0]));
      t.w.done();
    }
  });

  it("they're thrown, and told, in the scene's own order, whatever their ids", () => {
    const t = world({ dice: { zz: "d10-tens", aa: "d10" }, objects: { g: { kind: "group", name: "Percentile dice", group: null } } });
    t.a.change((d) => (d.objects.zz.group = d.objects.aa.group = "g"));
    t.w.flush();
    expect(t.doc.order.indexOf("zz")).toBeLessThan(t.doc.order.indexOf("aa"));
    const from = structuredClone(t.doc.objects.zz.transform);
    t.run("roll", "g");
    expect(t.lots.draws[0]).toMatchObject({ id: "zz", of: ["zz", "aa"] });
    t.draw(5, "zz");
    t.w.tick(1 / 60, FRAMES);
    expect(t.shows("zz")).toBe(rollPlan(seedFor(5, 0), { built: built("d10-tens"), from }).face);
    t.sync();
    expect(t.notices("A")).toEqual([`You rolled ${t.label("zz")}, ${t.label("aa")}`]);
    t.w.done();
  });

  it("thrown together they skid less than one alone: no further than half their own width", () => {
    for (let seed = 0; seed < 40; seed++) {
      const t = pair();
      filed(t);
      const before = middleAt(t.stuff.units.extras.dice, t.doc.objects.units.transform);
      t.run("roll", "g");
      t.draw(seed, "tens");
      t.w.tick(1 / 60, FRAMES);
      const after = middleAt(t.stuff.units.extras.dice, t.doc.objects.units.transform);
      const width = Math.max(...t.stuff.units.extras.dice.verts.map((v) => Math.hypot(...v)));
      expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThanOrEqual(0.5 * width + 1e-6);
      t.w.done();
    }
  });

  it("a die that's only turned by hand, or locked, stays out of a throw", () => {
    const t = pair();
    filed(t, ["tens", "units", "cube", "lone"]);
    t.a.change((d) => (d.objects.lone.locked = true));
    t.w.flush();
    t.writes.length = 0;
    const cube = structuredClone(t.doc.objects.cube.transform);
    expect(t.state("roll", "g")).toMatchObject({ label: "Roll 2 dice" });
    expect(t.state("roll-all", "tens")).toMatchObject({ label: "Roll all 2" });
    expect(t.state("roll-all", "cube")).toBeNull();
    t.run("roll", "g");
    expect(t.lots.draws[0].of).toEqual(["tens", "units"]);
    t.draw(3, "tens");
    t.w.tick(1 / 60, FRAMES);
    expect(t.doc.objects.cube.transform).toEqual(cube);
    t.w.done();
  });

  it("one caught mid-air is the catcher's; the rest land and are told without it", () => {
    const t = pair();
    filed(t);
    t.run("roll", "g");
    t.w.tick(1 / 60, 10);
    t.w.holds.set("tens", { session: "B", transform: structuredClone(t.doc.objects.tens.transform), at: Date.now() - 1 });
    const tens = structuredClone(t.doc.objects.tens.transform);
    t.draw(8, "tens");
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(1);
    expect(t.doc.objects.tens.transform).toEqual(tens);
    t.sync();
    expect(t.notices("A")).toEqual([]);
    // the catcher carries it off somewhere; after a while, what came down is told
    t.b.change((d) => (d.objects.tens.transform.position = [0.5, 0, 0.5]));
    vi.advanceTimersByTime(TOLD_MS + 100);
    expect(t.notices("A")).toEqual([`You rolled ${t.label("units")}; tens didn't come down as drawn: drawn to show ${t.drawn("tens", 8, 0, 2)}`]);
    t.w.done();
  });

  it("while any of them is in the air or in a peer's hand, the throw waits", () => {
    const t = pair();
    filed(t);
    t.run("roll", "tens");
    expect(t.state("roll", "g")).toEqual({ label: "Roll 2 dice", disabled: true, title: "It's rolling" });
    expect(t.state("roll-all", "units")).toEqual({ label: "Roll all 2", disabled: true, title: "It's rolling" });
    t.run("roll", "g");
    expect(t.lots.draws).toHaveLength(1);
    expect(t.lots.draws[0].of).toEqual(["tens"]);
    t.w.done();
  });
});

describe("turning a die by hand", () => {
  it("Turn says what the die shows, and offers every face", () => {
    const t = world({ dice: { cube: "doubling" } });
    expect(t.state("turn", "cube")).toEqual({
      label: "Turn (shows 2)",
      value: 0,
      choices: [2, 4, 8, 32, 16, 64].map((v, i) => ({ value: i, label: String(v) })),
      title: "Turn it by hand: T for its next face, or pick one",
    });
    expect(t.state("turn", "pawn")).toBeNull();
    expect(t.state("turn", null)).toBeNull();
    // while editing too: a die is set up by hand
    expect(t.cmd(t.xa, "turn").state("cube", { scene: t.a.scene(), local: edit })).toMatchObject({ value: 0 });
    t.w.done();
  });

  it("is read at any orientation: as it lies after being carried and put down askew", () => {
    const t = world({ dice: { d1: "d20" } });
    const b = t.stuff.d1.extras.dice;
    for (let i = 0; i < 20; i++) {
      const askew = matrixEuler(showing(b, i, 0.7)).map((v, k) => v + [0.15, 0, -0.1][k]);
      t.a.change((d) => (d.objects.d1.transform.rotation = askew));
      expect(t.state("turn", "d1")).toMatchObject({ value: i, label: `Turn (shows ${b.faces[i].label})` });
    }
    t.w.done();
  });

  it("T turns it to its next face, a pick to that face: written at once, and told as a turn, not a roll", () => {
    const t = world({ dice: { cube: "doubling" } });
    const b = t.stuff.cube.extras.dice;
    const from = structuredClone(t.doc.objects.cube.transform);
    t.run("turn", "cube");
    expect(t.writes).toHaveLength(1);
    expect(t.w.holds.size).toBe(0);
    expect(t.doc.objects.cube.transform).toEqual(turnTo(b, 1, from));
    expect(t.shows("cube")).toBe(1);
    expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "turned", data: { die: "cube", face: 1 } }]);
    t.w.flush();
    expect(t.notices("A")).toEqual(["You turned cube to 4"]);
    expect(t.notices("B")).toEqual(["Someone turned cube to 4"]);
    t.run("turn", "cube", 5);
    expect(t.shows("cube")).toBe(5);
    t.w.flush();
    expect(t.notices("B").at(-1)).toBe("Someone turned cube to 64");
    // from the last face, T comes round to the first
    t.run("turn", "cube");
    expect(t.shows("cube")).toBe(0);
    // a pick that isn't a face is the next face
    t.run("turn", "cube", 99);
    expect(t.shows("cube")).toBe(1);
    t.w.done();
  });

  it("turned to the face it already shows, at rest: nothing is written and nothing told", () => {
    const t = world();
    t.run("turn", "d1", 0);
    expect(t.writes).toHaveLength(0);
    expect(t.w.sent).toHaveLength(0);
    expect(t.notices("A")).toEqual([]);
    t.w.done();
  });

  it("not while it's rolling, in a peer's hand, or locked", () => {
    const t = world({ dice: { d1: "d6", d2: "d6", d3: "d6" } });
    t.a.change((d) => (d.objects.d3.locked = true));
    t.run("roll", "d1");
    t.b.pose.hold("d2", t.doc.objects.d2.transform);
    expect(t.state("turn", "d1")).toMatchObject({ disabled: true, title: "It's rolling" });
    expect(t.state("turn", "d2")).toMatchObject({ disabled: true, title: "Someone has that die" });
    expect(t.state("turn", "d3")).toBeNull();
    t.run("turn", "d1", 3);
    t.run("turn", "d2", 3);
    t.run("turn", "d3", 3);
    expect(t.w.sent).toHaveLength(0);
    t.w.done();
  });
});

describe("a peer's word", () => {
  const from = { session: "A", viewer: "alice" };
  const settle = (t, face, id = "d1") => t.a.change((d) => (d.objects[id].transform.rotation = matrixEuler(showing(built("d6"), face, 0.2)).map((v) => +v.toFixed(6))));

  it("only messages of the shapes it knows are heard at all: a turn; a roll is never anyone's word", () => {
    const ok = { die: "d1", face: 3 };
    expect(Object.keys(MESSAGES)).toEqual(["turned"]);
    expect(MESSAGES.turned(ok)).toBe(true);
    for (const d of [{}, { die: "d1" }, { face: 1 }, { die: "d1", face: "1" }, { die: "", face: 1 }, { die: "d1", face: -1 }, { die: "d1", face: 1.5 }, { die: "d1", face: 100 }, { die: "x".repeat(128), face: 1 }]) expect([d, MESSAGES.turned(d)]).toEqual([d, false]);
    expect(MAX_THROWN).toBe(64);
    const t = world();
    settle(t, 3);
    for (const [type, data] of [["rolled", { dice: [ok] }], ["rolled", null], ["shuffled", { n: 3 }], ["constructor", ok], ["turned", { die: "pawn", face: 3 }], ["turned", null], ["turned", 7]]) t.xb.receive(type, data, from);
    t.w.flush();
    vi.advanceTimersByTime(TRUST_MS + 1000);
    expect(t.notices("B")).toEqual([]);
    t.w.done();
  });

  it("a turn is told only as the die shows it in the doc, and only when the doc moved it", () => {
    const t = world();
    t.w.flush();
    // the die hasn't moved: a "turn" of it is nobody's word to take
    t.xb.receive("turned", { die: "d1", face: t.shows("d1") }, from);
    vi.advanceTimersByTime(TRUST_MS + 1000);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // put down by hand on a face, then "announced" after the moment has passed: still nothing
    settle(t, 2);
    t.w.flush();
    vi.advanceTimersByTime(TRUST_MS + 1000);
    t.xb.receive("turned", { die: "d1", face: 2 }, from);
    expect(t.notices("B")).toEqual([]);
    // the doc moved it just now, but to another face than they say
    settle(t, 4);
    t.xb.receive("turned", { die: "d1", face: 5 }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    vi.advanceTimersByTime(TRUST_MS + 1000);
    // the message first, the doc after (they travel apart): told when the doc lands it
    t.xb.receive("turned", { die: "d1", face: 1 }, from);
    expect(t.notices("B")).toEqual([]);
    settle(t, 1);
    t.w.flush();
    expect(t.notices("B")).toEqual([`Someone turned d1 to ${t.label("d1")}`]);
    // and that move is spent: saying it again tells nothing more
    t.xb.receive("turned", { die: "d1", face: 1 }, from);
    t.w.flush();
    expect(t.notices("B")).toHaveLength(1);
    t.w.done();
  });

  it("is told by the peer's contact name once it's known, and by this view's own labels", async () => {
    const t = world();
    const ana = t.w.repo.add({ name: "Ana" });
    t.xb.receive("turned", { die: "d1", face: 1 }, { session: "A", viewer: ana.url });
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    settle(t, 1);
    t.w.flush();
    expect(t.notices("B")).toEqual([`Ana turned d1 to ${t.label("d1")}`]);
  });

  it("a word that comes before this view's die is built waits for it", () => {
    const t = world();
    const made = t.w.content.d1;
    t.w.content.d1 = null;
    settle(t, 2);
    t.xb.receive("turned", { die: "d1", face: 2 }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // the GLB arrives: an update with the same scene
    t.w.content.d1 = made;
    t.xb.update(t.b.scene(), t.b.local.get(), { scene: t.b.scene(), local: t.b.local.get() });
    expect(t.notices("B")).toEqual([`Someone turned d1 to ${t.label("d1")}`]);
    t.w.done();
  });
});

describe("a die's own panel, docked", () => {
  const withDoc = () => {
    const t = world();
    const h = t.w.repo.add({ "@patchwork": { type: "die" }, ...PRESETS.d6.make() });
    t.a.change((d) => (d.objects.d1.sourceUrl = h.url));
    t.w.flush();
    return { ...t, h };
  };
  const settled = async () => {
    vi.useRealTimers();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("Edit die is offered on a die built from a die doc, in the menu and the inspector, playing or editing", () => {
    const t = withDoc();
    expect(t.state("open", "d1")).toEqual({ title: "Open this die's own panel beside the scene: its shape, faces and colours" });
    expect(t.cmd(t.xa, "open").state("d1", { scene: t.a.scene(), local: edit })).toBeTruthy();
    expect(t.state("open", "pawn")).toBeNull();
    expect(t.state("open", null)).toBeNull();
    // a die shown from a plain GLB file has no doc of its own to open
    t.a.change((d) => (d.objects.d1.providerId = "file-glb"));
    expect(t.state("open", "d1")).toBeNull();
    t.w.done();
  });

  it("docks the die's 2D tool in the stage's right edge on the die's own doc, as an embedded document; again, or Close, undocks it", async () => {
    const t = withDoc();
    t.run("open", "d1");
    await settled();
    const edge = t.w.view("A").edge;
    expect(edge.children).toHaveLength(1);
    const dock = edge.firstElementChild;
    expect(dock.classList.contains("dice-dock")).toBe(true);
    expect(dock.hasAttribute("data-stage-embed")).toBe(true);
    expect(dock.querySelector("header .name").textContent).toBe("d1");
    expect(dock.querySelector(".body .die-tool")).toBeTruthy();
    expect(dock.querySelectorAll(".die-face")).toHaveLength(6);
    expect(t.state("open", "d1")).toMatchObject({ label: "Close die panel" });
    // it edits the die's own doc
    const body = dock.querySelector(".die-tool input.body");
    body.value = "#123456";
    body.dispatchEvent(new Event("change"));
    expect(t.h.doc().body).toBe("#123456");
    // only this view docked it
    expect(t.w.view("B").edge.children).toHaveLength(0);
    t.run("open", "d1");
    expect(edge.children).toHaveLength(0);
    t.run("open", "d1");
    await settled();
    edge.querySelector("header button").click();
    expect(edge.children).toHaveLength(0);
    expect(t.state("open", "d1").label).toBeUndefined();
  });

  it("opening another die's replaces it; the die going, or the extension stopping, undocks it", async () => {
    const t = withDoc();
    const h2 = t.w.repo.add({ "@patchwork": { type: "die" }, ...PRESETS.d20.make() });
    t.a.change((d) => (d.objects.d2 = die({ name: "d20", sourceUrl: h2.url })));
    t.w.flush();
    t.run("open", "d1");
    await settled();
    t.run("open", "d2");
    await settled();
    const edge = t.w.view("A").edge;
    expect(edge.children).toHaveLength(1);
    expect(edge.querySelectorAll(".die-face")).toHaveLength(20);
    t.a.change((d) => delete d.objects.d2);
    t.w.flush();
    expect(edge.children).toHaveLength(0);
    t.run("open", "d1");
    await settled();
    expect(edge.children).toHaveLength(1);
    t.xa.dispose();
    expect(edge.children).toHaveLength(0);
  });

  it("a die whose doc can't be opened says so, and docks nothing", async () => {
    const t = world();
    t.run("open", "d1"); // sourceUrl "automerge:die": not in the repo
    await settled();
    expect(t.w.view("A").edge.children).toHaveLength(0);
    expect(t.notices("A")).toEqual(["Couldn't open that die: unavailable"]);
  });
});

describe("a die doc dropped in a scene", () => {
  it("becomes a die there: built by this package, carrying the trait, where it was dropped, selected", async () => {
    const doc = emptyScene();
    const { ctx, calls, local } = fakes.fakeDrop(doc);
    const info = { url: "automerge:mydie", doc: { "@patchwork": { type: "die" }, ...PRESETS.d12.make() }, group: null, at: { point: [0.2, 0.7, -0.1], hitId: "table" } };
    expect(await Extension.drop(ctx, info)).toBe(true);
    expect(calls.added).toEqual([{ url: "automerge:mydie", opts: { providerId: PROVIDER, group: null, fields: { traits: { [DIE]: {} } }, transform: T([0.2, 0.7, -0.1]) } }]);
    const [id] = doc.order;
    expect(local().selected).toBe(id);
    // nothing is made: the die's doc is the one dropped
    expect(calls.created).toEqual([]);
    // with no point (dropped on the outline): at the origin, the stage's default
    expect(await Extension.drop(ctx, { ...info, at: null })).toBe(true);
    expect(calls.added[1].opts.transform).toBeUndefined();
  });

  it("anything else is someone else's to lay out", async () => {
    const { ctx, calls } = fakes.fakeDrop(emptyScene());
    for (const doc of [{ "@patchwork": { type: "file" } }, { "@patchwork": { type: "tabletop-game" } }, {}, null]) expect(await Extension.drop(ctx, { url: "automerge:x", doc, at: null })).toBe(false);
    expect(calls.added).toEqual([]);
  });
});
