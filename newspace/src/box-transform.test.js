import { describe, it, expect } from "vitest";
import { chainToLocal, chainToOuter, chainScale, ownTransform, registerTransform, bindMapInstance, onSpaceChanged, notifySpaceChanged } from "./box-transform.js";
import { localToWorld, worldToLocal, itemBox, transformKindOf } from "./model.js";

// a FRAME as a box: origin = frame top-left, own transform = rotate about its centre. This is
// the mapping the live geometry will adopt — so proving it equals localToWorld/worldToLocal
// de-risks replacing the hand-rolled frame math with the composer.
const frameBox = (f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, transform: { kind: "rotate", rotation: f.rotation || 0 } });

const near = (a, b) => expect(a).toBeCloseTo(b, 6);
const roundTrips = (chain, pt, env) => { const l = chainToLocal(chain, pt, env); const o = chainToOuter(chain, l, env); near(o.x, pt.x); near(o.y, pt.y); };

describe("first half (placement) — the container subtracts the box origin", () => {
  it("an identity box just translates by -origin; (0,0)-local is the box's top-left", () => {
    const box = { x: 100, y: 50, transform: { kind: "identity" } };
    expect(chainToLocal([box], { x: 100, y: 50 })).toEqual({ x: 0, y: 0 }); // top-left → local origin
    expect(chainToLocal([box], { x: 130, y: 70 })).toEqual({ x: 30, y: 20 });
    expect(chainToOuter([box], { x: 30, y: 20 })).toEqual({ x: 130, y: 70 });
  });
  it("a stroke is translate-only: point[0] is (0,0), the rest are local offsets — MOVING changes origin, not points", () => {
    const at = (x, y) => ({ x, y, transform: { kind: "translate" } });
    // stroke first sampled at (200,200): that outer point is local (0,0)
    expect(chainToLocal([at(200, 200)], { x: 200, y: 200 })).toEqual({ x: 0, y: 0 });
    expect(chainToLocal([at(200, 200)], { x: 210, y: 205 })).toEqual({ x: 10, y: 5 });
    // move the stroke by bumping origin → the SAME local points now land elsewhere; points untouched
    expect(chainToOuter([at(260, 260)], { x: 10, y: 5 })).toEqual({ x: 270, y: 265 });
  });
});

describe("second half (projection) — the box's own transform", () => {
  it("viewport (camera pan/zoom): outer→local is the camera inverse, round-trips", () => {
    const layer = { x: 0, y: 0, transform: { kind: "viewport" } }; // full-viewport ⇒ origin (0,0)
    const env = { camera: () => ({ x: 100, y: 50, z: 2 }) };
    expect(chainToLocal([layer], { x: 300, y: 250 }, env)).toEqual({ x: 100, y: 100 }); // (300-100)/2
    expect(chainToOuter([layer], { x: 100, y: 100 }, env)).toEqual({ x: 300, y: 250 });
    expect(chainScale([layer], env)).toBe(2);
  });
  it("rotate: a 90° frame maps a point on the top edge to the left edge (round-trips)", () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, transform: { kind: "rotate", rotation: 90 } };
    roundTrips([frame], { x: 80, y: 20 });
    const l = chainToLocal([frame], { x: 50, y: 0 }); // centre-top, rotated -90 about (50,50)
    near(l.x, 0); near(l.y, 50);
  });
});

describe("nesting = composition (this lifts the no-frame-in-frame rule)", () => {
  it("outer → frame → child frame composes; a child origin is in the PARENT's local space", () => {
    const outer = { x: 10, y: 10, transform: { kind: "identity" } };
    const child = { x: 5, y: 5, transform: { kind: "identity" } };   // origin in outer-local space
    // outer point (40,40) → outer-local (30,30) → child-local (25,25)
    expect(chainToLocal([outer, child], { x: 40, y: 40 })).toEqual({ x: 25, y: 25 });
    roundTrips([outer, child], { x: 40, y: 40 });
  });
  it("a viewport layer containing a frame: camera THEN frame origin compose + round-trip", () => {
    const env = { camera: () => ({ x: 0, y: 0, z: 2 }) };
    const layer = { x: 0, y: 0, transform: { kind: "viewport" } };
    const frame = { x: 20, y: 20, transform: { kind: "identity" } }; // origin in world (layer-local) space
    // screen (100,100) → world (50,50) → frame-local (30,30)
    expect(chainToLocal([layer, frame], { x: 100, y: 100 }, env)).toEqual({ x: 30, y: 30 });
    roundTrips([layer, frame], { x: 137, y: 91 }, env);
  });
});

describe("EQUIVALENCE with the existing frame math (the migration's safety net)", () => {
  const frames = [
    { x: 10, y: 20, w: 100, h: 80, rotation: 0 },
    { x: -5, y: 15, w: 200, h: 120, rotation: 37 },
    { x: 0, y: 0, w: 50, h: 50, rotation: 90 },
    { x: 300, y: -40, w: 64, h: 220, rotation: -18.5 },
  ];
  const pts = [[0, 0], [30, 40], [100, 80], [-10, 15], [175, 205]];
  it("chainToOuter([frameBox]) === localToWorld, and chainToLocal === worldToLocal, exactly", () => {
    for (const f of frames) for (const [lx, ly] of pts) {
      const [wx, wy] = localToWorld(f, lx, ly);
      const o = chainToOuter([frameBox(f)], { x: lx, y: ly });
      near(o.x, wx); near(o.y, wy);
      const [blx, bly] = worldToLocal(f, wx, wy);
      const l = chainToLocal([frameBox(f)], { x: wx, y: wy });
      near(l.x, blx); near(l.y, bly);
    }
  });
  it("frame-IN-frame composes (which the old localToWorld could not) and round-trips", () => {
    const outer = frameBox(frames[1]), inner = frameBox({ x: 12, y: 8, w: 40, h: 40, rotation: 22 });
    roundTrips([outer, inner], { x: 90, y: 130 });
  });
});

describe("reproject (a MAP as a box) — Leaflet lat/lng projection bound at runtime", () => {
  // a fake Leaflet: linear projection lng = x/10, lat = y/10 (and inverse)
  const fakeMap = {
    containerPointToLatLng: ([x, y]) => ({ lat: y / 10, lng: x / 10 }),
    latLngToContainerPoint: ([lat, lng]) => ({ x: lng * 10, y: lat * 10 }),
  };
  it("is identity until a live map is bound, then projects screen ↔ geo (lng,lat) and round-trips", () => {
    const box = { id: "m1", x: 0, y: 0, transform: { kind: "reproject" } };
    expect(chainToLocal([box], { x: 50, y: 30 })).toEqual({ x: 50, y: 30 }); // unbound ⇒ identity
    bindMapInstance("m1", fakeMap);
    expect(chainToLocal([box], { x: 50, y: 30 })).toEqual({ x: 5, y: 3 });   // screen → (lng 5, lat 3)
    expect(chainToOuter([box], { x: 5, y: 3 })).toEqual({ x: 50, y: 30 });   // geo → screen
    roundTrips([box], { x: 137, y: 88 });
    bindMapInstance("m1", null); // unbind ⇒ identity again (map removed)
    expect(chainToLocal([box], { x: 50, y: 30 })).toEqual({ x: 50, y: 30 });
  });
});

// a Web-Mercator-flavoured FAKE Leaflet (no Leaflet in vitest): px-per-degree scales with
// zoom, and Y INVERTS (lat decreases as container y grows) — the two things a real map does
// that a naive linear stub misses.
export const fakeMercatorMap = (zoom, center = { lat: 51.5, lng: -0.09 }, size = { w: 400, h: 300 }) => {
  const scale = (256 * Math.pow(2, zoom)) / 360; // px per degree
  return {
    latLngToContainerPoint: ([lat, lng]) => ({ x: size.w / 2 + (lng - center.lng) * scale, y: size.h / 2 - (lat - center.lat) * scale }),
    containerPointToLatLng: ([x, y]) => ({ lng: center.lng + (x - size.w / 2) / scale, lat: center.lat - (y - size.h / 2) / scale }),
  };
};

describe("reproject through a zooming fake map — world→local→world identity at multiple zooms", () => {
  it("round-trips (and honours the y-inversion) at zooms 1, 5, 13", () => {
    const box = { id: "mz", x: 40, y: 25, w: 400, h: 300, kind: "editor", editorId: "map" };
    for (const zoom of [1, 5, 13]) {
      bindMapInstance("mz", fakeMercatorMap(zoom));
      for (const pt of [{ x: 40, y: 25 }, { x: 240, y: 175 }, { x: 391.5, y: 60.25 }]) {
        const l = chainToLocal([itemBox(box)], pt);
        const o = chainToOuter([itemBox(box)], l);
        near(o.x, pt.x); near(o.y, pt.y);
      }
      // y-inversion: a point LOWER on screen has a SMALLER latitude
      const top = chainToLocal([itemBox(box)], { x: 240, y: 30 });
      const bottom = chainToLocal([itemBox(box)], { x: 240, y: 300 });
      expect(bottom.y).toBeLessThan(top.y); // y = lat
      expect(top.x).toBeCloseTo(bottom.x, 9); // x = lng, same column
    }
    bindMapInstance("mz", null);
  });
});

describe("space-change notification (map pan/zoom → re-project)", () => {
  it("notifySpaceChanged reaches subscribers with the box id; unsubscribe stops it", () => {
    const seen = [];
    const off = onSpaceChanged((id) => seen.push(id));
    notifySpaceChanged("m9");
    expect(seen).toEqual(["m9"]);
    off();
    notifySpaceChanged("m9");
    expect(seen).toEqual(["m9"]);
  });
  it("bindMapInstance itself notifies (items re-project as soon as the map mounts/unmounts)", () => {
    const seen = [];
    const off = onSpaceChanged((id) => seen.push(id));
    bindMapInstance("mNotify", fakeMercatorMap(3));
    bindMapInstance("mNotify", null);
    off();
    expect(seen).toEqual(["mNotify", "mNotify"]);
  });
});

describe("itemBox — an item IS a box with a transform (one uniform mapping, no ad-hoc inference)", () => {
  it("assigns the kind: frame→rotate, map→reproject, everything else→translate", () => {
    expect(transformKindOf({ kind: "frame" })).toBe("rotate");
    expect(transformKindOf({ kind: "editor", editorId: "map" })).toBe("reproject");
    expect(transformKindOf({ kind: "stroke" })).toBe("translate");
    expect(transformKindOf({ kind: "shape" })).toBe("translate");
    expect(transformKindOf({ kind: "editor", editorId: "minimap" })).toBe("translate");
    expect(transformKindOf(null)).toBe("identity");
  });
  it("itemBox(frame) composes exactly like localToWorld", () => {
    const f = { id: "f", kind: "frame", x: 30, y: 10, w: 80, h: 60, rotation: 25 };
    for (const [lx, ly] of [[0, 0], [40, 30], [80, 60], [-12, 15]]) {
      const [wx, wy] = localToWorld(f, lx, ly);
      const o = chainToOuter([itemBox(f)], { x: lx, y: ly });
      near(o.x, wx); near(o.y, wy);
    }
  });
});

describe("registry", () => {
  it("unknown kinds fall back to identity (never throws)", () => {
    const t = ownTransform({ transform: { kind: "does-not-exist" } });
    expect(t.toLocal({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });
  it("a runtime kind (like the map's reproject) can be registered + composed", () => {
    registerTransform("test-double", () => ({ toLocal: (p) => ({ x: p.x * 2, y: p.y * 2 }), toOuter: (p) => ({ x: p.x / 2, y: p.y / 2 }), scale: () => 2 }));
    const box = { x: 10, y: 0, transform: { kind: "test-double" } };
    expect(chainToLocal([box], { x: 20, y: 5 })).toEqual({ x: 20, y: 10 }); // (20-10)*2, (5-0)*2
    roundTrips([box], { x: 33, y: 9 });
  });
});
