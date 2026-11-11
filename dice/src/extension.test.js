// The dice extension against a fake stage (test/fakes.js): two views of one
// doc, each with its own api. What a die is comes from what the stage says
// it built (api.content(id).extras.dice), as in a real scene.
import { afterEach, describe, it, expect, vi } from "vitest";
import Extension, { MAX_THROWN, MESSAGES, TRUST_MS } from "./extension.js";
import { DIE, PROVIDER } from "./ids.js";
import { PRESETS, dieOf } from "./die.js";
import { builtDie } from "./die-glb.js";
import { eulerMatrix, matrixEuler } from "./m3.js";
import { ROLL_SECONDS, faceUp, middleAt, rollPlan, seedFor, showing, turnTo } from "./roll.js";
import * as fakes from "./test/fakes.js";
import { emptyScene } from "./test/empty-scene.js";

const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const built = (preset) => builtDie(dieOf(PRESETS[preset].make()));
const content = (preset) => ({ loaded: true, extras: { dice: built(preset), connectors: [], snapRadius: null, legend: null } });
const die = (o = {}) => ({ name: "d6", sourceUrl: "automerge:die", providerId: PROVIDER, transform: T([0.1, 0, 0.2], [0, 0.3, 0]), traits: { [DIE]: {} }, ...o });
const FRAMES = Math.ceil(ROLL_SECONDS * 60) + 2;
const play = { activities: { current: "play", available: ["edit", "play"] } };
const edit = { activities: { current: "edit", available: ["edit", "play"] } };

/**
 * A scene with dice; A is alice, B is bob, both playing. `dice`: id → preset
 * (what the stage built for it); `objects`: more of the doc.
 */
function world({ dice = { d1: "d6" }, objects = {}, local = {} } = {}) {
  const made = Object.fromEntries(Object.keys(dice).map((id, i) => [id, die({ name: id, transform: T([0.1 + 0.05 * i, 0, 0.2], [0, 0.3, 0]) })]));
  const doc = emptyScene({ objects: { ...made, pawn: { name: "Pawn", transform: T([0, 0, 0]) }, ...objects }, order: [...Object.keys(made), "pawn", ...Object.keys(objects)] });
  doc.order = Object.keys(doc.objects);
  const stuff = Object.fromEntries(Object.entries(dice).map(([id, preset]) => [id, content(preset)]));
  const w = fakes.fakeWorld(doc, { content: stuff });
  const a = w.join("A", { viewer: "alice", local });
  const b = w.join("B", { viewer: "bob" });
  const xa = w.attach("A", Extension.create(a));
  const xb = w.attach("B", Extension.create(b));
  w.flush();
  const writes = [];
  const change = a.change;
  a.change = (fn) => (writes.push(fn), change(fn));
  const cmd = (x, id) => x.commands.find((c) => c.id === id);
  const state = (id, target, x = xa, api = x === xa ? a : b) => cmd(x, id).state(target, { scene: api.scene(), local: api.local.get() });
  const run = (id, target, value, x = xa) => cmd(x, id).run(target, value);
  const notices = (s) => w.view(s).notices.map((n) => n.text);
  const shows = (id) => faceUp(doc.objects[id].transform.rotation, stuff[id].extras.dice);
  const label = (id) => stuff[id].extras.dice.faces[shows(id)].label;
  return { w, a, b, xa, xb, doc, writes, cmd, state, run, notices, shows, label, stuff };
}
/** Draw this seed next. */
const seedIs = (seed) => vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((arr) => ((arr[0] = seed), arr));

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
  it("tumbles it in the air for everyone, then writes where it landed once, lets go landed and tells everyone what it shows", () => {
    const t = world();
    const before = structuredClone(t.doc.objects.d1.transform);
    t.run("roll", "d1");
    expect(t.state("roll", "d1")).toEqual({ disabled: true, title: "It's rolling" });
    t.w.tick(1 / 60, 20); // about half way
    const mid = t.w.holds.get("d1");
    expect(mid.session).toBe("A");
    expect(middleAt(t.stuff.d1.extras.dice, mid.transform)[1]).toBeGreaterThan(0.008 + 0.03);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform).toEqual(before);
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(1);
    const to = t.doc.objects.d1.transform;
    // it lands flat, its middle as high as before, near where it was
    expect(middleAt(t.stuff.d1.extras.dice, to)[1]).toBeCloseTo(0.008, 5);
    expect(Math.hypot(to.position[0] - before.position[0], to.position[2] - before.position[2])).toBeLessThan(0.03);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: true }]);
    expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "rolled", data: { dice: [{ die: "d1", face: t.shows("d1") }] } }]);
    t.w.flush();
    expect(t.notices("A")).toEqual([`You rolled ${t.label("d1")}`]);
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}`]);
    // nothing else is written: the trait still holds nothing, the scene has no traits
    expect(t.doc.traits).toEqual({});
    expect(t.doc.objects.d1.traits).toEqual({ [DIE]: {} });
    expect(t.state("roll", "d1")).toEqual({ title: "Roll the die (R)" });
    t.w.done();
  });

  it("lands as the seed it drew says: every face of every shape, by its seed", () => {
    for (const preset of ["d4", "d6", "d8", "d10", "d12", "d20", "coin", "plus-minus"]) {
      const n = built(preset).faces.length;
      for (let seed = 0; seed < n; seed++) {
        const t = world({ dice: { d1: preset } });
        const from = structuredClone(t.doc.objects.d1.transform);
        seedIs(seed);
        t.run("roll", "d1");
        t.w.tick(1 / 60, FRAMES);
        expect(t.doc.objects.d1.transform).toEqual(rollPlan(seed, { built: built(preset), from }).to);
        expect(t.shows("d1")).toBe(seed);
        expect(t.w.sent[0].data).toEqual({ dice: [{ die: "d1", face: seed }] });
        expect(t.notices("A")).toEqual([`You rolled ${built(preset).faces[seed].label}`]);
        t.w.done();
        vi.restoreAllMocks();
      }
    }
  });

  it("draws one seed for a roll, and one for a whole throw of several", () => {
    const t = world({ dice: { d1: "d6", d2: "d6" }, objects: { g: { kind: "group", name: "Dice", group: null } } });
    t.a.change((d) => (d.objects.d1.group = d.objects.d2.group = "g"));
    t.w.flush();
    const draw = seedIs(4);
    t.run("roll", "d1");
    t.w.tick(1 / 60, FRAMES);
    expect(draw).toHaveBeenCalledTimes(1);
    t.run("roll", "g");
    t.w.tick(1 / 60, FRAMES);
    expect(draw).toHaveBeenCalledTimes(2);
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
      seedIs(seed);
      t.run("roll", "d1");
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
      vi.restoreAllMocks();
    }
  });

  it("pressing R again while it's rolling doesn't roll it twice", () => {
    const t = world();
    t.run("roll", "d1");
    t.w.tick(1 / 60, 5);
    t.run("roll", "d1");
    t.w.tick(1 / 60, FRAMES * 2);
    expect(t.writes).toHaveLength(1);
    expect(t.w.sent).toHaveLength(1);
    expect(t.notices("A")).toHaveLength(1);
    t.w.done();
  });

  it("a die a peer is holding can't be rolled", () => {
    const t = world();
    t.b.pose.hold("d1", t.doc.objects.d1.transform);
    expect(t.state("roll", "d1")).toEqual({ disabled: true, title: "Someone has that die" });
    t.run("roll", "d1");
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(0);
    expect(t.w.sent).toHaveLength(0);
    expect(t.notices("A")).toEqual(["Someone has that die"]);
    t.w.done();
  });

  it("a peer who catches it mid-roll has it: no write, nothing told", () => {
    const t = world();
    t.run("roll", "d1");
    t.w.tick(1 / 60, 10);
    t.w.holds.set("d1", { session: "B", transform: structuredClone(t.doc.objects.d1.transform), at: Date.now() - 1 });
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(0);
    expect(t.w.sent).toHaveLength(0);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: false }]);
    expect(t.w.view("A").loops).toHaveLength(0);
    t.w.done();
  });

  it("a die a peer moved in the doc mid-roll is left where they put it; one removed mid-roll is just gone", () => {
    const t = world({ dice: { d1: "d6", d2: "d6" } });
    t.run("roll", "d1");
    t.run("roll", "d2");
    t.w.tick(1 / 60, 10);
    t.b.change((d) => (d.objects.d1.transform.position = [0.4, 0, 0.4]));
    t.b.change((d) => delete d.objects.d2);
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform.position).toEqual([0.4, 0, 0.4]);
    expect(t.w.sent).toHaveLength(0);
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

  it("they tumble together, land in one write, and are told in one line listing each in order", () => {
    for (const [verb, target] of [["roll-all", "units"], ["roll", "g"]]) {
      const t = pair();
      filed(t);
      const from = { tens: structuredClone(t.doc.objects.tens.transform), units: structuredClone(t.doc.objects.units.transform) };
      seedIs(77);
      t.run(verb, target);
      t.w.tick(1 / 60, 10);
      expect([...t.w.holds.keys()].sort()).toEqual(["tens", "units"]);
      expect(t.writes).toHaveLength(0);
      t.w.tick(1 / 60, FRAMES);
      expect(t.writes).toHaveLength(1);
      // each die's own seed, by its place in the sorted list
      const want = { tens: rollPlan(seedFor(77, 0), { built: built("d10-tens"), from: from.tens, skid: 0.5 * 0.0117 }), units: rollPlan(seedFor(77, 1), { built: built("d10"), from: from.units, skid: 0.5 * 0.0117 }) };
      expect(t.shows("tens")).toBe(want.tens.face);
      expect(t.shows("units")).toBe(want.units.face);
      expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "rolled", data: { dice: [{ die: "tens", face: want.tens.face }, { die: "units", face: want.units.face }] } }]);
      expect(t.w.released).toEqual([{ session: "A", id: "tens", landed: true }, { session: "A", id: "units", landed: true }]);
      t.w.flush();
      expect(t.notices("A")).toEqual([`You rolled ${t.label("tens")}, ${t.label("units")}`]);
      expect(t.notices("B")).toEqual([`Someone rolled ${t.label("tens")}, ${t.label("units")}`]);
      // the others were left alone
      expect(t.doc.objects.lone.transform).toEqual(T([0.2, 0, 0.2], [0, 0.3, 0]));
      t.w.done();
      vi.restoreAllMocks();
    }
  });

  it("they're thrown, and told, in the scene's own order, whatever their ids", () => {
    const t = world({ dice: { zz: "d10-tens", aa: "d10" }, objects: { g: { kind: "group", name: "Percentile dice", group: null } } });
    t.a.change((d) => (d.objects.zz.group = d.objects.aa.group = "g"));
    t.w.flush();
    expect(t.doc.order.indexOf("zz")).toBeLessThan(t.doc.order.indexOf("aa"));
    const from = structuredClone(t.doc.objects.zz.transform);
    seedIs(5);
    t.run("roll", "g");
    t.w.tick(1 / 60, FRAMES);
    expect(t.w.sent[0].data.dice.map((d) => d.die)).toEqual(["zz", "aa"]);
    expect(t.shows("zz")).toBe(rollPlan(seedFor(5, 0), { built: built("d10-tens"), from }).face);
    expect(t.notices("A")).toEqual([`You rolled ${t.label("zz")}, ${t.label("aa")}`]);
    t.w.done();
  });

  it("thrown together they skid less than one alone: no further than half their own width", () => {
    for (let seed = 0; seed < 40; seed++) {
      const t = pair();
      filed(t);
      const before = middleAt(t.stuff.units.extras.dice, t.doc.objects.units.transform);
      seedIs(seed);
      t.run("roll", "g");
      t.w.tick(1 / 60, FRAMES);
      const after = middleAt(t.stuff.units.extras.dice, t.doc.objects.units.transform);
      const width = Math.max(...t.stuff.units.extras.dice.verts.map((v) => Math.hypot(...v)));
      expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThanOrEqual(0.5 * width + 1e-6);
      t.w.done();
      vi.restoreAllMocks();
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
    t.w.tick(1 / 60, FRAMES);
    expect(t.w.sent[0].data.dice.map((d) => d.die)).toEqual(["tens", "units"]);
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
    t.w.tick(1 / 60, FRAMES);
    expect(t.writes).toHaveLength(1);
    expect(t.doc.objects.tens.transform).toEqual(tens);
    expect(t.w.sent[0].data.dice.map((d) => d.die)).toEqual(["units"]);
    expect(t.notices("A")).toEqual([`You rolled ${t.label("units")}`]);
    t.w.done();
  });

  it("while any of them is in the air or in a peer's hand, the throw waits", () => {
    const t = pair();
    filed(t);
    t.run("roll", "tens");
    expect(t.state("roll", "g")).toEqual({ label: "Roll 2 dice", disabled: true, title: "It's rolling" });
    expect(t.state("roll-all", "units")).toEqual({ label: "Roll all 2", disabled: true, title: "It's rolling" });
    t.run("roll", "g");
    t.w.tick(1 / 60, FRAMES);
    expect(t.w.sent).toHaveLength(1);
    expect(t.w.sent[0].data.dice.map((d) => d.die)).toEqual(["tens"]);
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

  it("only messages of the shapes it knows are heard at all", () => {
    const ok = { die: "d1", face: 3 };
    expect(MESSAGES.rolled({ dice: [ok] })).toBe(true);
    expect(MESSAGES.turned(ok)).toBe(true);
    const bad = [{}, { dice: [] }, { dice: "d1" }, { dice: [null] }, { dice: [{ die: "", face: 1 }] }, { dice: [{ die: "d1", face: -1 }] }, { dice: [{ die: "d1", face: 1.5 }] }, { dice: [{ die: "d1", face: 100 }] }, { dice: [{ die: "x".repeat(128), face: 1 }] }, { dice: [{ die: 7, face: 1 }] }, { dice: Array(MAX_THROWN + 1).fill(ok) }];
    for (const d of bad) expect([d, MESSAGES.rolled(d)]).toEqual([d, false]);
    for (const d of [{}, { die: "d1" }, { face: 1 }, { die: "d1", face: "1" }]) expect([d, MESSAGES.turned(d)]).toEqual([d, false]);
    const t = world();
    settle(t, 3);
    for (const [type, data] of [["rolled", null], ["rolled", 7], ["rolled", { dice: [{ die: "nope", face: 3 }] }], ["rolled", { dice: [{ die: "pawn", face: 3 }] }], ["rolled", { dice: [ok, ok] }], ["shuffled", { n: 3 }], ["constructor", ok], ["turned", { die: "pawn", face: 3 }]]) t.xb.receive(type, data, from);
    t.w.flush();
    vi.advanceTimersByTime(TRUST_MS + 1000);
    expect(t.notices("B")).toEqual([]);
    t.w.done();
  });

  it("a roll is told only as the die shows it in the doc, and only when the doc moved it", () => {
    const t = world();
    t.w.flush();
    // the die hasn't moved: a "roll" of it is nobody's word to take
    t.xb.receive("rolled", { dice: [{ die: "d1", face: t.shows("d1") }] }, from);
    vi.advanceTimersByTime(TRUST_MS + 1000);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // put down by hand on a face, then "announced" after the moment has passed: still nothing
    settle(t, 2);
    t.w.flush();
    vi.advanceTimersByTime(TRUST_MS + 1000);
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 2 }] }, from);
    expect(t.notices("B")).toEqual([]);
    // the doc moved it just now, but to another face than they say
    settle(t, 4);
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 5 }] }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    vi.advanceTimersByTime(TRUST_MS + 1000);
    // the message first, the doc after (they travel apart): told when the doc lands it
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 5 }] }, from);
    expect(t.notices("B")).toEqual([]);
    settle(t, 5);
    t.w.flush();
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}`]);
    // and that move is spent: saying it again tells nothing more
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 5 }] }, from);
    t.w.flush();
    expect(t.notices("B")).toHaveLength(1);
    t.w.done();
  });

  it("a throw is told only when the doc bears out every die of it", () => {
    const t = world({ dice: { d1: "d6", d2: "d6" } });
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 3 }, { die: "d2", face: 4 }] }, from);
    settle(t, 3, "d1");
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    settle(t, 4, "d2");
    t.w.flush();
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}, ${t.label("d2")}`]);
    t.w.done();
  });

  it("a turn is held to the doc the same way, and told as a turn", () => {
    const t = world();
    t.xb.receive("turned", { die: "d1", face: 1 }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    settle(t, 1);
    t.w.flush();
    expect(t.notices("B")).toEqual([`Someone turned d1 to ${t.label("d1")}`]);
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
    t.xb.receive("rolled", { dice: [{ die: "d1", face: 2 }] }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // the GLB arrives: an update with the same scene
    t.w.content.d1 = made;
    t.xb.update(t.b.scene(), t.b.local.get(), { scene: t.b.scene(), local: t.b.local.get() });
    expect(t.notices("B")).toEqual([`Someone rolled ${t.label("d1")}`]);
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
