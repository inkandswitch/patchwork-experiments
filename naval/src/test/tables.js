// A fake chartroom:source table with known answers: the hydrostatic-table v1
// of a rectangular box, written from its closed forms (never integrated), so
// a test can tell a figure the table gave from one the mesh gave.

/**
 * The upright table of a box: x in [x0, x0 + L], y in [−B/2, B/2], z from
 * zKeel up to zKeel + D, in the table's own frame. Rows at heel 0 (and any
 * other `heels`, which repeat the upright volumes and state no waterplane:
 * only the upright row is read by the tests that use them) at trim 0.
 * @param {{ L: number, B: number, D: number, x0?: number, zKeel?: number, offsets?: number[],
 *           reference?: number|null, heels?: number[],
 *           waterplane?: "full"|"omitted"|"null"|"no-centroid"|"no-yy"|"no-xx", wetted?: boolean, lcfShift?: number }} o
 *   offsets: plane offsets h (default: 9 from the keel to the deck); reference: the reference waterplane's h, or null for none;
 *   lcfShift: moves the waterplane centroid forward of the box's middle (a fake: so LCF is told from LCB)
 */
export function boxTable({ L, B, D, x0 = 0, zKeel = 0, offsets, reference = null, heels = [0], waterplane = "full", wetted = false, lcfShift = 0 }) {
  // the reference waterplane is an exact sample, as camber's exporter writes it
  const hs = [...new Set([...(offsets ?? Array.from({ length: 9 }, (_, i) => zKeel + (D * i) / 8)), ...(reference != null ? [reference] : [])])].sort((a, b) => a - b);
  const sample = (h, heelDeg) => {
    const T = Math.min(Math.max(h - zKeel, 0), D);
    const V = L * B * T;
    const s = { waterplaneOffsetM: h, volumeM3: V, buoyancyCenterM: V > 0 ? [x0 + L / 2, 0, zKeel + T / 2] : null };
    const afloat = T > 0 && T < D;
    if (waterplane === "null") s.waterplane = null;
    else if (waterplane !== "omitted" && afloat && heelDeg === 0) {
      const moments = { xx: (B * L ** 3) / 12, yy: (L * B ** 3) / 12, xy: 0 };
      if (waterplane === "no-yy") delete moments.yy;
      if (waterplane === "no-xx") delete moments.xx;
      s.waterplane = { areaM2: L * B, ...(waterplane === "no-centroid" ? {} : { centroidM: [x0 + L / 2 + lcfShift, 0, h] }), secondMomentsM4: moments };
    }
    if (wetted) s.wettedAreaM2 = 2 * (L + B) * T + (T > 0 ? L * B : 0);
    return s;
  };
  return {
    format: "hydrostatic-table",
    version: 1,
    name: "Fake box",
    frame: { axes: "x-forward-y-port-z-up", originDescription: "A fake provider's own origin", knReferenceM: [0, 0, zKeel] },
    body: { description: `Closed box ${L} × ${B} × ${D} m`, buoyancyEnvelope: "closed-watertight" },
    table: { interpolation: "linear", rows: [...heels].sort((a, b) => a - b).map((heelDeg) => ({ heelDeg, trimDeg: 0, samples: hs.map((h) => sample(h, heelDeg)) })) },
    ...(reference != null ? { referenceState: { heelDeg: 0, trimDeg: 0, waterplaneOffsetM: reference } } : {}),
    source: { tool: "Fake" },
  };
}
