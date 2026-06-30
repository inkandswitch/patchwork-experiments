// The PEN — the core freehand brush, now a first-class `use(canvas)` brush pulled out of
// the host. It is ALSO the host's built-in fallback for any passive STROKE brush (one with
// a `stroke` config but no `use`/`behavior`): the marker/crayon/highlighter all draw through
// these handlers, reading their look from the resolved params for the ACTIVE brush.
//
//   down  → start a points buffer at the pointer (with pressure) + PREVIEW a stroke
//   move  → append a pressure point + re-preview
//   up    → COMMIT the stroke to the layout (if it has length)
//
// Everything it needs is on the per-phase `ctx`: `p` (world point), `pressure`, `state`
// (gesture-scoped scratch), `param(key)` (resolved brush param), `preview(draft|null)`,
// `commit(item)`. So the pen carries no canvas knowledge — it's the reference brush.
import { paramsSchema } from "./ops.js";

// build the live stroke shape from the accumulated points + the active brush's params.
// optional fields (opacity/blend/thinning) are omitted when the brush doesn't set them,
// so a plain pen stroke stays minimal (matches the pre-refactor commit exactly).
function strokeShape(ctx, points) {
  const s = { kind: "stroke", points, color: ctx.param("color"), size: ctx.param("size") };
  const opacity = ctx.param("opacity"); if (opacity != null) s.opacity = opacity;
  const blend = ctx.param("blend"); if (blend) s.blend = blend;
  const thinning = ctx.param("thinning"); if (thinning != null) s.thinning = thinning;
  return s;
}

export const PenBrush = {
  id: "pen",
  name: "Pen",
  icon: "Pencil",
  // the pen's params, declared as a real schema (validation + the panel UI in one).
  schema: paramsSchema([
    { key: "color", label: "Colour", type: "color" },
    { key: "size", label: "Size", type: "size", default: 4 },
    { key: "thinning", label: "Pressure", type: "slider", min: -1, max: 1, step: 0.05, default: 0.5 },
  ]),
  stroke: { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 },
  use() {
    return {
      down(ctx) {
        ctx.state.pts = [[ctx.p.x, ctx.p.y, ctx.pressure]];
        ctx.preview(strokeShape(ctx, ctx.state.pts));
      },
      move(ctx) {
        if (!ctx.state.pts) return;
        ctx.state.pts.push([ctx.p.x, ctx.p.y, ctx.pressure]);
        ctx.preview(strokeShape(ctx, ctx.state.pts));
      },
      up(ctx) {
        const pts = ctx.state.pts;
        if (pts && pts.length > 1) ctx.commit({ ...strokeShape(ctx, pts), rotation: 0 });
        ctx.preview(null);
      },
    };
  },
};

// the built-in handlers, resolved once (the pen has no per-host state).
export const penHandlers = PenBrush.use();
