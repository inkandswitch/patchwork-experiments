// The map's two BIDI marks outlets (map-schemas.js) — the pure lens core, no
// Leaflet: project/unproject are injected (a fake Mercator, like box-transform's).
// `shapes` = the marks in lat/lng (identity over storage); `pixels` = the same
// marks through the CURRENT view (re-emits on pan/zoom, writes unproject).
import { describe, it, expect } from "vitest";
import {
  geoMarksSchema, pixelMarksSchema, mapMarkPoints, marksToPixels, pixelWriteToGeo,
  normalizeMarks, validMark, reconcilePlan, sameMarks, makeMarkStreams,
} from "./map-schemas.js";
import { describeSchema, schemaExample, splice, set, snapshot, isSnapshot } from "./ops.js";

// a Web-Mercator-flavoured fake (px-per-degree scales with zoom, y INVERTS) —
// the same shape box-transform.test.js pins, as [lat,lng] ⇄ [x,y] pair fns.
const mercator = (zoom, center = { lat: 51.5, lng: -0.09 }, size = { w: 400, h: 300 }) => {
  const scale = (256 * Math.pow(2, zoom)) / 360;
  return {
    project: ([lat, lng]) => [size.w / 2 + (lng - center.lng) * scale, size.h / 2 - (lat - center.lat) * scale],
    unproject: ([x, y]) => [center.lat - (y - size.h / 2) / scale, center.lng + (x - size.w / 2) / scale],
  };
};

const stroke = () => ({ kind: "stroke", pts: [[51.505, -0.09], [51.506, -0.088]], color: "#111", weight: 3 });
const rect = () => ({ kind: "shape", type: "rectangle", a: [51.504, -0.093], b: [51.507, -0.086] });
const arrow = () => ({ kind: "shape", type: "arrow", a: [51.5, -0.1], b: [51.51, -0.08], head: [[51.509, -0.081], [51.5095, -0.0815]] });

const nearPt = (a, b) => { expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6); };

// makeMarkStreams with synchronous pixel emission + an emission recorder per outlet
const rig = (marks, view, extra = {}) => {
  const emits = { shapes: [], pixels: [] };
  const s = makeMarkStreams({
    marks,
    project: (p) => view.now.project(p),
    unproject: (p) => view.now.unproject(p),
    pixelDelay: 0,
    local: "map:test",
    ...extra,
  });
  s.shapes.connect((op, agent) => emits.shapes.push({ op, agent }));
  s.pixels.connect((op, agent) => emits.pixels.push({ op, agent }));
  emits.shapes.length = 0; emits.pixels.length = 0; // drop the connect-time snapshots
  return { s, emits };
};

describe("schemas — introspectable envelope for the stroke|shape union", () => {
  it("validates both variants and rejects junk", () => {
    const std = geoMarksSchema()["~standard"];
    expect(std.validate([stroke(), rect(), arrow()]).issues).toBeUndefined();
    expect(std.validate("nope").issues).toBeTruthy();
    expect(std.validate([{ pts: [] }]).issues).toBeTruthy(); // no kind
    expect(std.validate([{ kind: "stroke", weight: "fat" }]).issues).toBeTruthy(); // bad field type
  });
  it("describes the shape and exemplifies BOTH variants", () => {
    for (const schema of [geoMarksSchema(), pixelMarksSchema()]) {
      const desc = describeSchema(schema);
      expect(desc).toContain("kind");
      expect(desc).toContain("[]");
      const ex = schemaExample(schema);
      expect(ex.map((m) => m.kind)).toEqual(["stroke", "shape"]);
      expect(schema["~standard"].validate(ex).issues).toBeUndefined(); // the example matches its own schema
    }
    expect(pixelMarksSchema().shape).toMatch(/pan\/zoom/); // the view-dependence is documented at the port
  });
});

describe("geo ↔ pixel round-trip identity at multiple zooms", () => {
  it("marksToPixels ∘ unproject ≈ identity (strokes, shapes, arrow heads)", () => {
    for (const zoom of [1, 5, 13]) {
      const { project, unproject } = mercator(zoom);
      const marks = [stroke(), rect(), arrow()];
      const back = marksToPixels(marksToPixels(marks, project), unproject);
      for (let i = 0; i < marks.length; i++) {
        const a = marks[i], b = back[i];
        for (const k of ["a", "b"]) if (a[k]) nearPt(b[k], a[k]);
        if (a.pts) a.pts.forEach((p, j) => nearPt(b.pts[j], p));
        if (a.head) a.head.forEach((p, j) => nearPt(b.head[j], p));
        expect(b.kind).toBe(a.kind); // style/tag fields pass through
        expect(b.color).toBe(a.color);
      }
    }
  });
  it("mapMarkPoints never mutates its input", () => {
    const m = stroke(); const before = JSON.stringify(m);
    mapMarkPoints(m, ([a, b]) => [a * 2, b * 2]);
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("pixelWriteToGeo — the write half of the pixel lens", () => {
  const { project, unproject } = mercator(13);
  it("maps a snapshot, a root splice, and a whole-mark assign", () => {
    const px = marksToPixels([rect()], project);
    const snap = pixelWriteToGeo(snapshot(px), unproject);
    expect(isSnapshot(snap)).toBe(true);
    nearPt(snap.value[0].a, rect().a);
    const spliced = pixelWriteToGeo(splice([], 0, 0, px), unproject);
    nearPt(spliced.value[0].b, rect().b);
    const assigned = pixelWriteToGeo(set([], 0, px[0]), unproject);
    nearPt(assigned.value.a, rect().a);
  });
  it("maps geometry-field writes, passes style through, and refuses lone components", () => {
    const [x, y] = project([51.51, -0.085]);
    const moveA = pixelWriteToGeo(set([0], "a", [x, y]), unproject);
    nearPt(moveA.value, [51.51, -0.085]);
    const pts = pixelWriteToGeo(set([1], "pts", [[x, y]]), unproject);
    nearPt(pts.value[0], [51.51, -0.085]);
    const ptSplice = pixelWriteToGeo(splice([1, "pts"], 2, 2, [[x, y]]), unproject);
    nearPt(ptSplice.value[0], [51.51, -0.085]);
    const style = set([0], "color", "#f0f");
    expect(pixelWriteToGeo(style, unproject)).toBe(style); // view-independent — untouched
    const del = set([], 0); // delete a mark — no value to unproject
    expect(pixelWriteToGeo(del, unproject)).toBe(del);
    expect(pixelWriteToGeo(set([0, "a"], 0, 123), unproject)).toBeNull(); // half a point
    expect(pixelWriteToGeo(set([0, "pts", 1], 0, 123), unproject)).toBeNull(); // deeper still
    expect(pixelWriteToGeo({ type: "error", error: "x" }, unproject)).toBeNull();
  });
});

describe("the bidi pair — one source of truth, both outlets emit", () => {
  it("splice-add via PIXELS appears in geo form on shapes (and pins to the ground)", () => {
    const view = { now: mercator(13) };
    const { s, emits } = rig([stroke()], view);
    const pxRect = mapMarkPoints(rect(), view.now.project);
    s.pixels.apply(splice([], 1, 1, [pxRect]), "vision-model");
    const marks = s.value();
    expect(marks.length).toBe(2);
    expect(marks[1].kind).toBe("shape");
    nearPt(marks[1].a, rect().a); // stored as GEO
    nearPt(marks[1].b, rect().b);
    expect(emits.shapes.length).toBe(1); // BOTH outlets emitted from one write
    expect(emits.pixels.length).toBe(1);
    expect(emits.shapes[0].agent).toBe("vision-model"); // provenance forwarded
    nearPt(emits.pixels[0].op.value[1].a, pxRect.a); // pixels view re-projected
  });
  it("assign-move via SHAPES updates the same mark; untouched marks keep identity", () => {
    const view = { now: mercator(13) };
    const first = stroke(), second = rect();
    const { s, emits } = rig([first, second], view);
    s.shapes.apply(set([1], "a", [51.52, -0.07]), "peer-1");
    expect(s.value()[1].a).toEqual([51.52, -0.07]);
    expect(s.value()[0]).toBe(first); // COW: identity preserved → layer reconcile redraws ONLY mark 1
    expect(emits.shapes.length).toBe(1);
    expect(emits.shapes[0].agent).toBe("peer-1");
  });
  it("onChange sees (next, prev) so the host can reconcile layers + persist", () => {
    const view = { now: mercator(13) };
    const seen = [];
    const { s } = rig([stroke()], view, { onChange: (next, prev, agent) => seen.push({ next, prev, agent }) });
    s.shapes.apply(splice([], 1, 1, [rect()]), "w");
    expect(seen.length).toBe(1);
    expect(seen[0].prev.length).toBe(1);
    expect(seen[0].next.length).toBe(2);
    expect(seen[0].agent).toBe("w");
  });
  it("a VIEW change re-emits pixels but NOT shapes (the marks didn't move)", () => {
    const view = { now: mercator(5) };
    const { s, emits } = rig([rect()], view);
    const before = s.pixels.value[0].a;
    view.now = mercator(9); // pan/zoom: the injected projection swaps
    s.viewChanged();
    expect(emits.pixels.length).toBe(1);
    expect(emits.shapes.length).toBe(0);
    const after = emits.pixels[0].op.value[0].a;
    expect(after[0]).not.toBeCloseTo(before[0], 3); // genuinely re-projected
    nearPt(s.value()[0].a, rect().a); // geo untouched
  });
  it("local changes (draw/erase) flow out through changed() with the local tag", () => {
    const view = { now: mercator(13) };
    const { s, emits } = rig([], view);
    s.changed([stroke()]);
    expect(emits.shapes.length).toBe(1);
    expect(emits.pixels.length).toBe(1);
    expect(emits.shapes[0].agent).toBe("map:test");
    expect(emits.shapes[0].op.value.length).toBe(1);
  });
});

describe("echo & resync", () => {
  it("an applied op does not boomerang: value-equal re-application is silent", () => {
    const view = { now: mercator(13) };
    const { s, emits } = rig([stroke()], view);
    s.shapes.apply(set([0], "color", "#f0f"), "peer-1");
    expect(emits.shapes.length).toBe(1);
    // the writer's bound peer naively re-applies the emitted snapshot (a feedback loop)
    s.shapes.apply(emits.shapes[0].op, "peer-1");
    s.shapes.apply(snapshot(s.value()), undefined); // even agent-less
    expect(emits.shapes.length).toBe(1); // idempotence backstop — no re-emit, loop dies
  });
  it("an unmappable pixel write changes nothing and resyncs the writer with a snapshot", () => {
    const view = { now: mercator(13) };
    const { s, emits } = rig([rect()], view);
    s.pixels.apply(set([0, "a"], 0, 123), "confused"); // half a coordinate
    expect(s.value()[0]).toEqual(rect());
    expect(emits.shapes.length).toBe(0); // marks untouched
    expect(emits.pixels.length).toBe(1); // the canonical view, so the writer reconverges
    expect(isSnapshot(emits.pixels[0].op)).toBe(true);
  });
  it("a snapshot write through shapes replaces the marks (normalised)", () => {
    const view = { now: mercator(13) };
    const { s, emits } = rig([stroke()], view);
    s.shapes.apply(snapshot([rect(), { kind: "stroke" }, "junk"]), "peer-2");
    expect(s.value()).toEqual([rect()]); // invalid marks dropped, not drawn
    expect(emits.shapes.length).toBe(1);
  });
});

describe("reconcile helpers", () => {
  it("reconcilePlan diffs by identity — COW keeps untouched marks", () => {
    const a = stroke(), b = rect(), b2 = { ...rect(), a: [51.51, -0.09] };
    const plan = reconcilePlan([a, b], [a, b2]);
    expect(plan.remove).toEqual([b]);
    expect(plan.add).toEqual([b2]);
    expect(reconcilePlan([a, b], [a, b])).toEqual({ remove: [], add: [] });
  });
  it("normalizeMarks/validMark keep only drawable marks", () => {
    expect(validMark(stroke())).toBe(true);
    expect(validMark(rect())).toBe(true);
    expect(validMark({ kind: "stroke" })).toBe(false); // no pts
    expect(validMark({ kind: "shape", a: [0, 0] })).toBe(false); // no b
    expect(normalizeMarks([stroke(), null, 7, { kind: "shape" }])).toEqual([stroke()]);
    expect(normalizeMarks("nope")).toEqual([]);
  });
  it("sameMarks is the config-echo guard (value equality, not identity)", () => {
    expect(sameMarks([stroke()], [stroke()])).toBe(true);
    expect(sameMarks([stroke()], [rect()])).toBe(false);
  });
});
