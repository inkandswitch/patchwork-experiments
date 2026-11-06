// The sloop's parts as GLB bytes: that they parse, and that each sits in the
// ship's body frame the way DESIGN.md says (bow −Z, starboard +X, waterline
// y = 0) with its origin where it pivots.
import { describe, it, expect } from "vitest";
import { parseGLB } from "./glb.js";
import { FIT, HULL, KINDS, deckAt, halfBreadthAt, partGLB, partMeshes, sheerAt } from "./ship.js";
import { SLOOP } from "./hull-model.js";

/** The union of a GLB's POSITION accessors' min/max (glTF requires them). */
function glbBounds(bytes) {
  const { json, bin } = parseGLB(bytes);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k]);
        max[k] = Math.max(max[k], a.max[k]);
      }
    }
  }
  return { json, bin, min, max };
}

const parts = Object.fromEntries(KINDS.map((k) => [k, partGLB(k)]));

describe("every part is a GLB", () => {
  it.each(KINDS)("%s parses, with normals and a material on every primitive, and buffers that fit", (kind) => {
    const { bytes, name, triangles } = parts[kind];
    const { json, bin } = parseGLB(bytes);
    expect(json.asset.version).toBe("2.0");
    expect(json.asset.extras.units).toBe("m");
    expect(json.meshes[0].name).toBe(name);
    expect(triangles).toBeGreaterThan(0);
    for (const p of json.meshes.flatMap((m) => m.primitives)) {
      expect(p.attributes.NORMAL).toBeTypeOf("number");
      expect(p.material).toBeTypeOf("number");
    }
    for (const v of json.bufferViews) expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(bin.byteLength);
  });

  it("the hint's bounds are the GLB's", () => {
    for (const kind of KINDS) {
      const b = glbBounds(parts[kind].bytes);
      for (let k = 0; k < 3; k++) {
        expect(parts[kind].bounds.min[k]).toBeCloseTo(b.min[k], 4);
        expect(parts[kind].bounds.max[k]).toBeCloseTo(b.max[k], 4);
      }
    }
  });

  it("keeps the triangle counts modest", () => {
    expect(parts.hull.triangles).toBeGreaterThan(4000);
    expect(parts.hull.triangles).toBeLessThan(12000);
    const total = KINDS.reduce((n, k) => n + parts[k].triangles, 0);
    expect(total).toBeLessThan(25000);
  });

  it("draws the same bytes every time (every peer gets the same ship)", () => {
    expect(partGLB("hull").bytes).toEqual(parts.hull.bytes);
    expect(partGLB("islet").bytes).toEqual(parts.islet.bytes);
  });

  it("throws on a part there isn't", () => {
    expect(() => partMeshes("bowsprit")).toThrow(/no part/);
  });
});

describe("the hull, in the body frame", () => {
  const b = glbBounds(parts.hull.bytes);

  it("is about 12 m long with the bow toward −Z, and about 3.8 m in the beam, symmetric", () => {
    expect(b.max[2] - b.min[2]).toBeGreaterThan(11.8);
    expect(b.max[2] - b.min[2]).toBeLessThan(12.5);
    expect(b.min[2]).toBeLessThan(HULL.bow + 0.01); // the bow fittings stand past the stem
    expect(b.max[2]).toBeCloseTo(HULL.stern, 2); // the transom
    expect(b.max[0] - b.min[0]).toBeCloseTo(3.8, 1);
    expect(b.max[0]).toBeCloseTo(-b.min[0], 3);
  });

  it("draws 1.9 m, its keel's bulb at the bottom", () => {
    expect(b.min[1]).toBeCloseTo(-1.9, 1);
  });

  it("says its principal dimensions in its extras, since its box also holds what stands on deck", () => {
    expect(b.json.scenes[0].extras.ship).toEqual({ length: 12, beam: 3.8, draft: 1.9, freeboard: 1.2 });
    expect(b.max[1]).toBeGreaterThan(1.5);
  });

  it("has its deck at the freeboard, the sheer rising to the bow", () => {
    expect(deckAt(1.5, 3)).toBeCloseTo(1.2, 1);
    expect(sheerAt(0)).toBeCloseTo(1.2, 1);
    expect(sheerAt(HULL.bow)).toBeGreaterThan(sheerAt(0) + 0.3);
    // crowned: higher on the centreline than at the edge
    expect(deckAt(0, 0)).toBeGreaterThan(deckAt(halfBreadthAt(0), 0));
    // fine forward, broad aft, a transom at the stern
    expect(halfBreadthAt(-5)).toBeLessThan(halfBreadthAt(0) / 1.5);
    expect(halfBreadthAt(HULL.stern)).toBeGreaterThan(1.3);
  });

  it("shades smoothly outward: the topsides' normals face out, the deck's up", () => {
    const meshes = partMeshes("hull");
    const prims = meshes[0].primitives;
    // a vertex on the starboard topsides amidships, and one on the deck
    let side = null;
    let deck = null;
    for (const p of prims) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const [x, y, z] = [p.positions[i], p.positions[i + 1], p.positions[i + 2]];
        const n = [p.normals[i], p.normals[i + 1], p.normals[i + 2]];
        if (!side && x > 1.7 && Math.abs(y - 0.6) < 0.15 && Math.abs(z) < 1) side = n;
        if (!deck && Math.abs(x) < 0.3 && Math.abs(z + 3) < 0.4 && Math.abs(y - deckAt(x, z)) < 0.01) deck = n;
      }
    }
    expect(side[0]).toBeGreaterThan(0.8);
    expect(deck[1]).toBeGreaterThan(0.9);
  });
});

describe("the parts, with their origins where they pivot", () => {
  const bounds = (kind) => glbBounds(parts[kind].bytes);

  it("the mast stands about 14 m from its step on the deck, with spreaders", () => {
    const m = bounds("mast");
    expect(m.max[1]).toBeCloseTo(14, 0);
    expect(m.min[1]).toBeGreaterThan(-0.2); // rigging runs down to the chainplates, a little below the step
    expect(FIT.mast.position[1]).toBeCloseTo(deckAt(0, FIT.mast.position[2]), 5);
  });

  it("the boom and sail pivot at the gooseneck: the boom runs aft along +Z, the head near the masthead", () => {
    const r = bounds("rig");
    expect(r.min[2]).toBeGreaterThan(-0.15);
    expect(r.max[2]).toBeGreaterThan(4.5);
    expect(FIT.rig.position[1] + r.max[1]).toBeGreaterThan(FIT.mast.position[1] + 13);
    expect(FIT.rig.position[1] + r.max[1]).toBeLessThan(FIT.mast.position[1] + 14);
    const { json } = parseGLB(parts.rig.bytes);
    const sail = json.scenes[0].extras.sail;
    expect(sail.main + sail.jib).toBeGreaterThan(50);
    // the plan the physics flies: the sloop's tuned sail, at its tack when the rig stands at its fitting
    expect(sail.plan).toMatchObject({ luff: SLOOP.sail.luff, foot: SLOOP.sail.foot, area: SLOOP.sail.area });
    sail.plan.tack.forEach((v, i) => expect(v + FIT.rig.position[i]).toBeCloseTo(SLOOP.sail.tack[i], 6));
  });

  it("the wheel is about a metre across, turning about its axle (Z) at its origin", () => {
    const w = bounds("wheel");
    expect(w.max[0] - w.min[0]).toBeGreaterThan(0.9);
    expect(w.max[0] - w.min[0]).toBeLessThan(1.4);
    expect(w.max[2] - w.min[2]).toBeLessThan(0.25);
    for (let k = 0; k < 2; k++) expect(w.max[k] + w.min[k]).toBeCloseTo(0, 2);
  });

  it("the windlass stands on the foredeck from its base", () => {
    const c = bounds("windlass");
    expect(c.min[1]).toBeCloseTo(0, 3);
    expect(FIT.windlass.position[2]).toBeLessThan(-3.5);
  });

  it("the ladder hooks over the starboard gunwale and reaches into the water", () => {
    const l = bounds("ladder");
    const [x, y] = FIT.ladder.position;
    expect(x).toBeCloseTo(halfBreadthAt(FIT.ladder.position[2]), 5);
    expect(y + l.min[1]).toBeLessThan(-0.5);
    expect(l.max[0]).toBeGreaterThan(0.1); // out over the side
  });

  it("the anchor hangs from its ring at the bow", () => {
    const a = bounds("anchor");
    expect(a.max[1]).toBeLessThan(0.05);
    expect(a.min[1]).toBeLessThan(-0.9);
    expect(FIT.anchor.position[2]).toBeLessThan(HULL.bow);
  });

  it("buoys float at sea level, the islet stands in it", () => {
    for (const kind of ["redBuoy", "greenBuoy", "islet"]) {
      const b = bounds(kind);
      expect(b.min[1]).toBeLessThan(0);
      expect(b.max[1]).toBeGreaterThan(1);
    }
  });
});
