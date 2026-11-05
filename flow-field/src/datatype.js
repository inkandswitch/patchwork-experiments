// The flow-field document. See README.md for the shape.
//
// The seed is a Rankine body: a source and a sink of equal strength in a
// uniform stream. The source's fluid is all swallowed by the sink, and the
// stream surface that separates it from the oncoming stream is a closed,
// streamlined body. With U = 2 m/s, the pair 8.6 m apart at x = 0.7 and
// x = 9.3 and m = 12.4 m³/s, the body runs from x ≈ 0 to x ≈ 10 m with a
// maximum half-breadth of ≈ 1.37 m: roughly a 10 m hull, bow at the origin. The body is axisymmetric about
// the x axis, so the waterplane z = 0 is a plane of symmetry ("double-body"
// flow, the usual first approximation for a hull's underwater flow).

export const RANKINE_SEED = Object.freeze({
  freestream: { speed: 2, headingDeg: 0 },
  elements: {
    bow: { kind: "source", position: [0.7, 0, 0], strength: 12.4 },
    stern: { kind: "sink", position: [9.3, 0, 0], strength: 12.4 },
  },
  domain: { min: [-6, -6, -4], max: [16, 6, 4] },
  seeds: { count: 15 },
});

const clone = (v) => JSON.parse(JSON.stringify(v));

export const FlowFieldDatatype = {
  init(doc) {
    doc.title = "Flow past a Rankine body";
    const seed = clone(RANKINE_SEED);
    doc.freestream = seed.freestream;
    doc.elements = seed.elements;
    doc.domain = seed.domain;
    doc.seeds = seed.seeds;
    // no linked body (see README "Linking a hull"); docs made before the link existed lack the key, which means the same
    doc.body = null;
  },
  getTitle(doc) {
    return doc?.title || "Flow field";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc?.title || "flow field"}`;
  },
};
