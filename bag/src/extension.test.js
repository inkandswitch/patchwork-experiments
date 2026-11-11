// The extension against a stand-in stage (test/fake-stage.js): the verbs as a
// surface would run them, what is written to the two docs, and what the
// others are told.
import { describe, it, expect, vi } from "vitest";
import { inside, itemKey, outside } from "./contents.js";
import { newBag } from "./datatype.js";
import extension, { CONTAINER, MESSAGES } from "./extension.js";
import { SCENE_URL, fakeStage, snapshot, FakeRepo } from "./test/fake-stage.js";

const BAG1 = "automerge:3AAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BAG2 = "automerge:3BBBBBBBBBBBBBBBBBBBBBBBBBBB";
const at = (x, z = 0, y = 0) => ({ position: [x, y, z], rotation: [0, 0, 0], scale: 1 });
const token = (name, x, more = {}) => ({ name, sourceUrl: `automerge:glb-${name}`, providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: true, transform: at(x, 1), hint: { bounds: { min: [-0.01, 0, -0.01], max: [0.01, 0.02, 0.01] } }, ...more });
const bagObject = (url, x) => ({ name: "Token bag", sourceUrl: url, providerId: "bag-sack", renderUrl: "automerge:render", parent: null, group: null, transform: at(x), traits: { [CONTAINER]: { doc: url } } });

async function table({ session = "s-me", activity = "play", rule = "top", carry = false, repo = new FakeRepo() } = {}) {
  if (!repo.handles.has(BAG1)) {
    repo.add(newBag({ title: "Red bag", rule }), BAG1);
    repo.add(newBag({ title: "Blue bag", rule }), BAG2);
  }
  const doc = {
    objects: {
      bag1: bagObject(BAG1, 0),
      bag2: bagObject(BAG2, 1),
      cube: token("Cube", 0.5),
      disc: token("Disc", 0.6),
      meeple: token("Meeple", 0.7, { traits: { "tabletop.hidden": { by: "automerge:deck" } }, tags: ["piece"] }),
      g1: { kind: "group", name: "Tiles", group: null },
      t1: token("Tile", 2, { group: "g1" }),
      t2: token("Tile", 2.1, { group: "g1" }),
      rock: token("Rock", 3, { locked: true }),
    },
    order: ["bag1", "bag2", "cube", "disc", "meeple", "g1", "t1", "t2", "rock"],
  };
  const stage = fakeStage(doc, { session, repo, activity, half: { bag1: 0.1, bag2: 0.1, cube: 0.01, disc: 0.01, meeple: 0.01, t1: 0.01, t2: 0.01, rock: 0.01 } });
  const carries = [];
  if (carry) {
    stage.rec.contributions.carry = [
      (id, ev, opts) => {
        const s = { id, ev, opts, moves: [], ended: null, cancelled: false, move: (e) => s.moves.push(e), end: (e) => (s.ended = e ?? true), cancel: () => (s.cancelled = true), key: () => false };
        carries.push(s);
        return s;
      },
    ];
  }
  const instance = extension.create(stage.api);
  const sync = () => instance.update(snapshot(stage.handle.doc()), stage.rec.local, null);
  // the bags' documents are found asynchronously
  await vi.waitFor(() => expect(stage.rec.labels.length).toBe(2));
  const cmd = (id) => instance.commands.find((c) => c.id === id);
  const state = (id, target) => cmd(id).state(target, { scene: snapshot(stage.handle.doc()), local: stage.rec.local });
  const run = (id, target, value) => {
    cmd(id).run(target, value);
    sync();
  };
  const bag = (url) => repo.handles.get(url);
  const ids = (url) => inside(bag(url).doc()).map((x) => x.entry.id);
  return { ...stage, instance, sync, cmd, state, run, bag, ids, carries };
}

describe("a bag in a scene", () => {
  it("shows its title and how many it holds, on the bag", async () => {
    const t = await table();
    expect(t.rec.labels.map((l) => [l.key, l.text, l.data.empty])).toEqual([["bag1", "Red bag · 0", true], ["bag2", "Blue bag · 0", true]]);
    t.run("put", "cube", "bag1");
    expect(t.rec.labels[0].text).toBe("Red bag · 1");
    expect(t.rec.labels[0].position[1]).toBeGreaterThan(0.1);
  });

  it("Put in: the object leaves the scene doc and is in the bag, whole, and the others hear only that and how many", async () => {
    const t = await table();
    const before = structuredClone(t.handle.doc().objects.meeple);
    expect(t.state("put", "meeple").choices).toEqual([{ value: "bag1", label: "Put in Red bag" }, { value: "bag2", label: "Put in Blue bag" }]);
    t.run("put", "meeple", "bag1");
    expect(t.handle.doc().objects.meeple).toBeUndefined();
    expect(t.rec.removed).toEqual([["meeple"]]); // one change
    const [{ key, entry }] = inside(t.bag(BAG1).doc());
    const { transform, parent, group, ...record } = before;
    expect([key, entry.id, entry.from, entry.scale]).toEqual([itemKey(SCENE_URL, "meeple"), "meeple", SCENE_URL, 1]);
    expect(entry.object).toEqual(record);
    expect(t.rec.sends).toEqual([["put", { bag: BAG1, n: 1 }]]);
    expect(JSON.stringify(t.rec.sends)).not.toMatch(/Meeple|meeple/);
    expect(t.rec.notices).toEqual(["You put something in Red bag"]);
  });

  it("a group goes in as its members, and the emptied group goes with them", async () => {
    const t = await table();
    t.run("put", "g1", "bag2");
    expect(t.ids(BAG2)).toEqual(["t1", "t2"]);
    expect(Object.keys(t.handle.doc().objects)).not.toContain("g1");
    expect(t.rec.removed).toEqual([["t1", "t2", "g1"]]);
    expect(t.rec.sends).toEqual([["put", { bag: BAG2, n: 2 }]]);
  });

  it("what mustn't go in doesn't: the bag itself, a bag that holds this one, what is locked, held, or vetoed by a running extension", async () => {
    const t = await table();
    // the bag itself isn't offered itself
    expect(t.state("put", "bag1").choices.map((c) => c.value)).toEqual(["bag2"]);
    // bag1 into bag2, then bag2 can't go into bag1 (it would hold itself)... bag1 is now inside bag2, so put bag2 into a second object of bag1's doc
    t.run("put", "bag1", "bag2");
    expect(t.ids(BAG2)).toEqual(["bag1"]);
    t.handle.change((d) => (d.objects.bag1again = bagObject(BAG1, 5)));
    t.sync();
    await vi.waitFor(() => expect(t.rec.labels.length).toBe(2));
    expect(t.state("put", "bag2")).toBeNull();
    t.run("put", "bag2", "bag1again");
    expect(t.handle.doc().objects.bag2).toBeDefined();
    // locked
    expect(t.state("put", "rock")).toBeNull();
    // held by a peer
    t.rec.held.set("cube", "s-peer");
    expect(t.state("put", "cube")).toBeNull();
    t.rec.held.clear();
    // vetoed (STAGE.md, `carryable`)
    t.rec.contributions.carryable = [(id) => id !== "disc"];
    expect(t.state("put", "disc")).toBeNull();
    expect(t.state("put", "cube").choices.length).toBe(2);
  });

  it("a piece this view's hand lets go of over a bag goes in; one put down elsewhere doesn't", async () => {
    const t = await table();
    // the hand asks where it would land while carrying (STAGE.md, `landing`), then writes where it put it
    expect(t.instance.landing("cube", [0.5, 0, 1], null)).toBeNull();
    t.handle.change((d) => (d.objects.cube.transform.position = [0.02, 0.2, 0.03]));
    t.sync();
    expect(t.ids(BAG1)).toEqual(["cube"]);
    expect(t.handle.doc().objects.cube).toBeUndefined();
    t.instance.landing("disc", [0.6, 0, 1], null);
    t.handle.change((d) => (d.objects.disc.transform.position = [0.4, 0, 0.4]));
    t.sync();
    expect(t.handle.doc().objects.disc).toBeDefined();
    // moved by something else later (a gizmo, a peer): not a drop of ours
    t.handle.change((d) => (d.objects.disc.transform.position = [1, 0.2, 0]));
    t.sync();
    expect(t.ids(BAG2)).toEqual([]);
  });
});

describe("drawing", () => {
  const filled = async (o) => {
    const t = await table(o);
    for (const id of ["cube", "disc", "meeple"]) t.run("put", id, "bag1");
    t.rec.sends.length = 0;
    t.rec.notices.length = 0;
    return t;
  };

  it("the verb says which bag and how many, and is off when it's empty", async () => {
    const t = await table();
    expect(t.state("draw", "cube")).toBeNull();
    expect(t.state("draw", "bag1")).toMatchObject({ disabled: true, label: "Red bag is empty" });
    t.run("put", "cube", "bag1");
    expect(t.state("draw", "bag1")).toMatchObject({ label: "Draw from Red bag (1)" });
    expect(t.cmd("draw").key).toBe("d");
    expect(t.cmd("draw").show).toContain("use");
  });

  it("Draw brings one back as the object it was, under its own id, beside the bag, and starts the hand carrying it", async () => {
    const t = await filled({ carry: true });
    const before = structuredClone(inside(t.bag(BAG1).doc()).find((x) => x.entry.id === "meeple").entry.object);
    t.run("draw", "bag1");
    const o = t.handle.doc().objects.meeple;
    const { transform, parent, group, ...record } = o;
    expect(record).toEqual(before);
    expect(Math.hypot(transform.position[0], transform.position[2])).toBeGreaterThan(0.1);
    expect(t.ids(BAG1)).toEqual(["cube", "disc"]);
    expect(outside(t.bag(BAG1).doc()).map((x) => [x.entry.id, x.entry.out.by])).toEqual([["meeple", "s-me"]]);
    // carried: the hand's session, started at once, fed by an arm of the bag's
    expect(t.carries.map((c) => [c.id, c.opts.now])).toEqual([["meeple", true]]);
    const arm = t.rec.arms.at(-1);
    expect(arm.on).toBe(true);
    arm.handlers.move({ x: 10, y: 20 });
    expect(t.carries[0].moves).toEqual([{ x: 10, y: 20 }]);
    // the next click puts it down where the drawer chose
    const press = arm.handlers.press({ button: 0, x: 30, y: 40 });
    expect(press.tap({ x: 30, y: 40 })).toBe(true);
    expect(t.carries[0].ended).toEqual({ x: 30, y: 40 });
    expect(arm.on).toBe(false);
    // told: that, from which bag, how many. Never what
    expect(t.rec.sends).toEqual([["drew", { bag: BAG1, n: 1 }]]);
    expect(JSON.stringify(t.rec.sends)).not.toMatch(/eeple/);
  });

  it("with nothing to carry it, the piece is set down beside the bag", async () => {
    const t = await filled();
    t.run("draw", "bag1");
    expect(t.handle.doc().objects.meeple).toBeDefined();
    expect(t.rec.arms).toEqual([]);
    expect(t.rec.loops.size).toBe(0);
  });

  it("Draw several takes that many, each its own item, set down in different spots", async () => {
    const t = await filled({ carry: true });
    expect(t.state("draw-several", "bag1").choices.map((c) => c.value)).toEqual([2, 3]);
    t.run("draw-several", "bag1", 2);
    expect(t.ids(BAG1)).toEqual(["cube"]);
    const [a, b] = ["meeple", "disc"].map((id) => t.handle.doc().objects[id].transform.position);
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(0.02);
    expect(t.carries).toEqual([]);
    expect(t.rec.sends).toEqual([["drew", { bag: BAG1, n: 2 }]]);
    for (const bad of [0, -1, 11, 2.5, "x", null]) t.run("draw-several", "bag1", bad);
    expect(t.ids(BAG1)).toEqual(["cube"]);
  });

  it("a peer took the same piece at the same moment: this view lets go and draws another, saying so once", async () => {
    const t = await filled({ carry: true });
    t.run("draw", "bag1");
    expect(t.carries.map((c) => c.id)).toEqual(["meeple"]);
    // the merge arrives: the mark on that put is the peer's
    t.bag(BAG1).change((d) => (d.items[outside(d)[0].tag].out = { by: "s-peer", n: 1 }));
    t.sync();
    expect(t.carries[0].cancelled).toBe(true);
    expect(t.handle.doc().objects.meeple).toBeDefined(); // it's the peer's: not removed
    expect(t.carries.map((c) => c.id)).toEqual(["meeple", "disc"]);
    expect(t.ids(BAG1)).toEqual(["cube"]);
    expect(t.rec.notices.filter((n) => /same moment/.test(n)).length).toBe(1);
    expect(t.rec.sends).toEqual([["drew", { bag: BAG1, n: 1 }]]); // told once
  });

  it("a piece that isn't loaded yet is picked up when it is, and not while a peer holds it", async () => {
    const t = await filled({ carry: true });
    delete t.half.meeple; // its GLB hasn't arrived
    t.run("draw", "bag1");
    expect(t.carries).toEqual([]);
    expect(t.rec.loops.size).toBe(1);
    t.half.meeple = 0.01;
    t.rec.held.set("meeple", "s-peer");
    t.frame();
    expect(t.carries).toEqual([]);
    t.rec.held.clear();
    t.frame();
    expect(t.carries.map((c) => c.id)).toEqual(["meeple"]);
  });

  it("the hand gave way to a peer's hold: picked up again if the peer lets go where it lies, given up (and another drawn) if the peer puts it somewhere", async () => {
    for (const placed of [false, true]) {
      const t = await filled({ carry: true });
      t.run("draw", "bag1");
      expect(t.carries.map((c) => c.id)).toEqual(["meeple"]);
      // both grabbed it at once, and the stage says the peer's hold was first
      t.rec.held.set("meeple", "s-peer");
      t.frame();
      expect(t.carries[0].cancelled).toBe(true);
      expect(t.rec.arms.at(-1).on).toBe(false);
      t.frame();
      expect(t.carries.length).toBe(1); // not while they hold it
      if (placed) t.handle.change((d) => (d.objects.meeple.transform.position = [0.3, 0, 0.3]));
      t.rec.held.clear();
      t.sync();
      t.frame();
      expect(t.carries.map((c) => c.id)).toEqual(placed ? ["meeple", "disc"] : ["meeple", "meeple"]);
      expect(t.handle.doc().objects.meeple).toBeDefined();
      expect(t.ids(BAG1)).toEqual(placed ? ["cube"] : ["cube", "disc"]);
    }
  });

  it("with replacement the item stays in and a copy is made the stage's way: addObject, with its fields", async () => {
    const t = await filled({ rule: "random-replace" });
    t.run("draw", "bag1");
    await vi.waitFor(() => expect(t.rec.added.length).toBe(1));
    expect(t.ids(BAG1).length).toBe(3);
    const { url, opts } = t.rec.added[0];
    const item = inside(t.bag(BAG1).doc()).find((x) => x.entry.object.sourceUrl === url).entry;
    expect([opts.providerId, opts.name]).toEqual(["file-glb", item.object.name]);
    expect(opts.fields.hint).toEqual(item.object.hint);
    expect(opts.transform.scale).toBe(1);
    expect(t.state("draw", "bag1").title).toMatch(/copy/);
  });

  it("Empty out is for setting up (edit only): everything set down round the bag", async () => {
    const play = await filled();
    expect(play.state("empty", "bag1")).toBeNull();
    const t = await filled({ activity: "edit" });
    expect(t.state("empty", "bag1")).toMatchObject({ title: "Set all 3 down round the bag" });
    t.run("empty", "bag1");
    expect(t.ids(BAG1)).toEqual([]);
    expect(["cube", "disc", "meeple"].every((id) => t.handle.doc().objects[id])).toBe(true);
    const spots = new Set(["cube", "disc", "meeple"].map((id) => JSON.stringify(t.handle.doc().objects[id].transform.position)));
    expect(spots.size).toBe(3);
    expect(t.rec.sends).toEqual([["emptied", { bag: BAG1, n: 3 }]]);
  });

  it("an item whose object is on the table isn't inside: not counted, not drawn (the scene wins)", async () => {
    const t = await filled();
    // a stray: listed in the bag, and an object in the scene
    t.handle.change((d) => (d.objects.meeple = token("Meeple", 0.7)));
    t.sync();
    expect(t.rec.labels[0].text).toBe("Red bag · 2");
    t.run("draw", "bag1");
    expect(t.ids(BAG1).sort()).toEqual(["cube", "meeple"]); // listed still, but the draw took disc
    expect(t.handle.doc().objects.disc).toBeDefined();
  });
});

describe("pouring", () => {
  it("tips one bag into another, whole; the others hear which bags and how many", async () => {
    const t = await table();
    for (const id of ["cube", "disc"]) t.run("put", id, "bag1");
    t.rec.sends.length = 0;
    expect(t.state("pour", "bag1").choices).toEqual([{ value: "bag2", label: "Pour into Blue bag" }]);
    expect(t.state("pour", "bag2")).toBeNull(); // nothing in it
    t.run("pour", "bag1", "bag2");
    expect([t.ids(BAG1), t.ids(BAG2)]).toEqual([[], ["cube", "disc"]]);
    expect(t.rec.sends).toEqual([["poured", { from: BAG1, to: BAG2, n: 2 }]]);
    expect(t.rec.labels.map((l) => l.text)).toEqual(["Red bag · 0", "Blue bag · 2"]);
  });
});

describe("looking inside", () => {
  it("docks the bag's own panel beside the scene, marked as an embed, and tells the others", async () => {
    const t = await table();
    t.run("put", "cube", "bag1");
    t.rec.sends.length = 0;
    expect(t.state("inside", "bag1")).toMatchObject({ checked: false });
    t.run("inside", "bag1");
    const edge = t.rec.edges.at(-1);
    expect([edge.dataset.side, edge.hasAttribute("data-stage-embed")]).toEqual(["right", true]);
    await vi.waitFor(() => expect(edge.querySelector(".bag-tool")).not.toBeNull());
    expect(edge.querySelector(".bag-tool .total").dataset.count).toBe("1");
    expect(t.state("inside", "bag1")).toMatchObject({ checked: true });
    expect(t.rec.sends).toEqual([["looked", { bag: BAG1 }]]);
    // its Draw sets the piece down in the scene
    [...edge.querySelectorAll("button")].find((b) => b.textContent === "Draw").click();
    expect(t.handle.doc().objects.cube).toBeDefined();
    t.run("inside", "bag1");
    expect(edge.isConnected).toBe(false);
  });
});

describe("what peers may tell us", () => {
  it("a well-formed message about a bag of this scene becomes a notice; anything else is dropped", async () => {
    const t = await table();
    const from = { session: "s-peer", viewer: "viewer:x" };
    t.instance.receive("drew", { bag: BAG1, n: 1 }, from);
    t.instance.receive("drew", { bag: BAG1, n: 3 }, from);
    t.instance.receive("put", { bag: BAG2, n: 2 }, from);
    t.instance.receive("poured", { from: BAG1, to: BAG2, n: 4 }, from);
    t.instance.receive("emptied", { bag: BAG1, n: 5 }, from);
    t.instance.receive("looked", { bag: BAG2 }, from);
    await vi.waitFor(() => expect(t.rec.notices.length).toBe(6));
    expect(t.rec.notices).toEqual([
      "Someone drew from Red bag",
      "Someone drew 3 from Red bag",
      "Someone put 2 things in Blue bag",
      "Someone poured Red bag into Blue bag (4)",
      "Someone emptied Red bag (5)",
      "Someone looked inside Blue bag",
    ]);
    t.rec.notices.length = 0;
    for (const [type, data] of [
      ["drew", null],
      ["drew", "x"],
      ["drew", { bag: BAG1 }],
      ["drew", { bag: BAG1, n: 0 }],
      ["drew", { bag: BAG1, n: 1.5 }],
      ["drew", { bag: BAG1, n: 1e9 }],
      ["drew", { bag: 7, n: 1 }],
      ["drew", { bag: "automerge:notabaghere", n: 1 }],
      ["drew", { bag: `automerge:${"x".repeat(600)}`, n: 1 }],
      ["poured", { from: BAG1, to: "https://evil", n: 1 }],
      ["constructor", { bag: BAG1, n: 1 }],
      ["stole", { bag: BAG1, n: 1 }],
    ]) t.instance.receive(type, data, from);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.rec.notices).toEqual([]);
    expect(Object.keys(MESSAGES).sort()).toEqual(["drew", "emptied", "looked", "poured", "put"]);
  });

  it("a peer is named by their contact", async () => {
    const repo = new FakeRepo();
    const ana = repo.add({ name: "Ana" });
    const t = await table({ repo });
    // from the first thing they say: the notice waits for the name
    t.instance.receive("looked", { bag: BAG1 }, { session: "s", viewer: ana.url });
    t.instance.receive("drew", { bag: BAG1, n: 1 }, { session: "s", viewer: ana.url });
    await vi.waitFor(() => expect(t.rec.notices).toEqual(["Ana looked inside Red bag", "Ana drew from Red bag"]));
    // someone whose contact can't be had is still heard, a moment later
    t.instance.receive("drew", { bag: BAG1, n: 1 }, { session: "s2", viewer: "automerge:nobody" });
    await vi.waitFor(() => expect(t.rec.notices.at(-1)).toBe("Someone drew from Red bag"));
  });
});

describe("stopping", () => {
  it("dispose stops listening to every bag's document and closes the panel", async () => {
    const t = await table();
    t.run("inside", "bag1");
    expect(t.bag(BAG1).listenerCount("change")).toBeGreaterThan(0);
    t.instance.dispose();
    expect([t.bag(BAG1).listenerCount("change"), t.bag(BAG2).listenerCount("change")]).toEqual([0, 0]);
    expect(t.rec.edges.at(-1).isConnected).toBe(false);
  });
});
