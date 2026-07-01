import { getStroke } from "perfect-freehand";
import rough from "roughjs";

// A single rough.js generator. We only ever ask it for *path data* (toPaths),
// then render those as plain <path> elements inside our own SVG — so we never
// touch the DOM-mutating RoughSVG/RoughCanvas wrappers and stay declarative.
const generator = rough.generator();

// ---------------------------------------------------------------------------
// perfect-freehand
// ---------------------------------------------------------------------------

// Turn the polygon outline perfect-freehand produces into an SVG path string.
function outlineToPath(points) {
  if (!points.length) return "";
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...points[0], "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

// The perfect-freehand tuning is DERIVED from the stroke size — no separate
// knobs. The thinnest stroke has thinning off (a uniform line); fatter strokes
// respond more to pressure/speed.
export function freehandTuning(size = 5) {
  const t = Math.max(0, Math.min(1, (size - 2) / 16)); // 0 at thinnest, 1 at fattest
  return { thinning: t * 0.75, smoothing: 0.5, streamline: 0.5 };
}

// `points` is an array of [x, y, pressure]. Returns an SVG `d` string for a
// filled freehand stroke; tuning comes from `size` via freehandTuning, unless a
// brush (e.g. the highlighter) overrides `thinning` for a flat, untapered line.
export function freehandPath(points, size, opts = {}) {
  const base = freehandTuning(size);
  const thinning = opts.thinning != null ? opts.thinning : base.thinning;
  const smoothing = base.smoothing, streamline = base.streamline;
  const outline = getStroke(points, {
    size,
    thinning,
    smoothing,
    streamline,
    simulatePressure: points.every((p) => p[2] === 0.5),
  });
  return outlineToPath(outline);
}

// ---------------------------------------------------------------------------
// rough.js
// ---------------------------------------------------------------------------

function drawableFor(shape) {
  const { type, x, y, w, h, color, fill, strokeWidth, seed } = shape;
  const opts = {
    stroke: color,
    strokeWidth,
    roughness: shape.roughness ?? 1.5,
    bowing: shape.bowing ?? 0.1,
    seed,
    fill: fill && fill !== "none" ? fill : undefined,
    fillStyle: shape.fillStyle ?? "solid",
    fillWeight: Math.max(1, strokeWidth - 0.5),
    hachureGap: strokeWidth * 4,
  };
  switch (type) {
    case "rectangle": {
      const rx = Math.min(x, x + w), ry = Math.min(y, y + h), rw = Math.abs(w), rh = Math.abs(h);
      const corner = shape.corner || "squircle";
      if (corner === "square") return generator.rectangle(rx, ry, rw, rh, opts);
      const r = Math.min(rw, rh) * (corner === "squircle" ? 0.3 : 0.16);
      // curved corners want a gentler roughness (0 / ~1.07 / ~2.14 instead of
      // 0 / 1.5 / 3) — but scrappy enough to read as hand-drawn
      return generator.path(roundedRectPath(rx, ry, rw, rh, r), { ...opts, roughness: (opts.roughness || 0) / 1.4 });
    }
    case "ellipse":
      // circles show roughness much more than rectangles — top level 3 → 0.75
      return generator.ellipse(x + w / 2, y + h / 2, Math.abs(w), Math.abs(h), { ...opts, roughness: (opts.roughness || 0) / 4 });
    case "line":
      // a control point (cx,cy) bends the line into a quadratic curve
      if (shape.cx != null && shape.cy != null)
        return generator.path(`M${x} ${y} Q${shape.cx} ${shape.cy} ${x + w} ${y + h}`, opts);
      return generator.line(x, y, x + w, y + h, opts);
    case "arrow":
      return arrowDrawables(shape, opts);
    default:
      return null;
  }
}

// solid (no dash) / dashed / dotted, scaled to the stroke width
function strokeDash(style, sw) {
  if (style === "dashed") return [sw * 3.5, sw * 2.5];
  if (style === "dotted") return [Math.max(0.5, sw * 0.45), sw * 2];
  return null;
}

// a rounded rectangle with CUBIC corners — straight edges + 4 short bezier
// corners. Few segments means rough.js roughens it cleanly (like it does an
// ellipse), instead of scribbling over a many-point polyline.
function roundedRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = r * 0.5523; // circle→bezier control-point constant
  const x2 = x + w, y2 = y + h;
  return [
    `M${x + r} ${y}`,
    `L${x2 - r} ${y}`,
    `C${x2 - r + k} ${y} ${x2} ${y + r - k} ${x2} ${y + r}`,
    `L${x2} ${y2 - r}`,
    `C${x2} ${y2 - r + k} ${x2 - r + k} ${y2} ${x2 - r} ${y2}`,
    `L${x + r} ${y2}`,
    `C${x + r - k} ${y2} ${x} ${y2 - r + k} ${x} ${y2 - r}`,
    `L${x} ${y + r}`,
    `C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

// An arrow is the shaft plus an arrowhead at either / both ends (toggleable via
// shape.startArrow / shape.endArrow; end defaults on for older arrows).
function arrowHead(tip, bx, by, head, opts) {
  // bx,by = unit vector pointing from the tip back along the shaft
  const a = Math.atan2(by, bx), spread = Math.PI / 7;
  const l = [tip[0] + head * Math.cos(a - spread), tip[1] + head * Math.sin(a - spread)];
  const r = [tip[0] + head * Math.cos(a + spread), tip[1] + head * Math.sin(a + spread)];
  return [generator.line(tip[0], tip[1], l[0], l[1], opts), generator.line(tip[0], tip[1], r[0], r[1], opts)];
}
function arrowDrawables(shape, opts) {
  const { x, y, w, h } = shape;
  const ex = x + w, ey = y + h;
  const len = Math.hypot(w, h) || 1;
  const head = Math.min(22, len * 0.35);
  const curved = shape.cx != null && shape.cy != null;
  // arrowhead barbs point back along the shaft tangent at each tip (which on a
  // curve is the direction from/to the control point)
  const endBack = curved ? [shape.cx - ex, shape.cy - ey] : [-w, -h];
  const startBack = curved ? [shape.cx - x, shape.cy - y] : [w, h];
  const out = [curved ? generator.path(`M${x} ${y} Q${shape.cx} ${shape.cy} ${ex} ${ey}`, opts) : generator.line(x, y, ex, ey, opts)];
  if (shape.endArrow !== false) out.push(...arrowHead([ex, ey], endBack[0], endBack[1], head, opts));
  if (shape.startArrow === true) out.push(...arrowHead([x, y], startBack[0], startBack[1], head, opts));
  return out;
}

// Returns an array of { d, stroke, strokeWidth, fill } for a stored shape,
// ready to spread onto <path> elements. Deterministic thanks to `seed`.
export function shapePaths(shape) {
  const drawable = drawableFor(shape);
  if (!drawable) return [];
  const drawables = Array.isArray(drawable) ? drawable : [drawable];
  // rough.js toPaths() doesn't carry strokeLineDash through to SVG, so we apply
  // the dash ourselves — but ONLY to the outline (stroke === the shape's stroke
  // colour, no fill), never the hachure fill lines.
  const dash = strokeDash(shape.strokeStyle, shape.strokeWidth);
  const out = [];
  for (const d of drawables) {
    for (const info of generator.toPaths(d)) {
      const fill = info.fill || "none";
      const stroke = info.stroke === "none" ? "none" : info.stroke;
      const isOutline = fill === "none" && stroke === shape.color;
      out.push({
        d: info.d,
        stroke,
        strokeWidth: info.strokeWidth,
        fill,
        dash: isOutline && dash ? dash.join(",") : undefined,
      });
    }
  }
  return out;
}

// A stable integer seed from an item id, so a shape's roughed outline doesn't
// re-randomise every render.
export function seedFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

// A slightly-roughed, slightly-bowed rectangle outline for doc/frame borders.
// stroke is "currentColor" so CSS (the theme ink) drives the colour.
export function roughRectPath(w, h, seed) {
  const d = generator.rectangle(1.5, 1.5, Math.max(1, w - 3), Math.max(1, h - 3), {
    roughness: 0.9,
    bowing: 0.8,
    seed,
    stroke: "currentColor",
    strokeWidth: 2.4,
  });
  return generator.toPaths(d).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 2.4 }));
}

// A roughened ELLIPSE outline (for round nodes like the new-doc store).
export function roughEllipsePath(w, h, seed) {
  const d = generator.ellipse(w / 2, h / 2, Math.max(2, w - 4), Math.max(2, h - 4), {
    roughness: 0.9, bowing: 0.8, seed, stroke: "currentColor", strokeWidth: 2.4,
  });
  return generator.toPaths(d).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 2.4 }));
}

// A fat, hand-drawn arrowhead pointing +x (for a wire's direction marker). Filled
// rough triangle; translate+rotate it into place. `currentColor` drives the colour.
export function roughArrowHead(seed, size = 13) {
  const s = size;
  const shape = generator.polygon(
    [[-s * 0.55, -s * 0.7], [s * 0.85, 0], [-s * 0.55, s * 0.7]],
    { fill: "currentColor", fillStyle: "solid", fillWeight: 2, stroke: "currentColor", strokeWidth: 1.6, roughness: 1.05, seed: seed || 1 },
  );
  return generator.toPaths(shape).map((p) => ({ d: p.d, fill: p.fill || "none", strokeWidth: p.strokeWidth || 1 }));
}

// A roughened wire — a sketchy cubic between two points (S-curve through the
// horizontal midpoint), so connections share the hand-drawn register. Seed per
// wire keeps it stable across re-renders. stroke is "currentColor".
export function roughLinkPath(x1, y1, x2, y2, seed) {
  const mx = (x1 + x2) / 2;
  const d = `M${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  const shape = generator.path(d, { roughness: 1.1, bowing: 1, seed: seed || 1, stroke: "currentColor", strokeWidth: 2 });
  return generator.toPaths(shape).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 2 }));
}

// RELATIVE + MEMOISED wire path: drawn (0,0)→(dx,dy), so a wire that only PANS keeps
// the same dx/dy and hits the cache — no roughjs work per frame (the caller just
// updates a translate). Generating roughjs every frame for every wire was the cost.
const _linkCache = new Map();
export function roughLink(dx, dy, seed = 1) {
  const k = (Math.round(dx)) + "," + (Math.round(dy)) + "," + seed;
  let v = _linkCache.get(k);
  if (!v) {
    const mx = dx / 2;
    const d = `M0 0 C ${mx} 0 ${mx} ${dy} ${dx} ${dy}`;
    const shape = generator.path(d, { roughness: 1.1, bowing: 1, seed, stroke: "currentColor", strokeWidth: 2 });
    v = generator.toPaths(shape).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 2 }));
    if (_linkCache.size > 600) _linkCache.clear();
    _linkCache.set(k, v);
  }
  return v;
}
// the arrowhead only depends on its seed/size → memoise outright
const _arrowCache = new Map();
export function roughArrow(seed = 1, size = 13) {
  const k = seed + "," + size;
  let v = _arrowCache.get(k);
  if (!v) { v = roughArrowHead(seed, size); if (_arrowCache.size > 300) _arrowCache.clear(); _arrowCache.set(k, v); }
  return v;
}
// An OPEN chevron arrowhead (unfilled `>` strokes), tip at (0,0) pointing +x —
// small, hand-drawn, memoised. Place at a point and rotate to the curve tangent.
const _chevCache = new Map();
export function roughChevron(seed = 1, size = 8) {
  const k = seed + "," + size;
  let v = _chevCache.get(k);
  if (!v) {
    const s = size;
    const shape = generator.path(`M${-s} ${-s * 0.75} L0 0 L${-s} ${s * 0.75}`, { roughness: 1, seed, stroke: "currentColor", strokeWidth: 2 });
    v = generator.toPaths(shape).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 2 }));
    if (_chevCache.size > 300) _chevCache.clear();
    _chevCache.set(k, v);
  }
  return v;
}

// Axis-aligned bounds for a shape (handles negative w/h).
export function shapeBounds(s) {
  return {
    x: Math.min(s.x, s.x + s.w),
    y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w),
    h: Math.abs(s.h),
  };
}

// Axis-aligned bounds for a freehand stroke.
// A stroke is a translate-only box: origin (s.x, s.y) + LOCAL points. world = origin + point.
// Old strokes have no origin (points already absolute) ⇒ ox/oy default 0 ⇒ identical result.
export function strokeBounds(s) {
  const ox = s.x || 0, oy = s.y || 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of s.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = s.size / 2;
  return { x: ox + minX - pad, y: oy + minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

// world points of a stroke (origin + each local point), keeping pressure. The rest of the
// system (rendering, eraser, resize) works in world coords via this.
export function strokeWorldPoints(s) {
  const ox = s.x || 0, oy = s.y || 0;
  return (s.points || []).map((p) => [ox + p[0], oy + p[1], p[2]]);
}

// Cheap distance-to-segment, used for eraser hit-testing of strokes/lines.
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
