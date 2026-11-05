import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { PLAY, mountStage, object, until, settle } from "../test/stage-harness.js";
import select from "./select.js";
import { peerColor, peerSelections, hashString } from "../peers.js";

const SELECT = { meta: { id: "scene.select", activities: ["edit"] }, module: select };
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
const state = (command, target = null) => s.instance("scene.select").commands.find((c) => c.id === command).state(target, { scene: s.api("scene.select").scene(), local: s.local.get() });
/** Make the viewport's pick say this object is under the pointer (there is no WebGL here). */
const hitOn = (id) => {
  s.debug.viewport.pick = () => (id ? { id, point: [0, 0, 0], normal: [0, 1, 0], distance: 1 } : null);
};
/** Boxes: the stage's (null without WebGL) replaced by a fixed one per id. */
const boxes = (map) => {
  s.api("scene.select").box = (id) => map[id] ?? null;
};
const helpers = () => [...(s.debug.viewport.layers.get("scene.select") ?? [])].flatMap((g) => g.children);
const lastPresence = () => s.handle.broadcasts.filter((m) => m.type === "scene:presence" && !m.bye).at(-1);
const mineSent = () => lastPresence()?.keys?.["scene.select"] ?? {};

function peer(session, keys, { viewer = `viewer:${session}`, seq = 1 } = {}) {
  s.handle.emit("ephemeral-message", { senderId: session, message: { type: "scene:presence", session, viewer, seq, at: Date.now(), keys } });
}

describe("scene.select: clicking", () => {
  it("a click on an object selects it; a click on nothing clears", async () => {
    await mount();
    hitOn("a");
    s.click(20, 20);
    await settle();
    expect(sel()).toBe("a");
    hitOn("b");
    s.click(20, 20);
    expect(sel()).toBe("b");
    hitOn(null);
    s.click(20, 20);
    expect(sel()).toBeNull();
  });

  it("an empty click with nothing selected isn't claimed", async () => {
    await mount();
    expect(s.instance("scene.select").input.click({ hit: null })).toBe(false);
    expect(s.instance("scene.select").input.click({ hit: { id: "a" } })).toBe(true);
    expect(s.instance("scene.select").input.click({ hit: null })).toBe(true);
    expect(sel()).toBeNull();
  });

  it("a hit on something the doc no longer has selects nothing", async () => {
    await mount();
    expect(s.instance("scene.select").input.click({ hit: { id: "zzz" } })).toBe(false);
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
    const api = s.api("scene.select");
    const focus = vi.spyOn(api, "focus");
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

  it("draws its own selection box in the accent colour, and peers' in theirs", async () => {
    await mount();
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
    peer("p2", { "scene.select": { selected: "a" } }); // the same as mine: no second box
    await settle();
    expect(helpers().map((h) => h.userData.selection).sort()).toEqual(["peer:p1", "self"]);
    const theirs = helpers().find((h) => h.userData.selection === "peer:p1");
    expect(theirs.box.min.toArray()).toEqual([2, 0, 0]);
    const rgb = peerColor(s.local.get().theme.remote, "viewer:p1");
    expect(theirs.material.color.getHex()).toBe(new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], "srgb").getHex());

    // the peer deselects: their box goes
    peer("p1", { "scene.select": {} }, { seq: 2 });
    await settle();
    expect(helpers().map((h) => h.userData.selection)).toEqual(["self"]);

    // a peer's selection of something that isn't there is ignored
    peer("p3", { "scene.select": { selected: "nope" } });
    await settle();
    expect(helpers()).toHaveLength(1);

    // deselecting takes my box away; p2's box on a (hidden under mine) shows
    s.local.swap((m) => ({ ...m, selected: null }));
    await settle();
    expect(helpers().map((h) => h.userData.selection)).toEqual(["peer:p2"]);
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
  it("Deselect applies to the scene only while something is selected", async () => {
    await mount();
    const c = s.instance("scene.select").commands.find((x) => x.id === "deselect");
    expect(c.key).toBe("Escape");
    expect(c.show).toEqual([]);
    expect(state("deselect")).toBeNull();
    expect(run("deselect")).toBe(false);
    s.local.swap((m) => ({ ...m, selected: "a" }));
    expect(state("deselect")).not.toBeNull();
    expect(state("deselect", "a")).toBeNull();
    expect(run("deselect")).toBe(true);
    expect(sel()).toBeNull();
    s.local.swap((m) => ({ ...m, selected: "dimension:d1" })); // any target
    expect(run("deselect")).toBe(true);
    expect(sel()).toBeNull();
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

describe("scene.select: stopping", () => {
  it("takes its boxes and presence keys with it when this viewer switches to an activity it isn't in", async () => {
    await mount({ extensions: [PLAY] });
    boxes({ a: { min: [0, 0, 0], max: [1, 1, 1] } });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    await until(() => mineSent().selected === "a");
    await s.activity("play");
    expect(s.instance("scene.select")).toBeFalsy();
    expect(s.debug.viewport.layers.get("scene.select")).toBeUndefined();
    await until(() => !("scene.select" in (lastPresence()?.keys ?? {})));
  });
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
