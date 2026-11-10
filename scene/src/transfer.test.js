// Copying objects between scenes, as plain data: what's copied, what isn't,
// where it goes, and what the drag says about itself.
import { describe, it, expect } from "vitest";
import {
  ROW_MIME,
  assetsFor,
  cleanObject,
  describesOf,
  entryText,
  fixRefs,
  fromScene,
  hintBoxOf,
  liftOf,
  missingNeeds,
  moveBy,
  needsText,
  planCopy,
  readRowPayload,
  refsOf,
  referenceOf,
  renderSeed,
  rowPayload,
  runtimeOf,
  sizeOf,
  subtreeOf,
  summaryTypes,
} from "./transfer.js";
import { seededRenderDoc } from "./stage/stage.js";
import { composeMatrix, decomposeMatrix, invertMatrix as invert, multiplyMatrices } from "./transform.js";
import { worldMatrix } from "./hierarchy.js";

const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const obj = (name, extra = {}) => ({ name, sourceUrl: `automerge:${name}`, providerId: "file-glb", renderUrl: null, parent: null, group: null, visible: true, color: null, opacity: 1, wireframe: false, transform: T(), ...extra });
const grp = (name, extra = {}) => ({ kind: "group", name, group: null, visible: true, opacity: 1, ...extra });
const close = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const SCENE = "automerge:2j9knn3DsFnFYDFvXkyMu4UHyp7u";

describe("the payload and the drag's summary", () => {
  it("rowPayload / readRowPayload: { scene, id, ids }; nothing without ids", () => {
    expect(readRowPayload(rowPayload(SCENE, ["a", "b"]))).toEqual({ scene: SCENE, id: "a", ids: ["a", "b"] });
    expect(readRowPayload(JSON.stringify({ scene: SCENE, id: "a" }))).toBeNull();
    expect(readRowPayload("{bad")).toBeNull();
    expect(readRowPayload(JSON.stringify({ scene: SCENE }))).toBeNull();
    expect(readRowPayload("")).toBeNull();
    // how far it lands above its origin, and which Copy it was
    expect(readRowPayload(rowPayload(SCENE, ["a"], { lift: 0.5, copy: "k1" }))).toEqual({ scene: SCENE, id: "a", ids: ["a"], lift: 0.5, copy: "k1" });
    expect(readRowPayload(rowPayload(SCENE, ["a"], { lift: NaN }))).toEqual({ scene: SCENE, id: "a", ids: ["a"] });
  });

  it("summaryTypes: where it's from (lower-cased id) and its size, readable from the types alone", () => {
    const types = summaryTypes(SCENE, 1.2345678);
    expect(Object.keys(types).sort()).toEqual(["application/x-scene-object-from;2j9knn3dsfnfydfvxkymu4uhyp7u", "application/x-scene-object-size;r=1.235"]);
    // as a browser gives them back during dragover: types only, lower-cased
    const dt = { types: [ROW_MIME, ...Object.keys(types).map((t) => t.toLowerCase())] };
    expect(sizeOf(dt)).toBe(1.235);
    expect(fromScene(dt, SCENE)).toBe(true);
    expect(fromScene(dt, "automerge:3k9knn3DsFnFYDFvXkyMu4UHyp7u")).toBe(false);
    expect(fromScene({ types: [ROW_MIME] }, SCENE)).toBeNull();
    expect(sizeOf({ types: [ROW_MIME] })).toBeNull();
    // no size, no size type
    expect(Object.keys(summaryTypes(SCENE, null))).toHaveLength(1);
  });
});

describe("what's copied", () => {
  const objects = {
    hull: obj("hull"),
    mast: obj("mast", { parent: "hull" }),
    boom: obj("boom", { parent: "mast" }),
    sail: obj("sail", { parent: "boom" }),
    crate: obj("crate"),
    g: grp("G"),
    inner: grp("Inner", { group: "g" }),
    a: obj("a", { group: "g" }),
    b: obj("b", { group: "inner" }),
    bChild: obj("bChild", { parent: "b" }),
  };
  const order = ["hull", "mast", "boom", "sail", "crate", "g", "inner", "a", "b", "bChild"];

  it("subtreeOf: the roots, everything attached under them, everything filed in a copied group; parents first", () => {
    expect(subtreeOf(objects, ["mast"], order).ids).toEqual(["mast", "boom", "sail"]);
    expect(subtreeOf(objects, ["crate"], order).ids).toEqual(["crate"]);
    const g = subtreeOf(objects, ["g"], order).ids;
    expect(new Set(g)).toEqual(new Set(["g", "inner", "a", "b", "bChild"]));
    for (const [child, parent] of [["inner", "g"], ["b", "inner"], ["bChild", "b"]]) expect(g.indexOf(child)).toBeGreaterThan(g.indexOf(parent));
    // creation order follows parents even when the scene's order doesn't
    expect(subtreeOf(objects, ["mast"], ["sail", "boom", "mast"]).ids).toEqual(["mast", "boom", "sail"]);
    expect(subtreeOf(objects, ["gone"], order).ids).toEqual([]);
  });

  it("runtime state never goes: claims, and trait keys an extension's describes marks runtime", () => {
    const describes = describesOf([
      { describes: { "t.ship": { name: "Ship", runtime: ["motion"], fields: [{ key: "speed", runtime: true }, { key: "spec" }] }, "t.trail": { name: "Trail", runtime: true } } },
      // a later plugin describing the same key doesn't win
      { describes: { "t.ship": { name: "Other", runtime: [] } } },
    ]);
    expect(describes.get("t.ship").name).toBe("Ship");
    const runtime = runtimeOf(describes);
    expect(runtime.get("t.trail")).toBe(true);
    expect([...runtime.get("t.ship")].sort()).toEqual(["motion", "speed"]);
    const o = obj("ship", { claims: { sim: { viewer: "v", session: "s" } }, tags: ["hull"], locked: true, hint: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } }, infoUrl: "automerge:info", traits: { "t.ship": { spec: { lwl: 9 }, motion: { velocity: [1, 0, 0] }, speed: 3 }, "t.trail": { points: [] }, "t.other": { x: 1 } } });
    const c = cleanObject(o, runtime);
    expect(c.claims).toBeUndefined();
    expect(c.traits).toEqual({ "t.ship": { spec: { lwl: 9 } }, "t.other": { x: 1 } });
    expect(c).toMatchObject({ name: "ship", tags: ["hull"], locked: true, infoUrl: "automerge:info", hint: { bounds: { max: [1, 1, 1] } } });
    // a fresh copy: the source is untouched
    expect(o.traits["t.ship"].motion).toBeTruthy();
    expect(o.claims).toBeTruthy();
  });

  it("missingNeeds: a scene trait a copied trait needs and the scene lacks, said once, by name", () => {
    const describes = describesOf([{ describes: { "t.ship": { name: "Ship", needs: ["t.sea"] }, "t.float": { name: "Float", needs: ["t.sea"] }, "t.sea": { name: "Sea", on: "scene" }, "t.helm": { name: "Helm", needs: ["t.arena"] } } }]);
    const missing = missingNeeds(describes, ["t.ship", "t.float", "t.helm"], {});
    expect(missing.map((n) => n.need)).toEqual(["t.sea", "t.arena"]);
    expect(needsText(missing[0])).toBe("This ship needs a sea: add Sea to the scene.");
    expect(needsText(missing[1])).toBe("This helm needs a t.arena: add t.arena to the scene.");
    expect(missingNeeds(describes, ["t.ship"], { "t.sea": {} })).toEqual([]);
  });

  it("assetsFor: the source scene's entries naming copied files, unless this scene has the key", () => {
    const assets = { "s/mast@1": { url: "automerge:mastFile", hint: { bounds: null } }, "s/buoy@1": { url: "automerge:buoyFile" }, "s/wheel@1": { url: "automerge:wheelFile" } };
    expect(assetsFor(assets, ["automerge:mastFile", "automerge:wheelFile"], { "s/wheel@1": { url: "automerge:mine" } })).toEqual({ "s/mast@1": { url: "automerge:mastFile", hint: { bounds: null } } });
    expect(assetsFor(undefined, ["x"], {})).toEqual({});
  });

  it("renderSeed and seededRenderDoc: params by the same provider; the build too when it's the same source", () => {
    const r = { providerId: "camber", parent: "automerge:src", params: { beam: 3.2 }, glbUrl: "automerge:glb", builtFrom: { heads: ["h"], paramsKey: "{}" }, builtAt: 5, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, status: "building", error: "x", pinned: true };
    const seed = renderSeed(r);
    expect(seed).toEqual({ providerId: "camber", parent: "automerge:src", params: { beam: 3.2 }, glbUrl: "automerge:glb", builtFrom: { heads: ["h"], paramsKey: "{}" }, builtAt: 5, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, pinned: true });
    const fresh = { "@patchwork": { type: "scene-render" }, title: "Hull", parent: "automerge:src", providerId: "camber", params: { beam: 3 }, glbUrl: null, builtFrom: null, builtAt: null, bounds: null, status: "idle", error: null, pinned: false };
    const doc = seededRenderDoc(fresh, seed);
    expect(doc).toMatchObject({ params: { beam: 3.2 }, glbUrl: "automerge:glb", builtFrom: { heads: ["h"] }, builtAt: 5, status: "idle", error: null, pinned: true, title: "Hull" });
    expect(doc.params).not.toBe(seed.params);
    // another source: the params, not the build
    expect(seededRenderDoc({ ...fresh, parent: "automerge:other" }, seed)).toMatchObject({ params: { beam: 3.2 }, glbUrl: null, builtFrom: null });
    // another provider: nothing
    expect(seededRenderDoc({ ...fresh, providerId: "stl" }, seed)).toEqual({ ...fresh, providerId: "stl" });
    expect(seededRenderDoc(fresh, null)).toBe(fresh);
  });
});

describe("where it goes", () => {
  it("referenceOf: one object's origin and heading; several, the middle of their origins at the lowest", () => {
    const one = composeMatrix(T([1, 2, 3], [0, 0.5, 0]));
    const r = referenceOf([one]);
    close(r.point, [1, 2, 3]);
    expect(r.yaw).toBeCloseTo(0.5, 9);
    const two = referenceOf([composeMatrix(T([0, 1, 0])), composeMatrix(T([4, 3, 2]))]);
    expect(two).toEqual({ point: [2, 1, 1], yaw: 0 });
  });

  it("moveBy: puts the reference at the point, turned to the yaw (or not)", () => {
    const m = moveBy({ point: [1, 0, 0], yaw: 0.25 }, [10, 2, 5], 1.25);
    const w = multiplyMatrices(m, composeMatrix(T([1, 0, 0], [0, 0.25, 0])));
    const t = decomposeMatrix(w);
    close(t.position, [10, 2, 5]);
    expect(Math.atan2(w[8], w[10])).toBeCloseTo(1.25, 9);
    const keep = decomposeMatrix(multiplyMatrices(moveBy({ point: [1, 0, 0], yaw: 0.25 }, [3, 0, 0], null), composeMatrix(T([1, 0, 0], [0, 0.25, 0]))));
    close(keep.rotation, [0, 0.25, 0]);
    close(keep.position, [3, 0, 0]);
  });

  // a mast (tilted, scaled) with a boom under it, on a hull in the source
  const src = {
    hull: obj("hull", { transform: T([20, 0, 0], [0, 0.3, 0]) }),
    mast: obj("mast", { parent: "hull", transform: T([0, 1, 1], [0.1, 0.2, 0], 2) }),
    boom: obj("boom", { parent: "mast", transform: T([0, 2, 0.5], [0, 0.4, 0]) }),
  };

  it("landing on an object: the top goes under it at the point and turns to the given heading; its tilt, scale and what's under it come as they were", () => {
    const parentWorld = composeMatrix(T([5, 0, 0], [0, -0.5, 0]));
    const { items, tops } = planCopy({ objects: src, roots: ["mast"], target: { land: { point: [5, 1, 2], yaw: -0.5, parent: "hull2", parentWorld } } });
    expect(tops).toEqual(["mast"]);
    const mast = items.find((i) => i.from === "mast");
    const boom = items.find((i) => i.from === "boom");
    expect(mast).toMatchObject({ top: true, parentIn: "hull2", parent: null });
    expect(boom).toMatchObject({ top: false, parent: "mast", transform: src.boom.transform });
    // in the world: at the point, heading −0.5, the scale kept
    const w = multiplyMatrices(parentWorld, composeMatrix(mast.transform));
    close([w[12], w[13], w[14]], [5, 1, 2]);
    expect(Math.atan2(w[8], w[10])).toBeCloseTo(-0.5, 9);
    expect(mast.transform.scale).toBeCloseTo(2, 9);
    // its tilt relative to its heading is what it was
    const before = worldMatrix(src, "mast");
    const tiltBefore = multiplyMatrices(composeMatrix(T([0, 0, 0], [0, -Math.atan2(before[8], before[10]), 0])), before);
    const tiltAfter = multiplyMatrices(composeMatrix(T([0, 0, 0], [0, 0.5, 0])), w);
    close(tiltAfter.slice(0, 11), tiltBefore.slice(0, 11));
    // and the boom is where it was relative to the mast
    close(multiplyMatrices(w, composeMatrix(boom.transform)), multiplyMatrices(w, composeMatrix(src.boom.transform)));
    expect(boom.world).not.toBeNull();
  });

  it("on the ground with no heading: keeps its own heading", () => {
    const { items } = planCopy({ objects: src, roots: ["mast"], target: { land: { point: [0, 0, 0], yaw: null } } });
    const mast = items.find((i) => i.from === "mast");
    const before = worldMatrix(src, "mast");
    const w = composeMatrix(mast.transform);
    close([w[12], w[13], w[14]], [0, 0, 0]);
    close(w.slice(0, 11), before.slice(0, 11));
    expect(mast.parentIn).toBeNull();
  });

  it("a landing the tree placed in a group: the top goes in that group (what's under it follows its parent)", () => {
    const { items } = planCopy({ objects: src, roots: ["mast"], target: { land: { point: [0, 0, 0], yaw: null, group: "g9" } } });
    expect(items.find((i) => i.from === "mast")).toMatchObject({ parentIn: null, groupIn: "g9" });
    expect(items.find((i) => i.from === "boom").groupIn).toBeUndefined();
    // no group said: whatever its new parent is in
    expect(planCopy({ objects: src, roots: ["mast"], target: { land: { point: [0, 0, 0] } } }).items[0].groupIn).toBeUndefined();
  });

  it("beside (a duplicate in its own scene): on the same parent, in the same group, moved by the offset in the world", () => {
    const { items } = planCopy({ objects: { ...src, mast: { ...src.mast, group: "gx" }, gx: grp("X") }, roots: ["mast"], target: { beside: { offset: [3, 0, 0] } } });
    const mast = items.find((i) => i.from === "mast");
    expect(mast).toMatchObject({ parentIn: "hull", groupIn: "gx" });
    const w = multiplyMatrices(worldMatrix(src, "hull"), composeMatrix(mast.transform));
    const before = worldMatrix(src, "mast");
    close([w[12], w[13], w[14]], [before[12] + 3, before[13], before[14]]);
    // measured from the doc, both sides: the duplicate is the original's local, moved (no pose of the parent gets in)
    close(composeMatrix(mast.transform), multiplyMatrices(multiplyMatrices(invert(worldMatrix(src, "hull")), composeMatrix(T([3, 0, 0]))), worldMatrix(src, "mast")));
  });

  it("a group: the group and its members, the members moved together (the group has no transform)", () => {
    const objects = { g: grp("G"), a: obj("a", { group: "g", transform: T([0, 0, 0]) }), b: obj("b", { group: "g", transform: T([2, 0, 0]) }) };
    const { items, tops } = planCopy({ objects, roots: ["g"], target: { land: { point: [10, 0, 10], yaw: null } } });
    expect(tops).toEqual(["a", "b"]);
    expect(items.find((i) => i.from === "g")).toMatchObject({ group: true, groupIn: null });
    expect(items.find((i) => i.from === "a")).toMatchObject({ groupOf: "g", transform: { position: [9, 0, 10] } });
    expect(items.find((i) => i.from === "b").transform.position).toEqual([11, 0, 10]);
  });
});

describe("references in traits", () => {
  // a lever whose target is another object; a zone whose seat is an entry of the scene's seats; a card whose deck is keyed by object id
  const describes = describesOf([
    {
      describes: {
        "t.lever": { name: "Lever", fields: [{ key: "target", label: "Target", kind: "object" }, { key: "speed", kind: "number" }] },
        "t.zone": { name: "Private zone", fields: [{ key: "seat", label: "Seat", kind: "entry", of: "t.seats" }] },
        "t.seats": { name: "Seats", on: "scene" },
        "t.hidden": { name: "Hidden card", fields: [{ key: "by", label: "Deck", kind: "url", copy: "drop" }] },
      },
    },
  ]);
  const refs = refsOf(describes);

  it("refsOf: object and entry fields, and fields marked copy: drop", () => {
    expect(refs.get("t.lever")).toEqual([{ key: "target", kind: "object", of: undefined, label: "Target", drop: false }]);
    expect(refs.get("t.zone")[0]).toMatchObject({ key: "seat", kind: "entry", of: "t.seats" });
    expect(refs.get("t.hidden")[0]).toMatchObject({ key: "by", drop: true });
    expect(refs.has("t.seats")).toBe(false);
  });

  it("an object field naming a copied object is set later (to its copy); naming something else, kept in the same scene and cleared in another", () => {
    const into = { "t.lever": { target: "door", speed: 2 } };
    expect(fixRefs(into, refs, { copied: new Set(["lever", "door"]), same: false })).toMatchObject({ later: [{ trait: "t.lever", key: "target", to: "door" }], lost: [] });
    expect(into["t.lever"]).toEqual({ speed: 2 });
    const same = { "t.lever": { target: "door" } };
    expect(fixRefs(same, refs, { copied: new Set(["lever"]), same: true })).toMatchObject({ later: [], lost: [] });
    expect(same["t.lever"].target).toBe("door");
    const across = { "t.lever": { target: "door" } };
    expect(fixRefs(across, refs, { copied: new Set(["lever"]), same: false }).lost).toEqual([{ trait: "t.lever", key: "target", label: "Target" }]);
    expect(across["t.lever"]).toEqual({});
  });

  it("an entry field is kept where this scene has that entry, else cleared and reported; a copy: drop field is left behind", () => {
    const here = { "t.zone": { seat: "seat_1" } };
    expect(fixRefs(here, refs, { sceneTraits: { "t.seats": { seat_1: { name: "N" } } } }).entries).toEqual([]);
    expect(here["t.zone"].seat).toBe("seat_1");
    const there = { "t.zone": { seat: "seat_1" } };
    expect(fixRefs(there, refs, { sceneTraits: {} }).entries).toEqual([{ trait: "t.zone", key: "seat", label: "Seat", of: "t.seats" }]);
    expect(there["t.zone"]).toEqual({});
    const sameScene = { "t.zone": { seat: "seat_9" } };
    fixRefs(sameScene, refs, { same: true, sceneTraits: {} });
    expect(sameScene["t.zone"].seat).toBe("seat_9");
    const card = { "t.hidden": { by: "automerge:deck" } };
    fixRefs(card, refs, { same: true });
    expect(card["t.hidden"]).toEqual({});
  });

  it("the notices: a missing scene trait by its name (no article for a plural), a missing entry", () => {
    expect(needsText({ name: "Private zone", needName: "Seats" })).toBe("This private zone needs seats: add Seats to the scene.");
    expect(needsText({ name: "Ship", needName: "Sea" })).toBe("This ship needs a sea: add Sea to the scene.");
    expect(entryText({ name: "Private zone", label: "Seat", ofName: "Seats" })).toBe("This private zone's seat isn't one of this scene's seats: choose one in the inspector.");
  });
});

describe("landing on its base", () => {
  it("liftOf: the reference origin's height above the lowest box in the copy", () => {
    // a crate whose origin is its middle, at y = 0.5, with a lid on top
    const objects = { crate: obj("crate", { transform: T([0, 0.5, 0]) }), lid: obj("lid", { parent: "crate", transform: T([0, 0.5, 0]) }) };
    const boxes = { crate: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, lid: { min: [-0.5, 1, -0.5], max: [0.5, 1.1, 0.5] } };
    const lift = liftOf(objects, ["crate"], [], { box: (id) => boxes[id] ?? null, worldOf: (id) => worldMatrix(objects, id) });
    expect(lift).toBeCloseTo(0.5, 9);
    expect(liftOf(objects, ["crate"], [], { box: () => null, worldOf: (id) => worldMatrix(objects, id) })).toBeNull();
  });

  it("hintBoxOf: the hint's bounds through the doc's transforms", () => {
    const objects = { c: obj("c", { hint: { bounds: { min: [-1, -1, -1], max: [1, 1, 1] } }, transform: T([0, 2, 0], [0, 0, 0], 0.5) }) };
    expect(hintBoxOf(objects, "c")).toEqual({ min: [-0.5, 1.5, -0.5], max: [0.5, 2.5, 0.5] });
    expect(hintBoxOf({ d: obj("d") }, "d")).toBeNull();
  });
});
