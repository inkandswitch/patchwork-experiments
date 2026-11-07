// scene.transfer: a row from another scene dropped in the view is copied in
// where it lands (with what's under it, its files shared, its render docs its
// own, its runtime state left behind, a notice for a scene trait it needs);
// this scene's own rows dropped in the view do nothing; Copy and Paste.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import transfer, { besideOffset, clipText, pasteStep } from "./transfer.js";
import menuPart from "./menu.js";
import { ROW_MIME, endDrag, hold, rowPayload, startDrag, summaryTypes } from "../transfer.js";
import { composeMatrix, multiplyMatrices } from "../transform.js";

// what a ship's extension says about its traits: a ship's motion is runtime; a ship needs a sea
const SHIP = {
  meta: {
    id: "t.ship",
    traits: ["t.ship", "t.sea"],
    activities: ["play"],
    describes: { "t.ship": { name: "Ship", runtime: ["motion"], needs: ["t.sea"] }, "t.sea": { name: "Sea", on: "scene" } },
  },
  module: { create: () => ({}) },
};
const EXTS = [{ meta: { id: "scene.transfer", activities: ["edit"] }, module: transfer }, SHIP];

let s = null;
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  s?.unmount();
  s = null;
  endDrag();
  hold(null);
  vi.restoreAllMocks();
});

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const notices = () => (s.local.get().notices ?? []).map((n) => `${n.kind}: ${n.text}`);
const byName = (name) => {
  const objs = s.doc().objects;
  const id = Object.keys(objs).find((k) => objs[k].name === name);
  return id ? { id, ...objs[id] } : null;
};

function dragEvent(type, data, { x = 0, y = 0, alt = false } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), dropEffect: "none", getData: (t) => data[t] ?? "" } });
  Object.defineProperty(e, "clientX", { value: x });
  Object.defineProperty(e, "clientY", { value: y });
  Object.defineProperty(e, "altKey", { value: alt });
  return e;
}
function clipEvent(type, data = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const written = {};
  Object.defineProperty(e, "clipboardData", { value: { getData: (t) => data[t] ?? "", setData: (t, v) => (written[t] = v) } });
  e.written = written;
  return e;
}

/**
 * This scene: a hull at x = 5 with a mast step (tagged "mast") at (0, 1, 2)
 * in its frame. The other scene: a mast (a GLB file, tagged "mast", a ship's
 * traits, claimed) with a boom under it (built: an STL with a render doc)
 * and a sail under that; a crate on its own; assets for the mast's file and
 * something else.
 */
async function setup({ sea = false } = {}) {
  s = await mountStage({
    extensions: EXTS,
    doc: { objects: { hull: object({ name: "Hull", transform: T([5, 0, 0]) }) }, order: ["hull"], ...(sea ? { traits: { "t.sea": {} } } : {}) },
  });
  const repo = s.repo;
  const glb = repo.add({ "@patchwork": { type: "file" }, name: "mast.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(4) });
  const stl = repo.add({ "@patchwork": { type: "file" }, name: "boom.stl", extension: "stl", mimeType: "model/stl", content: new Uint8Array(84) });
  const glbOut = repo.add({ "@patchwork": { type: "file" }, name: "boom.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(4) });
  const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "Boom", parent: stl.url, providerId: "file-stl", params: { unit: "cm", up: "y" }, glbUrl: glbOut.url, builtFrom: { heads: stl.heads(), fingerprint: null, paramsKey: '{"unit":"cm","up":"y"}' }, builtAt: 7, bounds: null, status: "idle", error: null, pinned: false });
  const other = repo.add({
    "@patchwork": { type: "scene" },
    title: "Other",
    objects: {
      mast: object({ name: "Mast", sourceUrl: glb.url, providerId: "file-glb", tags: ["mast"], color: "#ff0000", locked: true, infoUrl: "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u", hint: { bounds: { min: [0, 0, 0], max: [0.2, 9, 0.2] } }, claims: { sim: { viewer: "v", session: "s" } }, traits: { "t.ship": { spec: { lwl: 9 }, motion: { velocity: [3, 0, 0] } } }, transform: T([40, 0, 0], [0, 0.7, 0], 1.5) }),
      boom: object({ name: "Boom", sourceUrl: stl.url, providerId: "file-stl", renderUrl: render.url, parent: "mast", transform: T([0, 1, 0.5], [0, 0.2, 0]) }),
      sail: object({ name: "Sail", sourceUrl: glb.url, providerId: "file-glb", parent: "boom", transform: T([0, 2, 0]) }),
      crate: object({ name: "Crate", sourceUrl: glb.url, providerId: "file-glb" }),
    },
    order: ["mast", "boom", "sail", "crate"],
    traits: { "t.sea": {} },
    view: {},
    dimensions: {},
    assets: { "t/mast@1": { url: glb.url }, "t/other@1": { url: "automerge:3k9knn3DsFnFYDFvXkyMu4UHyp7u" } },
  });
  const api = s.api("scene.transfer");
  // what's under the pointer: the hull at x < 100, else the ground
  api.pick = (x) => (x < 100 ? { id: "hull", point: [5.5, 1, 1.5] } : { id: null, point: [9, 0, 9] });
  api.content = (id) => (id === "hull" ? { extras: { connectors: [{ position: [0, 1, 2], yaw: null, tags: ["mast"] }], snapRadius: 2 } } : null);
  return { other, glb, stl, render, api };
}

const drop = async (payload, at) => {
  const e = dragEvent("drop", { [ROW_MIME]: payload }, at);
  s.canvas.dispatchEvent(e);
  for (let i = 0; i < 3; i++) await settle();
  return e;
};

describe("pure", () => {
  it("clipText: the first object's document link, else its name; besideOffset: its width and a tenth", () => {
    const objects = { a: object({ name: "A", sourceUrl: "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u" }), g: { kind: "group", name: "G" } };
    expect(clipText(objects, ["a"])).toBe("automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u");
    expect(clipText(objects, ["g"])).toBe("G");
    expect(besideOffset({ min: [0, 0, 0], max: [2, 1, 1] })[0]).toBeCloseTo(2.2, 9);
    expect(besideOffset(null)).toEqual([1, 0, 0]);
    expect(besideOffset(null, 3)).toEqual([3, 0, 0]);
    expect(pasteStep(0.5, 0)).toBe(0);
    expect(pasteStep(0.5, 2)).toBeCloseTo(2.2, 9);
    expect(pasteStep(null, 1)).toBe(1);
  });
});

describe("a row from another scene, dropped in the view", () => {
  it("is copied onto what it lands on, snapped to a connector that takes it, with what's under it; files shared, render docs its own, runtime state left behind", async () => {
    const { other, glb, stl, render } = await setup();
    const e = await drop(rowPayload(other.url, ["mast"]), { x: 50 });
    expect(e.defaultPrevented).toBe(true);
    const mast = byName("Mast");
    const boom = byName("Boom");
    const sail = byName("Sail");
    expect(byName("Crate")).toBeNull();
    // the mast on the hull, at its mast step, the hull's heading, its scale kept
    expect(mast).toMatchObject({ parent: "hull", sourceUrl: glb.url, providerId: "file-glb", renderUrl: null, tags: ["mast"], color: "#ff0000", locked: true, infoUrl: "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u", hint: { bounds: { max: [0.2, 9, 0.2] } } });
    mast.transform.position.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 2][i], 6));
    expect(mast.transform.scale).toBeCloseTo(1.5, 6);
    expect(mast.transform.rotation[1]).toBeCloseTo(0, 6);
    // runtime state stayed behind; settings came
    expect(mast.claims).toBeUndefined();
    expect(mast.traits).toEqual({ "t.ship": { spec: { lwl: 9 } } });
    // the boom and sail under it, as they were under it
    expect(boom).toMatchObject({ parent: mast.id, transform: T([0, 1, 0.5], [0, 0.2, 0]), sourceUrl: stl.url, providerId: "file-stl" });
    expect(sail).toMatchObject({ parent: boom.id, transform: T([0, 2, 0]) });
    // a render doc of its own, with the params and the build it had
    expect(boom.renderUrl).not.toBe(render.url);
    const mine = (await s.repo.find(boom.renderUrl)).doc();
    expect(mine).toMatchObject({ parent: stl.url, providerId: "file-stl", params: { unit: "cm", up: "y" }, glbUrl: render.doc().glbUrl, builtAt: 7 });
    s.change((d) => (d.objects[boom.id].name = "Boom here"));
    expect(render.doc().params).toEqual({ unit: "cm", up: "y" });
    // the mast's file's asset entry came with it, under the same key; nothing else did
    expect(s.doc().assets).toEqual({ "t/mast@1": { url: glb.url } });
    // the source is untouched
    expect(other.doc().objects.mast.claims).toBeTruthy();
    expect(Object.keys(other.doc().objects)).toHaveLength(4);
    // what it made is selected; a ship here without a sea is told so
    expect(s.local.get().selected).toBe(mast.id);
    expect(notices()).toContain("warn: This ship needs a sea: add Sea to the scene.");
    expect(s.doc().traits["t.sea"]).toBeUndefined();
  });

  it("no notice when the scene has what it needs; an asset key this scene has is left alone", async () => {
    const { other } = await setup({ sea: true });
    s.change((d) => (d.assets["t/mast@1"] = { url: "automerge:4k9knn3DsFnFYDFvXkyMu4UHyp7u" }));
    await drop(rowPayload(other.url, ["mast"]), { x: 50 });
    expect(byName("Mast")).toBeTruthy();
    expect(notices().filter((n) => n.includes("needs"))).toEqual([]);
    expect(s.doc().assets["t/mast@1"].url).toBe("automerge:4k9knn3DsFnFYDFvXkyMu4UHyp7u");
  });

  it("Alt places it where it was dropped; on the ground it goes under nothing and keeps its heading", async () => {
    const { other } = await setup();
    await drop(rowPayload(other.url, ["mast"]), { x: 50, alt: true });
    const m1 = byName("Mast");
    m1.transform.position.forEach((v, i) => expect(v).toBeCloseTo([0.5, 1, 1.5][i], 6));
    s.change((d) => {
      for (const k of Object.keys(d.objects)) if (k !== "hull") delete d.objects[k];
      d.order = ["hull"];
    });
    await drop(rowPayload(other.url, ["crate"]), { x: 150 });
    expect(byName("Crate")).toMatchObject({ parent: null, transform: { position: [9, 0, 9] } });
    await drop(rowPayload(other.url, ["mast"]), { x: 150 });
    const m2 = byName("Mast");
    expect(m2.parent).toBeNull();
    expect(m2.transform.rotation[1]).toBeCloseTo(0.7, 6);
    m2.transform.position.forEach((v, i) => expect(v).toBeCloseTo([9, 0, 9][i], 6));
    // and the sail under the boom is where it was relative to the mast
    const mW = composeMatrix(m2.transform);
    const sail = byName("Sail");
    const boom = byName("Boom");
    expect(multiplyMatrices(multiplyMatrices(mW, composeMatrix(boom.transform)), composeMatrix(sail.transform))[13]).toBeCloseTo(0 + 1.5 * (1 + 2), 6);
  });

  it("a row of this scene dropped in the view does nothing (moving rows is the outline's)", async () => {
    await setup();
    const heads = s.handle.heads();
    const types = { [ROW_MIME]: rowPayload(s.handle.url, ["hull"]), ...summaryTypes(s.handle.url, 2) };
    const over = dragEvent("dragover", types, { x: 50 });
    s.canvas.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    const e = await drop(rowPayload(s.handle.url, ["hull"]), { x: 50 });
    expect(e.defaultPrevented).toBe(false);
    expect(s.handle.heads()).toEqual(heads);
  });

  it("dragging over: taken, with a ring where it lands, sized by the drag's summary (or what the outline beside it said)", async () => {
    const { other } = await setup();
    const api = s.instance("scene.transfer");
    const over = dragEvent("dragover", { [ROW_MIME]: "", ...summaryTypes(other.url, 1.25) }, { x: 50 });
    s.canvas.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect(api.debug.ring()).toMatchObject({ at: { parent: "hull" }, radius: 1.25, snapped: false });
    // the same page's outline started it: its tags snap the ring, its size sizes it
    startDrag({ scene: other.url, ids: ["mast"], radius: 0.4, tags: ["mast"], name: "Mast" });
    s.canvas.dispatchEvent(dragEvent("dragover", { [ROW_MIME]: "" }, { x: 50 }));
    expect(api.debug.ring()).toMatchObject({ snapped: true, radius: 0.4 });
    s.canvas.dispatchEvent(dragEvent("dragleave", { [ROW_MIME]: "" }));
    expect(api.debug.ring()).toBeNull();
  });

  it("a group comes with everything in it, in a new group", async () => {
    const { other } = await setup();
    other.change((d) => {
      d.objects.g = { kind: "group", name: "Rig", group: null, visible: true, opacity: 1 };
      d.objects.crate.group = "g";
      d.order.push("g");
    });
    await drop(rowPayload(other.url, ["g"]), { x: 150 });
    const g = byName("Rig");
    expect(g).toMatchObject({ kind: "group", group: null });
    expect(g.id).not.toBe("g");
    expect(byName("Crate")).toMatchObject({ group: g.id, transform: { position: [9, 0, 9] } });
    expect(s.local.get().selected).toBe(g.id);
  });
});

describe("copy and paste", () => {
  it("Copy puts the selection on the clipboard; Paste in another scene copies it where the view is looking", async () => {
    const { other, glb } = await setup();
    // copying in the other scene is the same as this: the payload with the link
    s.local.swap((m) => ({ ...m, selected: "hull" }));
    const c = clipEvent("copy");
    s.root.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(true);
    const written = JSON.parse(c.written[ROW_MIME]);
    expect(written).toMatchObject({ scene: s.handle.url, id: "hull", ids: ["hull"] });
    expect(typeof written.copy).toBe("string"); // which Copy it was: repeats of it are counted
    // nothing selected: the browser's
    s.local.swap((m) => ({ ...m, selected: null }));
    const none = clipEvent("copy");
    s.root.dispatchEvent(none);
    expect(none.defaultPrevented).toBe(false);
    // a paste from the other scene: in the middle of the view (the ground at 9, 0, 9 here, as the port has no size)
    s.api("scene.transfer").pick = () => ({ id: null, point: [9, 0, 9] });
    const p = clipEvent("paste", { [ROW_MIME]: rowPayload(other.url, ["crate"]), "text/plain": glb.url });
    s.root.dispatchEvent(p);
    expect(p.defaultPrevented).toBe(true);
    for (let i = 0; i < 3; i++) await settle();
    expect(byName("Crate")).toMatchObject({ sourceUrl: glb.url, transform: { position: [9, 0, 9] } });
  });

  it("Paste in its own scene is a duplicate beside the original, on the same parent", async () => {
    await setup();
    s.change((d) => {
      d.objects.cleat = object({ name: "Cleat", parent: "hull", transform: T([0, 1, 0]) });
      d.order.push("cleat");
    });
    await settle();
    s.local.swap((m) => ({ ...m, selected: "cleat" }));
    const c = clipEvent("copy");
    s.root.dispatchEvent(c);
    const p = clipEvent("paste", { ...c.written });
    s.root.dispatchEvent(p);
    for (let i = 0; i < 3; i++) await settle();
    const copies = Object.entries(s.doc().objects).filter(([, o]) => o.name === "Cleat");
    expect(copies).toHaveLength(2);
    const [id, dup] = copies.find(([k]) => k !== "cleat");
    expect(dup.parent).toBe("hull");
    // no box here: moved by a unit in the world
    dup.transform.position.forEach((v, i) => expect(v).toBeCloseTo([1, 1, 0][i], 6));
    expect(s.local.get().selected).toBe(id);
  });

  it("a paste whose text is what the menu's Copy wrote is that copy; any other text is left to scene.add", async () => {
    const { other, glb } = await setup();
    hold({ scene: other.url, ids: ["crate"], text: glb.url, name: "Crate" });
    const plain = clipEvent("paste", { "text/plain": "automerge:5k9knn3DsFnFYDFvXkyMu4UHyp7u" });
    s.root.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const ours = clipEvent("paste", { "text/plain": glb.url });
    s.root.dispatchEvent(ours);
    expect(ours.defaultPrevented).toBe(true);
    for (let i = 0; i < 3; i++) await settle();
    expect(byName("Crate")).toBeTruthy();
  });

  it("the menu offers Copy on an object and Paste on the scene, once something is copied", async () => {
    s = await mountStage({ extensions: [{ meta: { id: "scene.menu" }, module: menuPart }, ...EXTS], doc: { objects: { hull: object({ name: "Hull" }) }, order: ["hull"] } });
    await settle();
    const cmds = s.instance("scene.transfer").commands;
    const ctx = { scene: s.debug.scene?.() ?? { objects: s.doc().objects }, local: s.local.get() };
    const copy = cmds.find((c) => c.id === "copy");
    const paste = cmds.find((c) => c.id === "paste");
    expect(copy.state("hull", ctx)).toBeTruthy();
    expect(copy.state(null, ctx)).toBeNull();
    expect(paste.state(null, ctx)).toBeNull();
    copy.run("hull");
    expect(paste.state(null, ctx)).toMatchObject({ label: "Paste “Hull”" });
    expect(paste.state("hull", ctx)).toBeNull();
  });
});

describe("landing on its base", () => {
  it("a copy whose origin is its middle lands on its base, by the drag's lift or, without one, its hint; a snapped one by its origin", async () => {
    const { other } = await setup();
    other.change((d) => {
      d.objects.crate.hint = { bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } };
      d.objects.crate.transform = { position: [3, 0.5, 0], rotation: [0, 0, 0], scale: 1 };
    });
    // no lift in the payload: from its hint (its origin 0.5 above its base)
    await drop(rowPayload(other.url, ["crate"]), { x: 150 });
    byName("Crate").transform.position.forEach((v, i) => expect(v).toBeCloseTo([9, 0.5, 9][i], 6));
    s.change((d) => {
      for (const k of Object.keys(d.objects)) if (k !== "hull") delete d.objects[k];
      d.order = ["hull"];
    });
    // the drag says how far (measured where it's drawn): that wins
    await drop(rowPayload(other.url, ["crate"], { lift: 0.25 }), { x: 150 });
    byName("Crate").transform.position.forEach((v, i) => expect(v).toBeCloseTo([9, 0.25, 9][i], 6));
    // snapped to a connector: its origin goes to the connector (connectors are made for an origin at the base)
    await drop(rowPayload(other.url, ["mast"], { lift: 3 }), { x: 50 });
    byName("Mast").transform.position.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 2][i], 6));
  });
});

describe("references", () => {
  // a lever that names the object it works, and a private zone whose seat is an entry of the scene's seats
  const LEVERS = {
    meta: {
      id: "t.lever",
      traits: ["t.lever", "t.zone", "t.seats"],
      activities: ["play"],
      describes: {
        "t.lever": { name: "Lever", fields: [{ key: "target", label: "Target", kind: "object" }] },
        "t.zone": { name: "Private zone", fields: [{ key: "seat", label: "Seat", kind: "entry", of: "t.seats" }] },
        "t.seats": { name: "Seats", on: "scene", entries: { noun: "seat", prefix: "seat", fields: [] } },
      },
    },
    module: { create: () => ({}) },
  };
  async function mountWith(doc) {
    s = await mountStage({ extensions: [...EXTS, LEVERS], doc });
    const api = s.api("scene.transfer");
    api.pick = () => ({ id: null, point: [9, 0, 9] });
    return api;
  }

  it("a field naming an object copied with it points at the copy; one naming something left behind is cleared, with a notice", async () => {
    await mountWith({ objects: {}, order: [] });
    const other = s.repo.add({
      "@patchwork": { type: "scene" },
      objects: {
        door: object({ name: "Door" }),
        lever: object({ name: "Lever", parent: "door", traits: { "t.lever": { target: "door" } } }),
        far: object({ name: "Far lever", traits: { "t.lever": { target: "door" } } }),
      },
      order: ["door", "lever", "far"],
      traits: {},
      view: {},
      dimensions: {},
      assets: {},
    });
    await drop(rowPayload(other.url, ["door"]), { x: 150 });
    const door = byName("Door");
    expect(byName("Lever").traits["t.lever"].target).toBe(door.id);
    await drop(rowPayload(other.url, ["far"]), { x: 150 });
    expect(byName("Far lever").traits["t.lever"]).toEqual({});
    expect(notices()).toContain("warn: This lever's target was left behind: choose one in the inspector.");
    // the source still points at its own
    expect(other.doc().objects.lever.traits["t.lever"].target).toBe("door");
  });

  it("a duplicate in its own scene: its own parts' references go to the copies, others stay", async () => {
    await mountWith({
      objects: {
        door: object({ name: "Door" }),
        lever: object({ name: "Lever", parent: "door", traits: { "t.lever": { target: "door" } } }),
        far: object({ name: "Far lever", traits: { "t.lever": { target: "door" } } }),
      },
      order: ["door", "lever", "far"],
    });
    await settle();
    await s.instance("scene.transfer").paste({ scene: s.handle.url, ids: ["door"] });
    for (let i = 0; i < 3; i++) await settle();
    const doors = Object.keys(s.doc().objects).filter((k) => s.doc().objects[k].name === "Door");
    const copy = doors.find((k) => k !== "door");
    const lever2 = Object.entries(s.doc().objects).find(([k, o]) => o.name === "Lever" && k !== "lever")[1];
    expect(lever2.traits["t.lever"].target).toBe(copy);
    await s.instance("scene.transfer").paste({ scene: s.handle.url, ids: ["far"] });
    for (let i = 0; i < 3; i++) await settle();
    const fars = Object.entries(s.doc().objects).filter(([, o]) => o.name === "Far lever");
    expect(fars.map(([, o]) => o.traits["t.lever"].target)).toEqual(["door", "door"]);
  });

  it("an entry field: kept where this scene has that entry; else cleared, and the notice names what's missing", async () => {
    await mountWith({ objects: {}, order: [], traits: { "t.seats": { seat_b: { name: "B" } } } });
    const other = s.repo.add({
      "@patchwork": { type: "scene" },
      objects: { z1: object({ name: "Zone 1", traits: { "t.zone": { seat: "seat_b" } } }), z2: object({ name: "Zone 2", traits: { "t.zone": { seat: "seat_a" } } }) },
      order: ["z1", "z2"],
      traits: { "t.seats": { seat_a: { name: "A" }, seat_b: { name: "B" } } },
      view: {},
      dimensions: {},
      assets: {},
    });
    await drop(rowPayload(other.url, ["z1"]), { x: 150 });
    expect(byName("Zone 1").traits["t.zone"].seat).toBe("seat_b");
    await drop(rowPayload(other.url, ["z2"]), { x: 150 });
    expect(byName("Zone 2").traits["t.zone"]).toEqual({});
    expect(notices()).toContain("warn: This private zone's seat isn't one of this scene's seats: choose one in the inspector.");
    // a scene without seats at all: the zone needs them
    s.change((d) => delete d.traits["t.seats"]);
    await drop(rowPayload(other.url, ["z1"]), { x: 150 });
    expect(notices()).toContain("warn: This private zone needs seats: add Seats to the scene.");
  });
});

describe("repeats", () => {
  it("pasting the same Copy again: in its own scene each one more width along; in another, each beside the last, under nothing unless it snaps", async () => {
    const { other, api } = await setup();
    s.change((d) => {
      d.objects.cleat = object({ name: "Cleat", transform: T([0, 0, 0]) });
      d.order.push("cleat");
    });
    await settle();
    s.local.swap((m) => ({ ...m, selected: "cleat" }));
    const c = clipEvent("copy");
    s.root.dispatchEvent(c);
    for (let n = 0; n < 3; n++) {
      s.root.dispatchEvent(clipEvent("paste", { ...c.written }));
      for (let i = 0; i < 3; i++) await settle();
    }
    const xs = Object.entries(s.doc().objects)
      .filter(([k, o]) => o.name === "Cleat" && k !== "cleat")
      .map(([, o]) => o.transform.position[0])
      .sort();
    xs.forEach((x, i) => expect(x).toBeCloseTo(i + 1, 6));
    // into this scene from the other: the view's middle is over the hull, but a crate doesn't snap there: on the surface, under nothing
    api.pick = () => ({ id: "hull", point: [5.5, 1, 1.5] });
    api.raycast = (o) => ({ id: o[0] < 6 ? "hull" : null, point: [o[0], o[0] < 6 ? 1 : 0, o[2]] });
    hold({ scene: other.url, ids: ["crate"], text: "x", name: "Crate", copy: "k7", radius: 0.5 });
    const payload = { scene: other.url, ids: ["crate"], copy: "k7" };
    await s.instance("scene.transfer").paste(payload);
    await s.instance("scene.transfer").paste(payload);
    for (let i = 0; i < 3; i++) await settle();
    const crates = Object.values(s.doc().objects).filter((o) => o.name === "Crate");
    expect(crates.map((o) => o.parent)).toEqual([null, null]);
    const ps = crates.map((o) => o.transform.position).sort((a, b) => a[0] - b[0]);
    ps[0].forEach((v, i) => expect(v).toBeCloseTo([5.5, 1, 1.5][i], 6));
    // a step of its width (2 × 0.5 × 1.1) along, onto the ground there
    ps[1].forEach((v, i) => expect(v).toBeCloseTo([6.6, 0, 1.5][i], 6));
    // a mast does snap there: under the hull
    await s.instance("scene.transfer").paste({ scene: other.url, ids: ["mast"], copy: "k8" });
    for (let i = 0; i < 3; i++) await settle();
    expect(byName("Mast").parent).toBe("hull");
  });
});

describe("the menu's Copy", () => {
  it("writes what ⌘C writes (the payload and the link) through a copy event of its own; else the link alone", async () => {
    await setup();
    const cmds = s.instance("scene.transfer").commands;
    const copy = cmds.find((c) => c.id === "copy");
    let written = null;
    const doc = s.root.ownerDocument;
    const had = doc.execCommand;
    doc.execCommand = (cmd) => {
      if (cmd !== "copy") return false;
      const e = clipEvent("copy");
      doc.dispatchEvent(e);
      written = e.written;
      return e.defaultPrevented;
    };
    try {
      copy.run("hull");
    } finally {
      doc.execCommand = had;
    }
    expect(JSON.parse(written[ROW_MIME])).toMatchObject({ scene: s.handle.url, ids: ["hull"] });
    expect("text/plain" in written).toBe(true);
    // no copy event (the browser won't): the link alone
    const writeText = vi.fn(() => Promise.resolve());
    const nav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText } }, configurable: true });
    doc.execCommand = () => false;
    try {
      copy.run("hull");
    } finally {
      doc.execCommand = had;
      Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
    }
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
