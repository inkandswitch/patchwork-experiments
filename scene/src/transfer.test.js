// Copying objects between scenes, as plain data: what's copied, what isn't,
// where it goes, and what the drag says about itself.
import { describe, it, expect } from "vitest";
import {
  ROW_MIME,
  assetsFor,
  cleanObject,
  describesOf,
  entryText,
  copyRefs,
  entryIn,
  refEdits,
  fromScene,
  hintBoxOf,
  liftOf,
  moveBy,
  needsText,
  planCopy,
  readRowPayload,
  refsOf,
  referenceOf,
  restOnConnector,
  renderSeed,
  rowPayload,
  runtimeOf,
  sizeOf,
  subtreeOf,
  summaryTypes,
} from "./transfer.js";
import { seededRenderDoc } from "./datatype.js";
import { composeMatrix, invertMatrix as invert, multiplyMatrices } from "./transform.js";
import { worldMatrix } from "./hierarchy.js";
import { intoSnap } from "./carry-rules.js";

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

  it("assetsFor: the source scene's entries naming copied files, unless this scene has the key", () => {
    const assets = { "s/mast@1": { url: "automerge:mastFile", hint: { bounds: null } }, "s/buoy@1": { url: "automerge:buoyFile" }, "s/wheel@1": { url: "automerge:wheelFile" } };
    expect(assetsFor(assets, ["automerge:mastFile", "automerge:wheelFile"], { "s/wheel@1": { url: "automerge:mine" } })).toEqual({ "s/mast@1": { url: "automerge:mastFile", hint: { bounds: null } } });
    expect(assetsFor(undefined, ["x"], {})).toEqual({});
  });

  it("renderSeed and seededRenderDoc: params by the same provider; the build too when it's the same source", () => {
    const result = { glbUrl: "automerge:glb", builtFrom: { heads: ["h"], paramsKey: "{}" }, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, builtAt: 5 };
    const r = { providerId: "shape-maker", parent: "automerge:src", params: { beam: 3.2 }, result, failure: { error: "x", inputs: "k" }, pinned: true };
    const seed = renderSeed(r);
    expect(seed).toEqual({ providerId: "shape-maker", parent: "automerge:src", params: { beam: 3.2 }, result, pinned: true });
    const fresh = { "@patchwork": { type: "scene-render" }, title: "Hull", parent: "automerge:src", providerId: "shape-maker", params: { beam: 3 }, pinned: false, result: null, failure: null };
    const doc = seededRenderDoc(fresh, seed);
    expect(doc).toEqual({ ...fresh, params: { beam: 3.2 }, result, pinned: true });
    expect(doc.result).not.toBe(seed.result);
    expect(doc.params).not.toBe(seed.params);
    // another source: the params, not the build
    expect(seededRenderDoc({ ...fresh, parent: "automerge:other" }, seed)).toMatchObject({ params: { beam: 3.2 }, result: null });
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

  // a rack's place: X up, Y (face) toward +Z, length along +X; a flat tray's: turned a quarter
  const STAND = [Math.PI / 2, Math.PI / 2, 0];
  const cols = (m) => [0, 1, 2].map((k) => [m[4 * k], m[4 * k + 1], m[4 * k + 2]].map((v) => +v.toFixed(9) + 0));
  it("moveBy into a connector's frame: one object goes into it, face up or down as it was; several take only its yaw", () => {
    const up = composeMatrix(T([1, 0, 0], [0, 0.3, 0], 2));
    const down = composeMatrix(T([1, 0, 0], [0, 0.3, Math.PI], 2));
    const into = (w, rotation) => multiplyMatrices(moveBy(referenceOf([w]), [5, 1, 5], null, rotation), w);
    // standing: the frame alone says which way it faces
    for (const w of [up, down]) {
      const m = into(w, STAND);
      expect(cols(m)).toEqual([[0, 2, 0], [0, 0, 2], [2, 0, 0]]);
      close([m[12], m[13], m[14]], [5, 1, 5]);
    }
    // flat, turned a quarter: face up stays up, face down stays down (turned over about its length)
    expect(cols(into(up, [0, Math.PI / 2, 0]))).toEqual([[0, 0, -2], [0, 2, 0], [2, 0, 0]]);
    expect(cols(into(down, [0, Math.PI / 2, 0]))).toEqual([[0, 0, 2], [0, -2, 0], [2, 0, 0]]);
    // several: the yaw only, as before
    const two = [composeMatrix(T([0, 0, 0])), composeMatrix(T([2, 0, 0]))];
    const m = moveBy(referenceOf(two), [5, 0, 5], Math.PI / 2, STAND);
    close([m[4], m[5], m[6]], [0, 1, 0]);
    expect(Math.atan2(m[8], m[10])).toBeCloseTo(Math.PI / 2, 9);
  });

  it("restOnConnector: a carried piece copied alone with a load hint rests on the connector the carry's way, frame or yaw; anything else by its origin", () => {
    const carry = { traits: { "scene.carry": {} } };
    // a domino lying flat (origin at the middle of its back), stood up in a rack's place at (0.3, 0.003, 0.016)
    const tile = obj("tile", { ...carry, transform: T([1, 0, 1], [0, 0, 0]), hint: { bounds: { min: [-0.0125, 0, -0.025], max: [0.0125, 0.0095, 0.025] } } });
    const land = { point: [0.3, 0.003, 0.016], yaw: Math.PI / 2, rotation: STAND, snapped: true };
    const rest = (objects, roots, l = land) => restOnConnector(objects, roots, [], l);
    const worldAt = (objects, roots, l) => planCopy({ objects, roots, target: { land: rest(objects, roots, l) } }).items[0].world;
    let W = worldAt({ tile }, ["tile"], land);
    // standing: across (X) is up, so its underside is at −0.0125 below its origin; its face's middle, 4.75 mm in
    close([W[12], W[13], W[14]], [0.3, 0.003 + 0.0125, 0.016 - 0.00475]);
    // a yaw-only connector rests it the same way: a piece whose origin is its corner, turned a quarter,
    // has the middle of its footprint over the connector (its X now along −Z, its Z along +X)
    const corner = obj("corner", { ...carry, transform: T([1, 0, 1]), hint: { bounds: { min: [0, 0, 0], max: [0.025, 0.0095, 0.05] } } });
    W = worldAt({ corner }, ["corner"], { ...land, rotation: null });
    close([W[12], W[13], W[14]], [0.3 - 0.025, 0.003, 0.016 + 0.0125]);
    expect(Math.atan2(W[8], W[10])).toBeCloseTo(Math.PI / 2, 9);
    // one top with something attached under it (moveBy turns the top): the top is rested
    const under = obj("under", { parent: "tile", transform: T([0, 0.01, 0]) });
    W = worldAt({ tile, under }, ["tile", "under"], land);
    close([W[12], W[13], W[14]], [0.3, 0.003 + 0.0125, 0.016 - 0.00475]);
    // not a carried piece (a part, made for its origin), even into a frame: untouched
    const part = { ...tile, traits: {} };
    expect(rest({ part }, ["part"])).toBe(land);
    expect(rest({ part }, ["part"], { ...land, rotation: null })).toEqual({ ...land, rotation: null });
    // not snapped, two top-level objects, no hint: untouched
    expect(rest({ tile }, ["tile"], { ...land, snapped: false })).toEqual({ ...land, snapped: false });
    expect(rest({ tile, b: tile }, ["tile", "b"])).toBe(land);
    const bare = obj("bare", { ...carry, transform: T([1, 0, 1]) });
    expect(rest({ bare }, ["bare"])).toBe(land);
  });

  it("moveBy turns one object the carry's way (carry-rules intoSnap), exactly as a carry would put it there", () => {
    const w = composeMatrix(T([1, 0.2, 1], [0.4, 0.3, -0.2], 1.5));
    for (const [rotation, yaw] of [[STAND, Math.PI / 2], [null, 1], [[0, Math.PI / 2, 0], Math.PI / 2], [null, null]]) {
      const m = multiplyMatrices(moveBy(referenceOf([w]), [5, 1, 5], yaw, rotation), w);
      const want = intoSnap(w, { rotation, yaw });
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(m[i]).toBeCloseTo(want[i], 12);
      close([m[12], m[13], m[14]], [5, 1, 5]);
    }
    // nothing to turn: exactly a move
    expect(moveBy(referenceOf([w]), [5, 1, 5]).slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
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

  it("copyRefs: an object field naming a copied object follows it (null: the copy's root); naming something else, outside says (kept in its own scene, else cleared and reported)", () => {
    const map = new Map([["lever", "c1"], ["door", "c2"], ["deck", null]]);
    const into = { "t.lever": { target: "door", speed: 2 } };
    expect(copyRefs(into, refs, { map })).toEqual({ lost: [], entries: [] });
    expect(into["t.lever"]).toEqual({ target: "c2", speed: 2 });
    const toRoot = { "t.lever": { target: "deck" } };
    copyRefs(toRoot, refs, { map });
    expect(toRoot["t.lever"].target).toBe(null);
    const same = { "t.lever": { target: "wall" } };
    expect(copyRefs(same, refs, { map, outside: (v) => v })).toEqual({ lost: [], entries: [] });
    expect(same["t.lever"].target).toBe("wall");
    const across = { "t.lever": { target: "wall" } };
    expect(copyRefs(across, refs, { map }).lost).toEqual([{ trait: "t.lever", key: "target", label: "Target" }]);
    expect(across["t.lever"]).toEqual({});
    const none = { "t.lever": { target: null } };
    copyRefs(none, refs, { map });
    expect(none["t.lever"]).toEqual({ target: null });
  });

  it("copyRefs: an entry field is kept where the scene it lands in has that entry, else cleared and reported; a copy: drop field is left behind", () => {
    const here = { "t.zone": { seat: "seat_1" } };
    expect(copyRefs(here, refs, { entries: entryIn({ "t.seats": { seat_1: { name: "N" } } }) }).entries).toEqual([]);
    expect(here["t.zone"].seat).toBe("seat_1");
    const there = { "t.zone": { seat: "seat_1" } };
    expect(copyRefs(there, refs, { entries: entryIn({}) }).entries).toEqual([{ trait: "t.zone", key: "seat", label: "Seat", of: "t.seats" }]);
    expect(there["t.zone"]).toEqual({});
    const sameScene = { "t.zone": { seat: "seat_9" } };
    copyRefs(sameScene, refs, { entries: () => true });
    expect(sameScene["t.zone"].seat).toBe("seat_9");
    const card = { "t.hidden": { by: "automerge:deck" } };
    copyRefs(card, refs, { entries: () => true, outside: (v) => v });
    expect(card["t.hidden"]).toEqual({});
  });

  it("refEdits, for what stays where it is: a dropped field kept, a reference cleared or kept by rule, null left alone", () => {
    const traits = { "t.lever": { target: "a" }, "t.zone": { seat: "p9" }, "t.hidden": { by: "automerge:x" } };
    const r = refEdits(traits, refs, { object: (v) => (v === "a" ? undefined : v), entry: () => false });
    expect(r.edits).toEqual([
      { trait: "t.lever", key: "target", to: undefined },
      { trait: "t.zone", key: "seat", to: undefined },
    ]);
    expect(r.lost).toEqual([{ trait: "t.lever", key: "target", label: "Target" }]);
    expect(refEdits({ "t.lever": { target: null } }, refs, { object: () => undefined, entry: () => true }).edits).toEqual([]);
  });

  it("the notices: a missing scene trait by its name (no article for a plural), a missing entry", () => {
    expect(needsText({ name: "Private zone", needName: "Seats" })).toBe("This private zone needs seats: add Seats to the scene.");
    expect(needsText({ name: "Lever", needName: "Orchard" })).toBe("This lever needs an orchard: add Orchard to the scene.");
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
