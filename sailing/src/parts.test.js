// Sailing's parts for the bin, on a stand-in for the stage's drop context
// (test/fakes.js fakeDrop): what each puts in, under what, with which traits,
// squared to the ship it's put on, and one file per kind per scene.
import { describe, it, expect, afterEach } from "vitest";
import * as parts from "./parts.js";
import { PIECES, fileKey, placement } from "./parts.js";
import { FIT, LIFT, STAND, TAGS, jibDrawing, winchTrait } from "./ship.js";
import { ANCHOR, FLOAT, HELM, HOOK, JIB, LADDER, SAIL, SEA, SHIP, WEATHER, WINCH, partsOf } from "./traits.js";
import { placeIn } from "./body.js";
import { apply } from "./frames.js";
import { DEPTH, createSim } from "./sim.js";
import { emptyScene, fakeDrop, fakeWorld } from "./test/fakes.js";

/** An object's own traits but walk's (crew.test.js pins those, part kind × hull). */
const own = (traits) => {
  const out = Object.fromEntries(Object.entries(traits ?? {}).filter(([k]) => !k.startsWith("walk.")));
  return Object.keys(out).length ? out : undefined;
};
const near = (a, b, digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const children = (doc, id) => Object.keys(doc.objects).filter((k) => doc.objects[k].parent === id);
/** Where a point local to `id` is in `root`'s frame (doc transforms). */
const inFrame = (doc, id, root, p = [0, 0, 0]) => apply(placeIn(doc, id, root), p);
/** Which way an object's own −Z (its bow) points in `root`'s frame. */
const bowIn = (doc, id, root) => {
  const m = placeIn(doc, id, root);
  const l = Math.hypot(m[8], m[9], m[10]);
  return [-m[8] / l, -m[9] / l, -m[10] / l];
};

/** A scene with a hull that's a ship: `trait` its sailing.ship, at `transform`. */
function withHull(trait = {}, transform = { position: [5, 0, 5], rotation: [0, 0.4, 0], scale: 1 }) {
  const doc = emptyScene();
  doc.objects.hull = { name: "Hull", parent: null, transform, traits: { [SHIP]: trait } };
  doc.order.push("hull");
  return doc;
}

describe("the parts", () => {
  it("each puts its pieces in, the part first and the rest under it, with the traits that make them work", async () => {
    const want = {
      mast: [["Mast", undefined], ["Boom and sail", { [SAIL]: { raised: 1, sheet: 0.5 } }], ["Jib", { [JIB]: { sheet: 0.5, held: null, furl: 0 } }]],
      winches: [["Port jib winch", { [WINCH]: winchTrait(-1) }], ["Starboard jib winch", { [WINCH]: winchTrait(1) }]],
      wheel: [["Wheel", { [HELM]: { angle: 0 } }]],
      windlass: [["Windlass", { [ANCHOR]: { down: false, rode: 0 } }], ["Anchor", { [HOOK]: {} }]],
      ladder: [["Ladder", { [LADDER]: {} }]],
      redBuoy: [["Red buoy", { [FLOAT]: {} }]],
      greenBuoy: [["Green buoy", { [FLOAT]: {} }]],
      islet: [["Islet", undefined]],
    };
    for (const [name, pieces] of Object.entries(want)) {
      const doc = emptyScene();
      const { ctx } = fakeDrop(doc);
      const id = await parts[name].create(ctx, { parent: null, transform: { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 } });
      expect(doc.order[0]).toBe(id);
      expect(doc.objects[id].name).toBe(pieces[0][0]);
      expect(own(doc.objects[id].traits)).toEqual(pieces[0][1]);
      expect(doc.objects[id].locked).toBe(false);
      // put on nothing: where the bin said, as it said
      expect(doc.objects[id].transform).toEqual({ position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 });
      const rest = children(doc, id);
      expect(rest.map((k) => [doc.objects[k].name, own(doc.objects[k].traits)])).toEqual(pieces.slice(1));
      for (const k of rest) {
        const piece = PIECES[name].find((p) => p.name === doc.objects[k].name);
        // a pair's mirror: across her centreline from where the part went (put on nothing: the stock stand's x)
        if (piece.mirror) near(doc.objects[k].transform.position, [-2 * FIT.winch.position[0], 0, 0]);
        else expect(doc.objects[k].transform.position).toEqual(piece.at);
        expect(doc.objects[k].transform.rotation).toEqual(piece.rotation ?? [0, 0, 0]);
      }
      for (const o of Object.values(doc.objects)) expect(o.providerId).toBe("file-glb");
    }
  });

  it("a part that fits a stand carries its tag, as the bin's metadata says, so the hand snaps it alike", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    for (const [name, tag] of [["mast", "sailing.mast"], ["wheel", "sailing.helm"], ["windlass", "sailing.windlass"], ["ladder", "sailing.ladder"], ["winches", "sailing.winch"]]) {
      const id = await parts[name].create(ctx, { parent: null, transform: {} });
      expect(doc.objects[id].tags).toEqual([tag]);
      expect(TAGS[name]).toBe(tag);
    }
    const buoy = await parts.redBuoy.create(ctx, { parent: null, transform: {} });
    expect(doc.objects[buoy].tags).toBeUndefined();
  });

  it("puts nothing if what it was put on goes while its files are made", async () => {
    const doc = withHull({});
    const { ctx, calls } = fakeDrop(doc);
    const file = ctx.file;
    ctx.file = async (key, make) => {
      delete doc.objects.hull; // a peer deletes her meanwhile
      return file(key, make);
    };
    const before = doc.order.length;
    expect(await parts.mast.create(ctx, { parent: "hull", transform: { position: [0, 1, 0] } })).toBe(null);
    expect(doc.order.length).toBe(before);
    expect(calls.notices.at(-1).text).toMatch(/gone/);
  });

  it("share the scene's one file per kind: ten buoys, one GLB doc", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    for (let i = 0; i < 10; i++) await parts.redBuoy.create(ctx, { parent: null, transform: { position: [i * 5, 0, 0] } });
    await parts.greenBuoy.create(ctx, { parent: null, transform: { position: [0, 0, 9] } });
    expect(calls.made.map((m) => m.key)).toEqual([fileKey("redBuoy"), fileKey("greenBuoy")]);
    expect(fileKey("redBuoy")).toBe("sailing/redBuoy@1");
    const red = Object.values(doc.objects).filter((o) => o.name === "Red buoy");
    expect(red).toHaveLength(10);
    expect(new Set(red.map((o) => o.sourceUrl))).toEqual(new Set([doc.assets[fileKey("redBuoy")].url]));
    expect(red[0].hint.bounds.min).toHaveLength(3);
    // and a sloop dropped later reuses what's there
    await parts.mast.create(ctx, { parent: null, transform: {} });
    await parts.mast.create(ctx, { parent: null, transform: {} });
    expect(calls.made.filter((m) => m.key === fileKey("mast"))).toHaveLength(1);
    expect(calls.made.at(-1)).toMatchObject({ extension: "glb", mimeType: "model/gltf-binary" });
  });
});

describe("put on a ship", () => {
  it("squares itself to her body frame: its bow is hers, where her model's bow is +X", async () => {
    for (const trait of [{ frame: { rotation: [0, -Math.PI / 2, 0] } }, { frame: { position: [0, 0, 0], rotation: [0, -Math.PI / 2, 0] } }]) {
      const doc = withHull(trait);
      const { ctx } = fakeDrop(doc);
      const id = await parts.windlass.create(ctx, { parent: "hull", transform: { position: [4, 1.5, 0], rotation: [0.05, 0.3, 0], scale: 1 } });
      near(bowIn(doc, id, "hull"), [1, 0, 0]);
      near(inFrame(doc, id, "hull"), [4, 1.5, 0]);
      // its anchor hangs ahead of it, toward her bow (+X in her model)
      const [hook] = children(doc, id);
      expect(inFrame(doc, hook, "hull")[0]).toBeGreaterThan(5.5);
    }
  });

  it("reads her frame from her GLB when the stage can say", async () => {
    const doc = withHull({});
    const { ctx } = fakeDrop(doc, { content: { hull: { extras: { ship: { forward: [-1, 0, 0], up: [0, 1, 0] } } } } });
    const id = await parts.wheel.create(ctx, { parent: "hull", transform: { position: [0, 0.7, 0] } });
    near(bowIn(doc, id, "hull"), [-1, 0, 0]);
  });

  it("stands where it was put, its origin its own height above (the wheel's axle)", async () => {
    const doc = withHull({ frame: { rotation: [0, -Math.PI / 2, 0] } });
    const { ctx } = fakeDrop(doc);
    const id = await parts.wheel.create(ctx, { parent: "hull", transform: { position: [-3, 0.72, 0] } });
    near(inFrame(doc, id, "hull"), [-3, 0.72 + LIFT.wheel, 0]);
    expect(own(doc.objects[id].traits)).toEqual({ [HELM]: { angle: 0 } });
  });

  it("put on something aboard her (her mast), still squares to her, whatever way that was put", async () => {
    const doc = withHull({ frame: { rotation: [0, -Math.PI / 2, 0] } });
    doc.objects.post = { name: "Post", parent: "hull", transform: { position: [1, 1, 0], rotation: [0, 1.1, 0], scale: 2 } };
    doc.order.push("post");
    const { ctx } = fakeDrop(doc);
    const id = await parts.mast.create(ctx, { parent: "post", transform: { position: [0, 0.5, 0] } });
    expect(doc.objects[id].parent).toBe("post");
    near(bowIn(doc, id, "hull"), [1, 0, 0]);
    // the rig hangs under the mast, and the ship finds her sail through the chain
    const sc = fakeWorld(doc).scene();
    expect(partsOf(sc, "hull").sail).toBe(children(doc, id)[0]);
  });

  it("a ladder on her port side turns to hang outboard; on starboard it doesn't", async () => {
    const doc = withHull({ frame: { rotation: [0, -Math.PI / 2, 0] } });
    const { ctx } = fakeDrop(doc);
    // her starboard is her model's +Z
    const stbd = await parts.ladder.create(ctx, { parent: "hull", transform: { position: [0, 1.2, 1.8] } });
    const port = await parts.ladder.create(ctx, { parent: "hull", transform: { position: [0, 1.2, -1.8] } });
    const outboard = (id) => apply(placeIn(doc, id, "hull"), [1, 0, 0]).map((v, i) => v - inFrame(doc, id, "hull")[i]);
    expect(outboard(stbd)[2]).toBeCloseTo(1, 9);
    expect(outboard(port)[2]).toBeCloseTo(-1, 9);
  });

  it("the jib's winches put on her starboard side: the first is the starboard winch, its mirror the port one, each standing inboard of itself", async () => {
    const doc = withHull({});
    const { ctx } = fakeDrop(doc);
    const id = await parts.winches.create(ctx, { parent: "hull", transform: { position: [1.1, 1.2, 2] } });
    const [other] = children(doc, id);
    expect(doc.objects[id].traits[WINCH]).toEqual(winchTrait(1));
    expect(doc.objects[other].traits[WINCH]).toEqual(winchTrait(-1));
    expect(doc.objects[id].name).toBe("Starboard jib winch");
    near(inFrame(doc, other, "hull"), [-1.1, 1.2, 2]);
    // each one's stand spot (walk's) is inboard of it: toward her centreline, across the well
    const stand = (w) => doc.objects[w].traits["walk.stand"].at;
    expect(stand(id)[0]).toBeLessThan(0);
    expect(stand(other)[0]).toBeGreaterThan(0);
    expect(stand(id)[1]).toBeLessThan(0); // the side deck across the well, a little lower
  });

  it("the Jib piece stands at the jib's tack under the mast, its Y up the luff and its Z square to it, aft, in her centreplane", () => {
    const d = jibDrawing();
    const jib = PIECES.mast.find((p) => p.kind === "jib");
    near(jib.at.map((v, i) => v + FIT.mast.position[i]), d.tack);
    const u = [0, Math.cos(jib.rotation[0]), Math.sin(jib.rotation[0])];
    const luff = d.head.map((v, i) => v - d.tack[i]);
    const L = Math.hypot(...luff);
    near(u, luff.map((v) => v / L));
    near(d.local(d.head), [0, L, 0]);
    expect(d.local(d.clew)[2]).toBeCloseTo(4.52, 9); // LP = J, square to the luff, aft
    expect(d.local(d.clew)[0]).toBeCloseTo(0, 12);
  });

  it("the stock hull's stand for a part is where the template puts it", () => {
    const doc = withHull({});
    const at = (part) => placement(doc, { parent: "hull", transform: { position: STAND[part] } }, part).transform.position;
    near(at("wheel"), [0, STAND.wheel[1] + LIFT.wheel, STAND.wheel[2]]);
    near(at("mast"), STAND.mast);
  });

  it("dropped on something that isn't a ship, stands as the bin put it", async () => {
    const doc = emptyScene();
    doc.objects.rock = { name: "Rock", parent: null, transform: { position: [0, 0, 0], rotation: [0, 2, 0], scale: 1 } };
    const { ctx } = fakeDrop(doc);
    const id = await parts.wheel.create(ctx, { parent: "rock", transform: { position: [1, 2, 3], rotation: [0, 0.2, 0], scale: 1 } });
    expect(doc.objects[id]).toMatchObject({ parent: "rock", transform: { position: [1, 2, 3], rotation: [0, 0.2, 0], scale: 1 } });
  });
});

describe("the sloop", () => {
  it("puts her whole on the water, at the root, bow away from the viewer, everything aboard", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    // the bin faces a part's +Z toward the eye: her stern
    const id = await parts.sloop.create(ctx, { parent: null, transform: { position: [10, 0.3, -4], rotation: [0, 0.8, 0], scale: 1 }, world: { position: [10, 0.3, -4], rotation: [0, 0.8, 0], scale: 1 } });
    const hull = doc.objects[id];
    expect(hull).toMatchObject({ name: "Sloop", parent: null, transform: { position: [10, 0, -4], rotation: [0, 0.8, 0], scale: 1 } });
    expect(own(hull.traits)).toEqual({ [SHIP]: {} });
    const aboard = Object.values(doc.objects).filter((o) => o.parent === id).map((o) => o.name).sort();
    expect(aboard).toEqual(["Companionway", "Ladder", "Mainsheet", "Mast", "Port jib winch", "Wheel", "Windlass"]);
    const p = partsOf(fakeWorld(doc).scene(), id);
    for (const k of ["helm", "sail", "anchor", "mainsheet", "jib", "ladder", "hook"]) expect(p[k]).not.toBeNull();
    expect(p.winches.map((w) => doc.objects[w].traits[WINCH].side)).toEqual(["port", "starboard"]);
  });

  it("brings a Sea and the weather when the scene has no open water, and leaves open water that's there alone", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    await parts.sloop.create(ctx, { parent: null, transform: {}, world: {} });
    expect(doc.traits[WEATHER]).toMatchObject({ wind: { speed: 7, from: 45 } });
    const sea = doc.objects[doc.order[0]];
    // a 60 m box centred on her, turned with her, where its world offers no open water; 11 m
    // deep, so an anchor her crew lets go (it lies at sim.js DEPTH, 10 m) and its chain stay in it
    expect(sea.traits).toEqual({ water: { clip: [60, 11, 60] }, [SEA]: { seed: doc.traits[WEATHER].seed, scale: 1 } });
    expect(sea.traits.water.clip[1]).toBeGreaterThan(DEPTH);
    const her = doc.objects[Object.keys(doc.objects).find((id) => doc.objects[id].name === "Sloop")];
    expect(sea.transform.position).toEqual([her.transform.position[0], 0, her.transform.position[2]]);
    expect(sea.transform.rotation).toEqual([0, her.transform.rotation[1], 0]);
    // open water there already (with or without a sea, with or without weather): nothing more of either water or weather is written
    for (const weather of [null, { wind: { speed: 3, from: 200 }, seed: 5 }]) {
      const other = emptyScene();
      other.objects.w = { name: "Water", parent: null, transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: 1 }, traits: { water: {} } };
      other.order.push("w");
      if (weather) other.traits[WEATHER] = structuredClone(weather);
      const second = fakeDrop(other);
      await parts.sloop.create(second.ctx, { parent: null, transform: {}, world: {} });
      expect(Object.values(other.objects).filter((o) => o.traits?.water)).toHaveLength(1);
      expect(other.traits[WEATHER] ?? null).toEqual(weather);
    }
    // a pond (bounded water) is not open water: she brings a Sea
    const pond = emptyScene();
    pond.objects.p = { name: "Pond", parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, traits: { water: { size: [10, 1, 10] } } };
    pond.order.push("p");
    await parts.sloop.create(fakeDrop(pond).ctx, { parent: null, transform: {}, world: {} });
    expect(Object.values(pond.objects).filter((o) => o.traits?.water && !o.traits.water.size)).toHaveLength(1);
  });

  it("the Sea part: open water with a sea on it, first in the order, and the weather where there's none", async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    const id = await parts.sea.create(ctx, { parent: null, transform: {}, world: { position: [4, 9, 4], rotation: [0, 1, 0], scale: 1 } });
    expect(doc.order[0]).toBe(id);
    expect(doc.objects[id]).toMatchObject({ name: "Sea", sourceUrl: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } });
    // an ocean alone has no natural size: the Sea part writes no clip
    expect(doc.objects[id].traits).toEqual({ water: {}, [SEA]: { seed: doc.traits[WEATHER].seed, scale: 1 } });
  });

  // every kind of water a doc may have before (none, a pond only, open water with no sea, open water with a sea,
  // two open bodies, the first the keeper) by whether it has weather
  const WATERS = {
    none: {},
    "a pond only": { p: { water: { size: [10, 1, 10] } } },
    "open water, no sea": { w: { water: {} } },
    "open water with a sea": { w: { water: {}, [SEA]: { seed: 3, scale: 1 } } },
    "two open bodies, the keeper with no sea": { a: { water: {} }, b: { water: {}, [SEA]: { seed: 4, scale: 1 } } },
    "two open bodies, the keeper with a sea": { a: { water: {}, [SEA]: { seed: 4, scale: 1 } }, b: { water: {} } },
  };
  const WEATHERS = { "no weather": null, weather: { wind: { speed: 3, from: 200 }, seed: 5 } };
  const docWith = (waters, weather) => {
    const d = emptyScene();
    for (const [id, traits] of Object.entries(waters)) {
      d.objects[id] = { name: id, parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, traits: structuredClone(traits) };
      d.order.push(id);
    }
    if (weather) d.traits[WEATHER] = structuredClone(weather);
    return d;
  };
  const openOf = (d) => Object.keys(d.objects).filter((id) => d.objects[id].traits?.water && !d.objects[id].traits.water.size);

  for (const [w, waters] of Object.entries(WATERS))
    for (const [x, weather] of Object.entries(WEATHERS)) {
      const hasOpen = Object.values(waters).some((t) => t.water && !t.water.size);
      const keeper = Object.keys(waters).filter((id) => waters[id].water && !waters[id].water.size).sort()[0] ?? null;
      it(`bringSea, ${w}, ${x}: ${hasOpen ? "leaves the doc as it is" : "a Sea, and the weather where there's none"}`, () => {
        const d = docWith(waters, weather);
        const before = structuredClone(d);
        let n = 0;
        const id = parts.bringSea(d, (p) => `${p}new${++n}`, { seed: 9 });
        if (hasOpen) {
          expect(id).toBeNull();
          expect(d).toEqual(before);
        } else {
          expect(d.order[0]).toBe(id);
          expect(d.objects[id].traits).toEqual({ water: {}, [SEA]: { seed: 9, scale: 1 } });
          expect(d.traits[WEATHER]).toEqual(weather ?? { wind: { speed: 7, from: 45 }, seed: 9 });
        }
      });
      it(`the Sea part, ${w}, ${x}: never a second open body; ${keeper && waters[keeper][SEA] ? "says the water has a sea" : "a sea on the open water"}`, async () => {
        const d = docWith(waters, weather);
        const before = structuredClone(d);
        const { ctx, calls } = fakeDrop(d);
        const id = await parts.sea.create(ctx, { parent: null, transform: {}, world: { position: [4, 9, 4], rotation: [0, 1, 0], scale: 1 } });
        // as many open bodies as before, or one where there were none
        expect(openOf(d).length).toBe(Math.max(1, openOf(before).length));
        if (keeper && waters[keeper][SEA]) {
          expect(d).toEqual(before);
          expect(id).toBe(keeper);
          expect(calls.notices.map((c) => c.text)).toEqual(["This scene's water has a sea already."]);
          return;
        }
        expect(calls.notices).toEqual([]);
        const seed = d.traits[WEATHER].seed;
        expect(d.traits[WEATHER]).toEqual(weather ?? { wind: { speed: 7, from: 45 }, seed });
        expect(d.objects[id].traits[SEA]).toEqual({ seed, scale: 1 });
        if (keeper) expect(id).toBe(keeper);
        else {
          expect(d.order[0]).toBe(id);
          expect(d.objects[id]).toMatchObject({ name: "Sea", sourceUrl: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, traits: { water: {} } });
        }
        // nothing else changed
        for (const k of Object.keys(before.objects)) if (k !== id) expect(d.objects[k]).toEqual(before.objects[k]);
      });
    }

  it("dropped on something, goes on the water under where it was dropped, not attached to it", async () => {
    const doc = emptyScene();
    doc.objects.islet = { name: "Islet", parent: null, transform: { position: [100, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 } };
    const { ctx } = fakeDrop(doc);
    // the stage's at.world is where she goes: on the water under it, turned as it is
    const id = await parts.sloop.create(ctx, { parent: "islet", transform: { position: [0, 3, 10], rotation: [0, 0, 0], scale: 1 }, world: { position: [7, 3, 8], rotation: [0, 0.5, 0], scale: 1 } });
    expect(doc.objects[id].parent).toBeNull();
    near(doc.objects[id].transform.position, [7, 0, 8]);
    expect(doc.objects[id].transform.rotation[1]).toBeCloseTo(0.5, 9);
  });
});

describe("the companionway", () => {
  const sloopDoc = async () => {
    const doc = emptyScene();
    const { ctx } = fakeDrop(doc);
    const id = await parts.sloop.create(ctx, { parent: null, transform: {}, world: {} });
    const by = (name) => Object.entries(doc.objects).find(([, o]) => o.name === name);
    return { doc, id, by };
  };

  it("is at her stand for it, at the cabin's aft end on the cockpit's sole: an exit with its verb and nowhere to go, its hatch under it", async () => {
    const { doc, id, by } = await sloopDoc();
    const [cid, comp] = by("Companionway");
    const [, hatch] = by("Hatch");
    expect(comp.parent).toBe(id);
    near(comp.transform.position, STAND.companionway);
    expect(comp.tags).toEqual([TAGS.companionway]);
    // the verb, and no destination: where it leads is the scene's to say, never the bin's or the template's
    expect(comp.traits).toEqual({ "traversal.exit": { verb: "Go below" } });
    expect(hatch.parent).toBe(cid);
    expect(hatch.tags).toEqual([TAGS.hatch]);
    near(inFrame(doc, Object.keys(doc.objects).find((k) => doc.objects[k] === hatch), id), FIT.hatch.position);
    // both hers: neither is carried in play, and both are walked on (a sailing tag each)
    expect(comp.locked).toBe(false);
  });

  it("its hatch slides forward along the cabin top, square to her (its parent's −Z), by its travel at a hand's pace, shut, closing only by hand", async () => {
    const { by } = await sloopDoc();
    const slide = by("Hatch")[1].traits["joints.slide"];
    expect(slide).toEqual({ axis: [0, 0, -1], stops: { closed: 0, open: 0.55 }, speed: 0.5, at: "closed" });
    // open, its aft edge is forward of the hatchway's aft end by its travel, and the cover is still on the cabin top
    const open = FIT.hatch.position[2] - slide.stops.open;
    expect(open).toBeGreaterThan(1.3); // forward of the hatchway's aft end (1.95), uncovering 0.53 m of it
    expect(open - 0.82).toBeGreaterThan(-1.3); // the cover's forward edge still over the cabin (it starts at −1.3)
  });

  it("put from the bin on any ship: the same two pieces, the hatch snapping to the companionway's connector", async () => {
    const doc = withHull({}, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });
    const { ctx } = fakeDrop(doc);
    const id = await parts.companionway.create(ctx, { parent: "hull", transform: { position: STAND.companionway, rotation: [0, 0, 0], scale: 1 } });
    const kids = children(doc, id);
    expect(doc.objects[id].traits).toEqual({ "traversal.exit": { verb: "Go below" } });
    expect(kids.map((k) => doc.objects[k].name)).toEqual(["Hatch"]);
    const at = FIT.hatch.position.map((v, i) => v - FIT.companionway.position[i]);
    near(doc.objects[kids[0]].transform.position, at);
    // the companionway's model says where a hatch goes: there, tagged for it
    const { partGLB } = await import("./ship.js");
    const { parseGLB } = await import("./glb.js");
    const [connector] = parseGLB(partGLB("companionway").bytes).json.scenes[0].extras.connectors;
    expect(connector.tags).toEqual([TAGS.hatch]);
    near(connector.position, at);
  });
});

describe("the ship finds what's aboard her anywhere under her", () => {
  let w;
  afterEach(() => w?.done());

  it("stationsOf: a rig on a mast on the hull, a wheel on a pedestal", async () => {
    const doc = withHull({});
    const { ctx } = fakeDrop(doc);
    const mast = await parts.mast.create(ctx, { parent: "hull", transform: { position: STAND.mast } });
    doc.objects.pedestal = { name: "Pedestal", parent: "hull", transform: { position: [0, 0.7, 4] } };
    doc.order.push("pedestal");
    const wheel = await parts.wheel.create(ctx, { parent: "pedestal", transform: { position: [0, 0.2, 0] } });
    w = fakeWorld(doc);
    const sim = createSim(w.join("A"), {});
    const st = sim.stationsOf("hull");
    expect(st.sail).toBe(children(doc, mast)[0]);
    expect(st.helm).toBe(wheel);
    expect(st.anchor).toBeNull();
  });
});

