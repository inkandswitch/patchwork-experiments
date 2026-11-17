// The "Ship at sea" template against a stand-in for the scene (the stage's
// drop context): what it lays out, where, and with which traits.
import { describe, it, expect } from "vitest";
import template from "./template.js";
import { FIT, partMeshes } from "./ship.js";
import { BUOY_REACH, CLIP_MARGIN, ISLET_REACH, REACH, WAY, headTo, layOutShip, seaClip, turn } from "./layout.js";
import { DEPTH } from "./sim.js";
import { RODE } from "./traits.js";
import { SLOOP } from "./hull-model.js";
import { emptyScene, fakeDrop } from "./test/fakes.js";

const fakeScene = (doc, o) => fakeDrop(doc, o);
/** The islet's mesh as it is drawn (every primitive: the rock and the lighthouse). */
const ISLET_MESH = partMeshes("islet").flatMap((m) => m.primitives);

/** An object's own traits but walk's (crew.test.js pins those). */
const own = (traits) => {
  const out = Object.fromEntries(Object.entries(traits ?? {}).filter(([k]) => !k.startsWith("walk.")));
  return Object.keys(out).length ? out : undefined;
};

describe("the islet's reach is the mesh's", () => {
  it("ISLET_REACH (24 m × 1.3, 31.2) is at least the farthest vertex of the drawn islet from its middle", () => {
    expect(ISLET_REACH).toBeCloseTo(31.2, 9);
    let far = 0;
    for (const p of ISLET_MESH) for (let i = 0; i < p.positions.length; i += 3) far = Math.max(far, Math.hypot(p.positions[i], p.positions[i + 2]));
    // the rock reaches some 27.8 m at its base (y −4), well past "some 25 m across"
    expect(far).toBeGreaterThan(27);
    expect(ISLET_REACH).toBeGreaterThanOrEqual(far);
  });
});


describe("the Ship at sea template", () => {
  it("writes the weather and a Sea (open water with a sea on it, first in the order, one seed for both), starts the scene in play, and says how to go aboard", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    const weather = doc.traits["sailing.weather"];
    expect(weather.wind).toEqual({ speed: 7, from: 45 });
    expect(Number.isInteger(weather.seed)).toBe(true);
    expect(doc.traits["sailing.sea"]).toBeUndefined();
    const first = doc.objects[doc.order[0]];
    // the Sea keeps the box its layout covers, centred on it, where its world offers no open water (seaClip)
    const want = seaClip({ yaw: headTo(45) });
    expect(first).toMatchObject({ name: "Sea", parent: null, sourceUrl: null, providerId: null, transform: { position: want.position, rotation: [0, headTo(45), 0], scale: 1 } });
    expect(first.traits).toEqual({ water: { clip: want.clip }, "sailing.sea": { seed: weather.seed, scale: 1 } });
    expect(Object.values(doc.objects).filter((o) => o.traits?.water)).toHaveLength(1);
    // people start in Look off her quarter (no body named: a click comes aboard), and nothing else of the old view
    expect(Object.keys(doc.view.start)).toEqual(["home"]);
    expect("activity" in doc.view || "home" in doc.view).toBe(false);
    expect(calls.notices.at(-1).kind).toBe("info");
    expect(calls.notices.at(-1).text).toMatch(/come aboard/);
  });

  it("files each kind of part as one GLB doc of the scene's, and every object shows one as a file object", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    for (const f of calls.created) {
      expect(f["@patchwork"]).toEqual({ type: "file" });
      expect(f.mimeType).toBe("model/gltf-binary");
      expect(f.name).toMatch(/\.glb$/);
      expect(f.content).toBeInstanceOf(Uint8Array);
    }
    // one per kind, under its versioned key
    expect(Object.keys(doc.assets).sort()).toEqual(
      ["anchor", "companionway", "greenBuoy", "hatch", "hull", "islet", "jib", "ladder", "mainsheet", "mast", "redBuoy", "rig", "wheel", "winch", "windlass"].map((k) => `sailing/${k}@${{ hull: 5, rig: 4, mast: 3, jib: 2, winch: 2, windlass: 2, mainsheet: 2, wheel: 2, anchor: 2, islet: 2 }[k] ?? 1}`),
    );
    expect(calls.created).toHaveLength(15);
    // every object but the Sea (its shape is its trait's data: no source) and her spawn point (walk's: a place, no model)
    const objects = Object.values(doc.objects).filter((o) => o.kind !== "group" && !o.traits?.water && !o.traits?.["walk.spawn"]);
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    for (const o of objects) {
      expect(urls.has(o.sourceUrl)).toBe(true);
      expect(o.providerId).toBe("file-glb");
      expect(o.renderUrl).toBeNull();
      expect(o.hint.bounds.min).toHaveLength(3);
    }
    expect(doc.order).toHaveLength(Object.keys(doc.objects).length);
  });

  it("lays out the hull as a ship, with its parts attached under it in its frame", async () => {
    const doc = emptyScene();
    const { ctx } = fakeScene(doc);
    const hullId = await layOutShip(ctx, { seed: 7 });
    const hull = doc.objects[hullId];
    expect(hull.name).toBe("Sloop");
    // no spec (read from its box), only the way she has on
    expect(Object.keys(hull.traits["sailing.ship"])).toEqual(["motion"]);
    expect(hull.parent).toBeNull();
    expect(doc.traits["sailing.weather"].seed).toBe(7);
    expect(Object.values(doc.objects).find((o) => o.name === "Sea").traits["sailing.sea"].seed).toBe(7);

    const ids = Object.fromEntries(Object.entries(doc.objects).map(([id, o]) => [o.name, id]));
    const byName = Object.fromEntries(Object.values(doc.objects).map((o) => [o.name, o]));
    expect(Object.keys(byName.Sea.traits.water)).toEqual(["clip"]);
    const aboard = ["Mast", "Boom and sail", "Wheel", "Windlass", "Anchor", "Ladder", "Mainsheet"];
    for (const name of ["Mast", "Wheel", "Windlass", "Ladder", "Mainsheet"]) expect(byName[name].parent).toBe(hullId);
    // the sail goes where the mast goes, the anchor where the windlass does
    expect(byName["Boom and sail"].parent).toBe(ids.Mast);
    expect(byName.Anchor.parent).toBe(ids.Windlass);
    // she's under way: the sail up and drawing, the anchor up
    expect(own(byName["Boom and sail"].traits)).toEqual({ "sailing.sail": { raised: 1, sheet: 0.5 } });
    expect(own(byName.Wheel.traits)).toEqual({ "sailing.helm": { angle: 0 } });
    expect(own(byName.Windlass.traits)).toEqual({ "sailing.anchor": { down: false, rode: 0 } });
    expect(own(byName.Anchor.traits)).toEqual({ "sailing.hook": {} });
    expect(own(byName.Mast.traits)).toBeUndefined();
    // transforms in the frame each hangs in, adding up to where FIT puts them on the hull
    const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    near(byName.Wheel.transform.position, FIT.wheel.position);
    near(byName.Mast.transform.position, FIT.mast.position);
    near(byName["Boom and sail"].transform.position.map((v, i) => v + byName.Mast.transform.position[i]), FIT.rig.position);
    near(byName.Anchor.transform.position.map((v, i) => v + byName.Windlass.transform.position[i]), FIT.anchor.position);
    near(byName.Ladder.transform.position, FIT.ladder.position);
    for (const name of aboard) expect(byName[name].transform.rotation).toEqual([0, 0, 0]);
    // every station is a separate, movable object
    for (const name of aboard) expect(byName[name].locked).toBe(false);
  });

  it("sails across the wind with way on, the landmarks upwind, and a home view off her stern quarter", async () => {
    const doc = emptyScene();
    const { ctx } = fakeScene(doc);
    const hullId = await layOutShip(ctx, { wind: { speed: 5, from: 90 } });
    const yaw = doc.objects[hullId].transform.rotation[1];
    expect(yaw).toBeCloseTo(headTo(90) + REACH);
    // the wind (from the east, +X) comes over her starboard bow, nearly abeam
    const bow = turn([0, 0, -1], yaw);
    const windward = [1, 0, 0];
    expect(bow[0] * windward[0] + bow[2] * windward[2]).toBeCloseTo(Math.cos(REACH));
    expect(turn([1, 0, 0], yaw)[0]).toBeGreaterThan(0.9); // starboard faces the wind
    // moving the way she points
    const v = doc.objects[hullId].traits["sailing.ship"].motion.velocity;
    expect(v[0] / WAY).toBeCloseTo(bow[0]);
    expect(v[2] / WAY).toBeCloseTo(bow[2]);

    const group = Object.entries(doc.objects).find(([, o]) => o.kind === "group");
    expect(group[1].name).toBe("Landmarks");
    const marks = Object.values(doc.objects).filter((o) => o.group === group[0]);
    expect(marks.map((o) => o.name).sort()).toEqual(["Green buoy", "Islet", "Red buoy"]);
    for (const m of marks) {
      expect(m.locked).toBe(true);
      expect(m.parent).toBeNull();
      // upwind, where she can reach them
      const p = m.transform.position;
      expect(p[0] * windward[0] + p[2] * windward[2]).toBeGreaterThan(30);
    }

    const { position, target } = doc.view.start.home;
    const d = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
    expect(d).toBeGreaterThan(17);
    expect(d).toBeLessThan(23);
    // astern of her (against the bow) and to starboard (+X in the body: turn([1,0,0]))
    const stbd = turn([1, 0, 0], yaw);
    expect(position[0] * bow[0] + position[2] * bow[2]).toBeLessThan(-5);
    expect(position[0] * stbd[0] + position[2] * stbd[2]).toBeGreaterThan(5);
    expect(position[1]).toBeGreaterThan(2);
  });

  it("writes plain data the doc can hold", async () => {
    const doc = emptyScene();
    const { ctx } = fakeScene(doc);
    await template.create(ctx);
    const { objects, traits, view } = doc;
    expect(structuredClone({ objects, traits, view })).toEqual({ objects, traits, view });
    expect(JSON.parse(JSON.stringify({ objects, traits, view }))).toEqual({ objects, traits, view });
  });
});

describe("the Ship at anchor template", () => {
  it("lies head to wind off the islet, still, her sail down and her anchor down, in a moderate breeze", async () => {
    const { atAnchor } = await import("./template.js");
    const { ANCHORAGE_AIR } = await import("./layout.js");
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await atAnchor.create(ctx);
    expect(doc.traits["sailing.weather"].wind).toEqual({ speed: ANCHORAGE_AIR.speed, from: ANCHORAGE_AIR.from });
    expect(ANCHORAGE_AIR.speed).toBeGreaterThanOrEqual(6); // enough to get her out of irons and away
    expect(ANCHORAGE_AIR.speed).toBeLessThanOrEqual(7);
    expect(doc.view.start.home).toBeTruthy();
    const by = (name) => Object.values(doc.objects).find((o) => o.name === name);
    const hull = by("Sloop");
    expect(hull.traits["sailing.ship"]).toEqual({}); // no way on
    expect(hull.transform.rotation[1]).toBeCloseTo(headTo(ANCHORAGE_AIR.from)); // head to wind
    expect(by("Boom and sail").traits["sailing.sail"]).toEqual({ raised: 0, sheet: 0.5 });
    expect(by("Windlass").traits["sailing.anchor"]).toEqual({ down: true, rode: 25 });
    // the islet lies upwind, its middle some 80 m off (its shore about 50)
    const islet = by("Islet").transform.position;
    const ahead = [-Math.sin(hull.transform.rotation[1]), -Math.cos(hull.transform.rotation[1])];
    const along = islet[0] * ahead[0] + islet[2] * ahead[1];
    expect(along).toBeGreaterThan(70);
    expect(Math.hypot(islet[0], islet[2])).toBeLessThan(90);
    expect(calls.notices.at(-1).text).toMatch(/at anchor/);
  });
});

describe("the templates' clips (W26 extended): every template doc's Sea keeps a box covering her swing circle or her start, and every landmark, with the margin to spare", () => {
  const WINDS = [{ speed: 7, from: 45 }, { speed: 5, from: 0 }, { speed: 6, from: 137 }, { speed: 4, from: 250 }];
  for (const anchored of [false, true])
    for (const wind of WINDS)
      it(`${anchored ? "at anchor" : "under way"}, the wind from ${wind.from}°`, async () => {
        const doc = emptyScene();
        await layOutShip(fakeScene(doc).ctx, { wind, seed: 3, anchored });
        const seas = Object.values(doc.objects).filter((o) => o.traits?.water);
        expect(seas).toHaveLength(1);
        const sea = seas[0];
        const [w, depth, l] = sea.traits.water.clip;
        // under way too: her crew may let the anchor go, and it lies at DEPTH (10 m) with her chain above it
        expect(depth).toBe(11);
        expect(depth).toBeGreaterThan(DEPTH);
        expect(depth).toBeGreaterThan(SLOOP.draft);
        // a point in the Sea's own frame (its yaw undone, the long way)
        const yaw = sea.transform.rotation[1];
        const local = (p) => {
          const dx = p[0] - sea.transform.position[0], dz = p[2] - sea.transform.position[2];
          return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
        };
        // every circle that must be covered, worked out from the doc's own objects
        const by = (name) => Object.values(doc.objects).find((o) => o.name === name);
        const hull = by("Sloop");
        const h = hull.transform.rotation[1];
        const circles = anchored
          ? [{ at: [hull.transform.position[0] - Math.sin(h) * (SLOOP.length / 2), 0, hull.transform.position[2] - Math.cos(h) * (SLOOP.length / 2)], r: Math.sqrt(RODE ** 2 - DEPTH ** 2) + SLOOP.length }]
          : [{ at: hull.transform.position, r: SLOOP.length }];
        for (const [name, r] of [["Red buoy", BUOY_REACH], ["Green buoy", BUOY_REACH], ["Islet", ISLET_REACH]]) circles.push({ at: by(name).transform.position, r });
        expect(circles).toHaveLength(4);
        for (const c of circles) {
          const [x, z] = local(c.at);
          expect(Math.abs(x) + c.r + CLIP_MARGIN).toBeLessThanOrEqual(w / 2 + 1e-6);
          expect(Math.abs(z) + c.r + CLIP_MARGIN).toBeLessThanOrEqual(l / 2 + 1e-6);
        }
        // the islet as drawn: every vertex of its mesh (at its object's place, turn and
        // scale), not the constant, is inside the box with the margin to spare
        const islet = by("Islet");
        const [ix, iz] = local(islet.transform.position);
        const ir = islet.transform.rotation[1], is = islet.transform.scale ?? 1;
        let worst = Infinity;
        for (const p of ISLET_MESH)
          for (let i = 0; i < p.positions.length; i += 3) {
            const mx = p.positions[i] * is, mz = p.positions[i + 2] * is;
            // the mesh's offset in the world, then in the Sea's frame (both turns about +Y)
            const wx = mx * Math.cos(ir) + mz * Math.sin(ir), wz = -mx * Math.sin(ir) + mz * Math.cos(ir);
            const lx = ix + wx * Math.cos(yaw) - wz * Math.sin(yaw), lz = iz + wx * Math.sin(yaw) + wz * Math.cos(yaw);
            worst = Math.min(worst, w / 2 - Math.abs(lx), l / 2 - Math.abs(lz));
          }
        expect(worst).toBeGreaterThanOrEqual(CLIP_MARGIN - 1e-6);
        // and no bigger than that: some circle touches each side
        for (const [k, half] of [[0, w / 2], [1, l / 2]]) {
          const lo = Math.min(...circles.map((c) => local(c.at)[k] - c.r - CLIP_MARGIN));
          const hi = Math.max(...circles.map((c) => local(c.at)[k] + c.r + CLIP_MARGIN));
          expect(lo).toBeCloseTo(-half, 4);
          expect(hi).toBeCloseTo(half, 4);
        }
      });
});
