// map-schemas.js — the map node's outlet SCHEMAS + the pure lens core behind its
// two BIDIRECTIONAL marks outlets (`shapes` = lat/lng, `pixels` = container px).
// This file must stay Leaflet-free: index.jsx imports the schemas at
// registration time (the map's code + bundled Leaflet stay lazy behind load()),
// and the tests exercise the geo↔pixel op-mapping and the echo/reconcile
// machinery with injected project/unproject fns (a fake Mercator).
//
// Both outlets are views over the SAME source of truth — the map's OWN geo marks
// (config.marks; NOT the canvas items parented onto the map, which are outer-doc
// annotations — content and annotations never mix):
//
//   stroke { kind:"stroke", pts:[[lat,lng],…], color?, weight? }
//   shape  { kind:"shape",  type:"rectangle"|"ellipse"|"line"|"arrow",
//            a:[lat,lng], b:[lat,lng], head?, color?, weight? }
//
// `shapes` is the identity lens over storage. `pixels` projects every coordinate
// through the map's CURRENT view — view-dependent by design, it re-emits on
// pan/zoom — and UNPROJECTS writes back to geo, so a vision model working over a
// map screenshot can write pixel boxes that pin to the ground.
import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, arraySchema, objectSchema, enumSchema, stringSchema, numberSchema } from "./ops.js";

// ── schemas (introspectable builders — describeSchema/schemaExample render them) ──
// Strokes and shapes differ structurally; the schema layer has no union composite,
// so this is the common ENVELOPE (only `kind` required, everything else optional)
// with the union documented in the `shape` label + a two-variant example.
const point = () => arraySchema(numberSchema()); // one coordinate pair [a, b]
const markSchema = () =>
  objectSchema(
    {
      kind: enumSchema(["stroke", "shape"]),
      pts: arraySchema(point()), // stroke only: [[lat,lng]|[x,y], …]
      type: enumSchema(["rectangle", "ellipse", "line", "arrow"]), // shape only
      a: point(), // shape only: one corner / endpoint
      b: point(), // shape only: the other
      head: arraySchema(point()), // arrow only: the two wing tips
      color: stringSchema(),
      weight: numberSchema(),
    },
    ["pts", "type", "a", "b", "head", "color", "weight"]
  );

export function geoMarksSchema() {
  const s = arraySchema(markSchema());
  s.shape =
    "geo marks — ({kind:'stroke', pts:[[lat,lng]…]} | {kind:'shape', type, a:[lat,lng], b:[lat,lng], head?})[], color?/weight? on both";
  s.example = [
    { kind: "stroke", pts: [[51.505, -0.09], [51.506, -0.088]] },
    { kind: "shape", type: "rectangle", a: [51.504, -0.093], b: [51.507, -0.086] },
  ];
  return s;
}

export function pixelMarksSchema() {
  const s = arraySchema(markSchema());
  s.shape =
    "pixel marks — the SAME marks with every [lat,lng] projected to container [x,y] at the map's current view (re-emits on pan/zoom; writes unproject at the current view)";
  s.example = [
    { kind: "stroke", pts: [[120, 80], [160, 96]] },
    { kind: "shape", type: "rectangle", a: [40, 40], b: [200, 140] },
  ];
  return s;
}

// ── the pure lens core ────────────────────────────────────────────────────────

// map every coordinate pair in a mark through `f` ([a,b] → [c,d]) — geometry
// only; style fields pass through untouched. Returns a NEW mark (input unmutated).
export function mapMarkPoints(mark, f) {
  const m = { ...mark };
  if (Array.isArray(m.pts)) m.pts = m.pts.map((p) => f(p));
  if (Array.isArray(m.a)) m.a = f(m.a);
  if (Array.isArray(m.b)) m.b = f(m.b);
  if (Array.isArray(m.head)) m.head = m.head.map((p) => f(p));
  return m;
}

export const marksToPixels = (marks, project) =>
  (Array.isArray(marks) ? marks : []).map((m) => (m && typeof m === "object" ? mapMarkPoints(m, project) : m));

// only marks the map can draw (a stroke needs pts, a shape needs a+b) — an
// external writer's junk is dropped rather than crashing the layer reconcile.
export const validMark = (m) =>
  !!m && typeof m === "object" &&
  ((m.kind === "stroke" && Array.isArray(m.pts)) ||
    (m.kind === "shape" && Array.isArray(m.a) && Array.isArray(m.b)));
export const normalizeMarks = (v) => (Array.isArray(v) ? v.filter(validMark) : []);

// Rewrite a PIXEL-domain write into the equivalent GEO-domain op by unprojecting
// every coordinate at the current view. Returns the geo op, or null when the op
// can't be mapped on its own (e.g. assigning a single coordinate COMPONENT —
// half a point can't be unprojected) — the caller resyncs the writer with a
// fresh pixel snapshot instead of guessing.
const isPoint = (v) => Array.isArray(v) && typeof v[0] === "number";
export function pixelWriteToGeo(o, unproject) {
  if (o == null) return null;
  if (isSnapshot(o)) return snapshot(normalizeMarks(o.value).map((m) => mapMarkPoints(m, unproject)));
  if ("type" in o) return null; // an error op — nothing to write
  const path = o.path || [], r = o.range;
  const withValue = (fn) => (o.value == null ? o : { ...o, value: fn(o.value) }); // deletes pass through unchanged
  if (path.length === 0) {
    // the marks array itself
    if (Array.isArray(r)) return withValue((v) => [].concat(v).map((m) => mapMarkPoints(m, unproject))); // splice marks in/out
    if (typeof r === "number") return withValue((m) => mapMarkPoints(m, unproject)); // replace/delete one mark
    return null; // a string key on an array — not meaningful
  }
  if (path.length === 1) {
    // inside one mark
    if (r === "a" || r === "b") return withValue((p) => unproject(p));
    if (r === "pts" || r === "head") return withValue((pts) => pts.map((p) => unproject(p)));
    if (typeof r === "string") return o; // style (color/weight/type/kind) — view-independent
    return null;
  }
  if (path.length === 2 && (path[1] === "pts" || path[1] === "head")) {
    // point(s) within a stroke's geometry
    if (Array.isArray(r)) return withValue((v) => (isPoint(v) ? unproject(v) : v.map((p) => unproject(p))));
    return withValue((p) => unproject(p)); // numeric assign of one point
  }
  return null; // a lone coordinate component / deeper — not unprojectable alone
}

// the layer-reconcile DIFF, by element identity: the COW apply (opstreams) keeps
// untouched marks' identity, so only marks an op actually changed are redrawn.
export function reconcilePlan(prev, next) {
  const keep = new Set(next), had = new Set(prev);
  return { remove: prev.filter((m) => !keep.has(m)), add: next.filter((m) => !had.has(m)) };
}

export const sameMarks = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

// ── the two bidirectional outlets over one marks array ───────────────────────
// Pure of Leaflet: the host injects `project`/`unproject` ([lat,lng] ⇄ [x,y] at
// the CURRENT view) and an `onChange(next, prev, agent)` that reconciles its
// layers + persists. Consistency by construction: a write through EITHER outlet
// lands in `applyGeo` — the marks update once, and BOTH outlets emit.
//
// Echo: every emission forwards the WRITER's agent (the opstreams provenance
// convention — see bind()), so a writer recognises its own write coming home;
// on top of that `applyGeo` is idempotent (a value-equal write does not
// re-emit), so even an agent-less feedback loop dies after one round. The map's
// own emissions carry the `local` tag.
export function makeMarkStreams({ marks = [], project, unproject, onChange, local = "map", pixelDelay = 60 }) {
  let current = marks;
  const shapes = new Source(current, { schema: geoMarksSchema() });
  const pixels = new Source(marksToPixels(current, project), { schema: pixelMarksSchema() });

  // pan/zoom re-emission is throttled (trailing edge) — `move` fires per frame.
  // (hand-rolled to match the raw-callback style; opstreams' coalesce() merges
  // ops, but these emissions are snapshots — the last one is all that matters.)
  let timer = null, queuedAgent = null;
  const emitPixels = (agent) => pixels.push(marksToPixels(current, project), agent);
  const schedulePixels = (agent) => {
    queuedAgent = agent;
    if (pixelDelay <= 0) { const a = queuedAgent; queuedAgent = null; emitPixels(a); return; }
    if (timer) return;
    timer = setTimeout(() => { timer = null; const a = queuedAgent; queuedAgent = null; emitPixels(a); }, pixelDelay);
  };

  // the host's own changes (hand-drawn / erased / external config) flow out here
  const changed = (next, agent = local) => { current = next; shapes.push(current, agent); schedulePixels(agent); };

  // a write from EITHER outlet: apply to geo, let the host reconcile, emit both
  const applyGeo = (o, agent) => {
    let next;
    try { next = isSnapshot(o) ? normalizeMarks(o.value) : normalizeMarks(applyOp(current, o)); }
    catch { schedulePixels(local); shapes.push(current, agent); return; } // unapplicable — resync the writer
    if (sameMarks(next, current)) return; // idempotence backstop: value-equal writes must not re-emit
    const prev = current;
    current = next;
    if (onChange) onChange(next, prev, agent);
    shapes.push(current, agent);
    schedulePixels(agent);
  };
  shapes.apply = applyGeo;
  pixels.apply = (o, agent) => {
    const geo = pixelWriteToGeo(o, unproject);
    if (geo == null) { schedulePixels(local); return; } // unmappable — resync the writer with the canonical view
    applyGeo(geo, agent);
  };

  const viewChanged = () => schedulePixels(local); // projection moved: PIXELS re-emit, shapes do NOT
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return { shapes, pixels, changed, viewChanged, stop, value: () => current };
}
