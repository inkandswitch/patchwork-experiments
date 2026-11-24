// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, until, settle } from "../test/stage-harness.js";
import select from "./select.js";
import others from "./others.js";
import { commandState } from "../stage/commands.js";
import { peerColor, peerSelections, hashString } from "../peers.js";
import { FakeRepo } from "../test/fake-repo.js";
import { emptyScene } from "../test/empty-scene.js";
import { LINK } from "../native/link-graph.js";
import { keyOf } from "../stage/paths.js";

const SELECT = { meta: { id: "scene.select" }, module: select };
const OTHERS = { meta: { id: "scene.others", traits: ["*"] }, module: others };
const group = (name, parent = null, extra = {}) => ({ kind: "group", name, group: parent, visible: true, opacity: 1, ...extra });
const layer = (name, grp, extra = {}) => object({ name, group: grp, ...extra });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

async function mount({ objects = { a: object({ name: "A" }), b: object({ name: "B" }) }, extensions = [], doc = {} } = {}) {
  s = await mountStage({ extensions: [SELECT, ...extensions], doc: { objects, order: Object.keys(objects), ...doc } });
  return s;
}

const sel = () => s.local.get().selected ?? null;
const run = (command, target = null, value) => s.api("scene.select").run({ ext: "scene.select", command, target, value });
const state = (command, target = null) => s.instance("scene.select").commands.find((c) => c.id === command).state(target, { scene: s.facet("scene.select").scene(), view: s.facet("scene.select").view.get() });
/** Make the viewport's pick say this object is under the pointer (there is no WebGL here). */
const hitOn = (id) => {
  s.debug.viewport.pick = () => (id ? { id, point: [0, 0, 0], normal: [0, 1, 0], distance: 1 } : null);
};
/** Boxes: the stage's (null without WebGL) replaced by a fixed one per id. */
const boxes = (map) => {
  s.facet("scene.select").box = (id) => map[id] ?? null;
  if (s.api("scene.others")) s.api("scene.others").box = (id) => map[id] ?? null;
};
const helpers = () => ["scene.select", "scene.others"].flatMap((k) => [...(s.debug.viewport.layers.get(k) ?? [])].flatMap((g) => g.children));
const lastPresence = () => s.handle.broadcasts.filter((m) => m.type === "scene:presence" && !m.bye).at(-1);
const mineSent = () => lastPresence()?.keys?.["scene.select"] ?? {};

function peer(session, keys, { viewer = `viewer:${session}`, seq = 1 } = {}) {
  s.handle.emit("ephemeral-message", { senderId: session, message: { type: "scene:presence", session, viewer, seq, at: Date.now(), keys } });
}

describe("scene.select: clicking", () => {
  it("is the Edit hand's click, ahead of every extension down the chain: a package's click verb never sees it", async () => {
    const log = [];
    const verb = { meta: { id: "t.verb" }, module: { create: () => ({ input: { click: (ev) => (log.push(ev.hit?.id ?? null), true) } }) } };
    await mount({ extensions: [verb] });
    hitOn("a");
    s.click(20, 20);
    expect(log).toEqual([]);
    expect(sel()).toBe("a");
    // on nothing it deselects, and that's Edit's too
    hitOn(null);
    s.click(20, 20);
    expect(log).toEqual([]);
    expect(sel()).toBeNull();
    // on nothing with nothing selected Edit has nothing to do: the chain has it
    s.click(20, 20);
    expect(log).toEqual([null]);
  });

  it("a widget's owner is offered the click first; a click it passes is still Edit's, and no package's verb sees it", async () => {
    const log = [];
    let claims = false;
    const widget = { meta: { id: "t.widget" }, module: { create: () => ({ input: { widgetAt: () => ({ onTop: true }), click: () => (log.push("widget"), claims) } }) } };
    const verb = { meta: { id: "t.verb" }, module: { create: () => ({ input: { click: (ev) => (log.push(`verb ${ev.hit?.id ?? null}`), true) } }) } };
    await mount({ extensions: [widget, verb] });
    hitOn("a");
    for (const c of [true, false]) {
      claims = c;
      log.length = 0;
      s.local.swap((m) => ({ ...m, selected: null }));
      await settle();
      s.click(20, 20);
      expect([c, log, sel()]).toEqual([c, ["widget"], c ? null : "a"]);
    }
    // on nothing, with nothing selected, Edit has nothing to do: the chain has it, the widget's owner offered once
    hitOn(null);
    s.local.swap((m) => ({ ...m, selected: null }));
    await settle();
    log.length = 0;
    s.click(20, 20);
    expect(log).toEqual(["widget", "verb null"]);
  });

  it("a hit on something the doc no longer has selects nothing", async () => {
    await mount();
    hitOn("zzz");
    s.click(20, 20);
    expect(sel()).toBeNull();
  });

  it("a click on a group's member selects the member, not the group", async () => {
    await mount({ objects: { g: group("G"), m: layer("M", "g") } });
    hitOn("m");
    s.click(5, 5);
    expect(sel()).toBe("m");
  });
});

describe("scene.select: keeping the selection honest", () => {
  it("clears the selection when its object goes (a peer removed it)", async () => {
    await mount();
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    s.change((d) => {
      delete d.objects.a;
      d.order = d.order.filter((x) => x !== "a");
    });
    await settle();
    expect(sel()).toBeNull();
  });

  it("leaves a ref (another extension's target) to its owner, and drops a gone object even if its id looks like one", async () => {
    await mount({ objects: { a: object({ name: "A" }), "odd:id": object({ name: "Odd" }) } });
    s.local.swap((m) => ({ ...m, selected: "dimension:d1" }));
    await settle();
    expect(sel()).toBe("dimension:d1");
    expect(helpers()).toEqual([]); // nothing to box
    // a click on nothing lets go of it, as of anything selected
    hitOn(null);
    s.click(20, 20);
    expect(sel()).toBeNull();
    // an object whose id has a colon is still an object, pruned when it goes
    s.local.swap((m) => ({ ...m, selected: "odd:id" }));
    await settle();
    s.change((d) => {
      delete d.objects["odd:id"];
    });
    await settle();
    expect(sel()).toBeNull();
    // a plain id that names nothing is let go of at once
    s.local.swap((m) => ({ ...m, selected: "zzz" }));
    await settle();
    expect(sel()).toBeNull();
  });

  it("asks the stage to load the selection first", async () => {
    await mount();
    const focus = vi.spyOn(s.facet("scene.select"), "focus");
    s.local.swap((m) => ({ ...m, selected: "b" }));
    await settle();
    expect(focus).toHaveBeenLastCalledWith(["b"]);
    s.local.swap((m) => ({ ...m, selected: "dimension:d1" })); // not an object: nothing to load
    await settle();
    expect(focus).toHaveBeenLastCalledWith([]);
    s.local.swap((m) => ({ ...m, selected: "b" }));
    await settle();
    s.local.swap((m) => ({ ...m, selected: null }));
    await settle();
    expect(focus).toHaveBeenLastCalledWith([]);
  });
});

describe("scene.select: presence", () => {
  it("tells peers what's selected and hovered", async () => {
    await mount();
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    await until(() => mineSent().selected === "a");
    s.local.swap((m) => ({ ...m, hovered: "b" }));
    await settle();
    await until(() => mineSent().hovered === "b");
    expect(mineSent().selected).toBe("a");
    s.local.swap((m) => ({ ...m, selected: null, hovered: null }));
    await settle();
    await until(() => mineSent().selected === undefined && mineSent().hovered === undefined);
  });

  it("draws its own selection box in the accent colour, and (scene.others) peers' in theirs, mine over theirs on the same object", async () => {
    await mount({ extensions: [OTHERS] });
    boxes({ a: { min: [0, 0, 0], max: [1, 1, 1] }, b: { min: [2, 0, 0], max: [3, 1, 1] } });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    expect(helpers()).toHaveLength(1);
    const mine = helpers()[0];
    expect(mine.userData.selection).toBe("self");
    expect(mine.box.min.toArray()).toEqual([0, 0, 0]);
    expect(mine.box.max.toArray()).toEqual([1, 1, 1]);
    const accent = s.local.get().theme.accent;
    const { THREE } = s.api("scene.select");
    const c = new THREE.Color().setRGB(accent[0], accent[1], accent[2], "srgb");
    expect(mine.material.color.getHex()).toBe(c.getHex());

    peer("p1", { "scene.select": { selected: "b" } });
    peer("p2", { "scene.select": { selected: "a" } }); // the same as mine: drawn under mine
    await settle();
    expect(helpers().map((h) => h.userData.selection).sort()).toEqual(["peer:p1", "peer:p2", "self"]);
    const order = Object.fromEntries(helpers().map((h) => [h.userData.selection, h.renderOrder]));
    expect(order.self > order["peer:p2"]).toBe(true);
    const theirs = helpers().find((h) => h.userData.selection === "peer:p1");
    expect(theirs.box.min.toArray()).toEqual([2, 0, 0]);
    const rgb = peerColor(s.local.get().theme.remote, "viewer:p1");
    expect(theirs.material.color.getHex()).toBe(new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], "srgb").getHex());

    // the peer deselects: their box goes
    peer("p1", { "scene.select": {} }, { seq: 2 });
    await settle();
    expect(helpers().map((h) => h.userData.selection).sort()).toEqual(["peer:p2", "self"]);

    // a peer's selection of something that isn't there is ignored
    peer("p3", { "scene.select": { selected: "nope" } });
    await settle();
    expect(helpers()).toHaveLength(2);

    // deselecting takes my box away; p2's box on a (drawn under mine) is left
    s.local.swap((m) => ({ ...m, selected: null }));
    await settle();
    expect(helpers().map((h) => h.userData.selection)).toEqual(["peer:p2"]);
  });

  it("follows a held pose within one frame: no doc change, no update", async () => {
    await mount();
    const f = s.facet("scene.select");
    // a unit box where the object is displayed (worldOf follows the pose)
    f.box = (id) => ((w) => w && { min: [w[12], w[13], w[14]], max: [w[12] + 1, w[13] + 1, w[14] + 1] })(f.worldOf(id));
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    expect(helpers()[0].box.min.toArray()).toEqual([0, 0, 0]);
    expect(f.use("poses").hold("a", { position: [4, 0, 0], rotation: [0, 0, 0], scale: 1 })).toBe(true);
    for (const fn of [...s.debug.viewport.afterHooks]) fn(null, { w: 200, h: 200 });
    expect(helpers()[0].box.min.toArray()).toEqual([4, 0, 0]);
  });

  it("boxes a group by its group box (api.box covers groups)", async () => {
    await mount({ objects: { g: group("G"), m: layer("M", "g") } });
    boxes({ g: { min: [-1, -1, -1], max: [1, 1, 1] } });
    s.local.swap((m) => ({ ...m, selected: "g" }));
    await settle();
    expect(helpers()).toHaveLength(1);
    expect(helpers()[0].box.max.toArray()).toEqual([1, 1, 1]);
  });

  it("follows the box when content arrives or the doc moves the object", async () => {
    await mount();
    const map = { a: null };
    boxes(map);
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    expect(helpers()).toHaveLength(0); // nothing to box yet
    map.a = { min: [0, 0, 0], max: [2, 2, 2] };
    s.change((d) => {
      d.objects.a.transform.position = [1, 0, 0];
    });
    await settle();
    expect(helpers()[0].box.max.toArray()).toEqual([2, 2, 2]);
  });
});

describe("scene.select: commands", () => {
  it("has no Deselect: Escape deselects (the Edit hand's escape, or the view's own with no hand held), then puts the editor down", async () => {
    await mount();
    expect(s.instance("scene.select").commands.find((x) => x.id === "deselect")).toBeUndefined();
    s.local.swap((m) => ({ ...m, selected: "a" }));
    expect(s.local.get().escape).toEqual({ layer: "selection", hint: "deselect" });
    s.key("Escape", { code: "Escape" });
    expect(sel()).toBeNull();
    s.local.swap((m) => ({ ...m, selected: "dimension:d1" })); // any target
    s.key("Escape", { code: "Escape" });
    expect(sel()).toBeNull();
    expect(s.local.get().escape).toEqual({ layer: "hand", hint: "put down Edit" });
    s.key("Escape", { code: "Escape" });
    expect(s.local.get().hands).toEqual([]);
    // not editing, a selection (the menu's Select) still clears on Escape
    s.local.swap((m) => ({ ...m, selected: "a" }));
    expect(s.local.get().escape).toEqual({ layer: "selection", hint: "deselect" });
    s.key("Escape", { code: "Escape" });
    expect(sel()).toBeNull();
    expect(s.local.get().escape).toEqual({ layer: null, hint: "" });
  });

  it("Select selects the object it's run on", async () => {
    await mount();
    expect(state("select")).toBeNull();
    expect(state("select", "zzz")).toBeNull();
    expect(run("select", "b")).toBe(true);
    expect(sel()).toBe("b");
    expect(state("select", "b").disabled).toBe(true);
  });

  it("Remove takes an object out (after every beforeRemove) and clears the selection", async () => {
    const seen = [];
    const dims = { meta: { id: "t.dims" }, module: { create: () => ({ beforeRemove: (d, ids) => seen.push([...ids]) }) } };
    await mount({ extensions: [dims] });
    const c = s.instance("scene.select").commands.find((x) => x.id === "remove");
    expect(c.key).toEqual(["Delete", "Backspace"]);
    expect(c.show).toEqual(["menu", "inspector"]);
    expect(state("remove")).toBeNull();
    expect(state("remove", "dimension:d1")).toBeNull(); // objects only
    s.local.swap((m) => ({ ...m, selected: "a" }));
    const ask = vi.spyOn(globalThis, "confirm");
    expect(run("remove", "a")).toBe(true);
    expect(ask).not.toHaveBeenCalled(); // a single object doesn't ask
    expect(s.doc().objects.a).toBeUndefined();
    expect(s.doc().order).toEqual(["b"]);
    expect(seen).toEqual([["a"]]);
    expect(sel()).toBeNull();
  });

  it("removing a group asks, with a count, and takes everything in it", async () => {
    const objects = {
      vessel: group("Solander 38"),
      body: group("BODY", "vessel"),
      hull: layer("HULL", "body"),
      deck: layer("DECK", "body"),
      bhd: layer("console bhd", "vessel", { visible: false }),
      battery: group("Battery (display)", null, { visible: false }),
      cell: layer("CELL", "battery"),
    };
    await mount({ objects });
    s.local.swap((m) => ({ ...m, selected: "hull" }));
    const ask = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    expect(run("remove", "vessel")).toBe(true); // it ran, and was refused
    expect(ask).toHaveBeenCalledWith(expect.stringContaining("“Solander 38” and the 4 objects in it"));
    expect(s.doc().objects.vessel).toBeTruthy();
    expect(sel()).toBe("hull");
    ask.mockReturnValue(true);
    run("remove", "vessel");
    expect(Object.keys(s.doc().objects).sort()).toEqual(["battery", "cell"]);
    expect(s.doc().order).toEqual(["battery", "cell"]);
    expect(sel()).toBeNull(); // hull went with it
  });

  it("an object attached to a removed one stays, at the scene root", async () => {
    await mount({ objects: { a: object({ name: "A", transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 } }), c: object({ name: "C", parent: "a" }) } });
    run("remove", "a");
    expect(s.doc().objects.c.parent).toBeNull();
    expect(s.doc().objects.c.transform.position).toEqual([1, 0, 0]);
  });
});

describe("scene.select: by body", () => {
  // Every body (the stage's Look; a walk and a seat over Look; a station
  // over a walk) × holding the editor or not × a click on an object or on
  // nothing × what was selected before (nothing, an object, a ref): only the
  // Edit hand's click selects (on nothing, it clears), whatever the body;
  // without it the selection is left be. Select from the menu selects in
  // every one, and Remove is the editor's.
  it("a click on an object or on nothing, in each body, from each selection", async () => {
    const bodies = { meta: { id: "t.bodies" }, module: { create: () => ({ bodies: [
      { id: "walk", label: "Walk", reach: 2, enter: () => ({ input: {}, leave() {} }) },
      { id: "seat", label: "Seat", reach: 2, here: false, enter: () => ({ input: {}, leave() {} }) },
      { id: "station", label: "Station", reach: 2.5, here: false, enter: () => ({ input: {}, leave() {} }) },
    ] }) } };
    await mount({ extensions: [bodies] });
    const api = s.api("t.bodies");
    // how to be in each: [stage base, ...bodies entered over it]
    const BODIES = { look: ["look"], walk: ["look", "walk"], seat: ["look", "seat"], station: ["look", "walk", "station"] };
    let cases = 0;
    for (const [name, path] of Object.entries(BODIES)) {
      for (const edit of [false, true]) {
        for (const before of [null, "a", "dimension:d1"]) {
          for (const on of ["b", null]) {
            for (const id of path) expect(api.body.enter(id)).toBe(true);
            s.edit(edit);
            await settle();
            expect(s.local.get().body.id).toBe(name);
            s.local.swap((m) => ({ ...m, selected: before }));
            hitOn(on);
            s.click(20, 20);
            await settle();
            // holding the editor, a click selects whatever the body
            const want = edit ? on : before;
            expect([name, edit, before, on, sel()]).toEqual([name, edit, before, on, want]);
            // Select is everyone's; Remove (Delete) is the editor's
            const pick = sel() === "a" ? "b" : "a";
            expect(run("select", pick)).toBe(true);
            expect(sel()).toBe(pick);
            const remove = s.instance("scene.select").commands.find((c) => c.id === "remove");
            expect(commandState(remove, "a", s.facet("scene.select").context()) != null).toBe(edit);
            // back to Look, nothing standing (the next case starts clean)
            expect(api.body.enter("look")).toBe(true);
            s.local.swap((m) => ({ ...m, selected: null }));
            await settle();
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(4 * 2 * 3 * 2);
    expect(s.doc().objects.a).toBeTruthy(); // nothing was removed
  }, 60_000);
});

describe("select-peers", () => {
  it("peerColor is stable per peer, stays near the remote hue, and differs between peers", () => {
    const remote = [0.6, 0.4, 0.9];
    expect(peerColor(remote, "viewer:x")).toEqual(peerColor(remote, "viewer:x"));
    const many = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => peerColor(remote, k).map((v) => v.toFixed(3)).join()));
    expect(many.size).toBeGreaterThan(2);
    for (const v of peerColor(remote, "q")) expect(v).toBeGreaterThanOrEqual(0) && expect(v).toBeLessThanOrEqual(1);
    expect(peerColor(null, "x")).toHaveLength(3);
    expect(hashString("abc")).toBe(hashString("abc"));
  });

  it("peerSelections reads each peer's keys, skipping missing objects", () => {
    const peers = {
      s2: { viewer: "v2", keys: { "scene.select": { selected: "a", hovered: "gone" } } },
      s1: { viewer: null, keys: { "scene.select": { hovered: "b" } } },
      s3: { viewer: "v3", keys: { other: { selected: "a" } } },
    };
    expect(peerSelections(peers, "scene.select", { a: {}, b: {} })).toEqual([
      { session: "s1", viewer: null, selected: null, hovered: "b" },
      { session: "s2", viewer: "v2", selected: "a", hovered: null },
    ]);
  });
});

describe("scene.others: wherever its doc is", () => {
  // A host with a live link L to G and a pin P of it. A peer on G's channel
  // selects G's card. scene.others is a part of every doc, so whatever the
  // focus, the card's peer box is drawn wherever G is drawn with its channel:
  // L, never P (a pin has no channel), never the host (the peer is not in
  // it), never twice. This view's own selection is scene.select's, only ever
  // in the focus doc.
  it("every focus × a selection of mine or none: the peer's box in L, mine only where the focus is, and the parts of every doc never restart", async () => {
    const repo = new FakeRepo();
    const g = repo.add(emptyScene({ title: "G", objects: { card: object({ name: "Card" }), die: object({ name: "Die" }) }, order: ["card", "die"] }));
    const link = (name, extra = {}) => object({ name, sourceUrl: g.url, providerId: LINK, renderUrl: null, ...extra });
    s = await mountStage({ repo, extensions: [SELECT, OTHERS], doc: { objects: { table: object({ name: "Table" }), L: link("G"), P: link("G fixed", { at: { heads: g.heads() } }) }, order: ["table", "L", "P"] } });
    const view = s.debug.view;
    const stageAt = (p) => view.stages().find((x) => x.path.join("/") === p);
    await until(() => stageAt("L") && stageAt("P"), 2000);
    const { THREE } = s.api("scene.select");
    // (no WebGL here: every object has one box, and every link's frame is the host's)
    view.viewport.objectBox = () => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    view.viewport.worldOf = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    g.emit("ephemeral-message", { senderId: "p1", message: { type: "scene:presence", session: "p1", viewer: "viewer:p1", seq: 1, at: Date.now(), keys: { "scene.select": { selected: "card" } } } });
    // each stage's boxes: which, per helper in its two layers
    const drawn = () =>
      Object.fromEntries(
        view.stages().map((x) => [
          x.path.join("/"),
          ["scene.select", "scene.others"].flatMap((id) => [...(view.viewport.layers.get(keyOf(x.n, id)) ?? [])].flatMap((l) => l.children.map((h) => h.userData.selection))).sort(),
        ]),
      );
    // the parts of every doc: one instance per stage, started once
    const instances = () => view.stages().map((x) => [x.path.join("/"), x.debug.host.instanceOf("scene.others")]);
    await until(() => instances().every(([, i]) => i), 2000);
    const first = instances();
    let n = 0;
    for (const focus of [[], ["L"]]) {
      for (const mine of [null, "die"]) {
        expect(view.focusOn(focus)).toBe(true);
        if (mine) view.select([...focus, focus.length ? mine : "table"]);
        else view.select(null);
        const want = { "": focus.length || !mine ? [] : ["self"], L: ["peer:p1", ...(focus.length && mine ? ["self"] : [])].sort(), P: [] };
        await until(() => JSON.stringify(drawn()) === JSON.stringify(want), 2000).catch(() => expect([focus, mine, drawn()]).toEqual([focus, mine, want]));
        // (and still, once this view has said what it selected on G's channel)
        await settle();
        expect([focus, mine, drawn()]).toEqual([focus, mine, want]);
        expect(instances()).toEqual(first);
        n++;
      }
    }
    expect(n).toBe(4);
  }, 30_000);
});
