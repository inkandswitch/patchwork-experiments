// The "Ship at sea" template against a stand-in for the scene (the stage's
// drop context): what it lays out, where, and with which traits.
import { describe, it, expect } from "vitest";
import template from "./template.js";
import { FIT } from "./ship.js";
import { REACH, WAY, headTo, layOutShip, turn } from "./layout.js";

/** A template's context: just what layout.js uses, and a notify. */
function fakeScene(doc) {
  const calls = { created: [], notices: [] };
  let n = 0;
  const ctx = {
    repo: {
      async create2(d) {
        calls.created.push(d);
        return { url: `automerge:glb${calls.created.length}` };
      },
    },
    doc: () => doc,
    change: (fn) => fn(doc),
    newId: (prefix) => `${prefix}${++n}`,
    notify: (text, kind) => calls.notices.push({ text, kind }),
  };
  return { ctx, calls };
}

const emptyScene = () => ({ objects: {}, order: [], traits: {}, view: {}, dimensions: {} });

describe("the Ship at sea template", () => {
  it("writes the sea, starts the scene in play, and says how to go aboard", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    const sea = doc.traits["sailing.sea"];
    expect(sea.wind).toEqual({ speed: 7, from: 45 });
    expect(sea.scale).toBe(1);
    expect(Number.isInteger(sea.seed)).toBe(true);
    expect(doc.view.activity).toBe("play");
    expect(calls.notices.at(-1).kind).toBe("info");
    expect(calls.notices.at(-1).text).toMatch(/come aboard/);
  });

  it("files each part as a GLB doc, and every object shows one passthrough", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeScene(doc);
    await template.create(ctx);
    for (const f of calls.created) {
      expect(f["@patchwork"]).toEqual({ type: "file" });
      expect(f.mimeType).toBe("model/gltf-binary");
      expect(f.name).toMatch(/\.glb$/);
      expect(f.content).toBeInstanceOf(Uint8Array);
    }
    const objects = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(calls.created).toHaveLength(objects.length);
    const urls = new Set(calls.created.map((_, i) => `automerge:glb${i + 1}`));
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
    expect(doc.traits["sailing.sea"].seed).toBe(7);

    const byName = Object.fromEntries(Object.values(doc.objects).map((o) => [o.name, o]));
    const aboard = ["Mast", "Boom and sail", "Wheel", "Windlass", "Anchor", "Ladder"];
    for (const name of aboard) expect(byName[name].parent).toBe(hullId);
    // she's under way: the sail up and drawing, the anchor up
    expect(byName["Boom and sail"].traits).toEqual({ "sailing.sail": { raised: 1, sheet: 0.5 } });
    expect(byName.Wheel.traits).toEqual({ "sailing.helm": { angle: 0 } });
    expect(byName.Windlass.traits).toEqual({ "sailing.anchor": { down: false, rode: 0 } });
    expect(byName.Anchor.traits).toEqual({ "sailing.hook": {} });
    expect(byName.Mast.traits).toBeUndefined();
    // transforms in the hull's frame: where FIT puts them
    expect(byName.Wheel.transform.position).toEqual(FIT.wheel.position);
    expect(byName["Boom and sail"].transform.position).toEqual(FIT.rig.position);
    expect(byName.Anchor.transform.position).toEqual(FIT.anchor.position);
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

    const { position, target } = doc.view.home;
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
