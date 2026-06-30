// The SHAPE brush — rectangle / ellipse / line / arrow, pulled out of the host as a
// `use(canvas)` brush. The active shape TYPE comes from `ctx.shapeType` (the toolbar tool);
// one brush draws all four. It reads its look from the resolved params (color/fill/size/
// roughness/bowing/fillStyle/strokeStyle/corner/arrowheads), so the existing properties
// popup drives it unchanged.
//
//   down  → preview a rough shape sized 0 at the pointer, seeded once (deterministic)
//   move  → resize to the drag
//   up    → commit (binding an arrow's ends to shapes they land on, via ctx.bindArrow),
//           then snap back to the pointer (ctx.endTool)
//
// The two canvas-coupled bits — arrow binding and the tool snap-back — are provided BY the
// host on the ctx, so the brush itself stays free of canvas internals.

export const ShapeBrush = {
  id: "shape",
  use() {
    return {
      down(ctx) {
        const t = ctx.shapeType;
        const closed = t !== "line" && t !== "arrow"; // only rect/ellipse take a fill
        ctx.state.draft = {
          kind: "shape", type: t, x: ctx.p.x, y: ctx.p.y, w: 0, h: 0,
          color: ctx.param("color"),
          fill: closed ? ctx.param("fill") : "none",
          strokeWidth: ctx.param("size"),
          roughness: ctx.param("roughness"), bowing: ctx.param("bowing"),
          fillStyle: ctx.param("fillStyle"), strokeStyle: ctx.param("strokeStyle"),
          corner: ctx.param("corner"), startArrow: ctx.param("startArrow"), endArrow: ctx.param("endArrow"),
          seed: ctx.seed(),
        };
        ctx.preview(ctx.state.draft);
      },
      move(ctx) {
        const d = ctx.state.draft; if (!d) return;
        ctx.state.draft = { ...d, w: ctx.p.x - d.x, h: ctx.p.y - d.y };
        ctx.preview(ctx.state.draft);
      },
      up(ctx) {
        const d = ctx.state.draft;
        if (d && Math.hypot(d.w, d.h) > 4) ctx.commit({ ...d, ...ctx.bindArrow(d), rotation: 0 });
        ctx.preview(null);
        ctx.endTool(); // every shape but pen/eraser snaps back to the pointer
      },
    };
  },
};

export const shapeHandlers = ShapeBrush.use();
