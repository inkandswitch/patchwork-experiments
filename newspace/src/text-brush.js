// The TEXT brush — click to drop point text (grows to fit), or drag a fixed-width text
// box (wraps). Pulled out of the host as a `use(canvas)` brush. The item creation +
// inline-edit is a host capability (ctx.createText / ctx.createTextBox), so the brush
// stays free of canvas internals; it only owns the click-vs-drag gesture + the preview.
//
//   down → remember the press point, preview a dashed placement rect
//   move → resize the rect
//   up   → a real drag (> ~12px) makes a wrapped box; a click makes point text

export const TextBrush = {
  id: "text",
  use() {
    return {
      down(ctx) {
        ctx.state.x0 = ctx.p.x; ctx.state.y0 = ctx.p.y;
        ctx.state.draft = { kind: "place", x: ctx.p.x, y: ctx.p.y, w: 0, h: 0 };
        ctx.preview(ctx.state.draft);
      },
      move(ctx) {
        const d = ctx.state.draft; if (!d) return;
        ctx.state.draft = { ...d, w: ctx.p.x - d.x, h: ctx.p.y - d.y };
        ctx.preview(ctx.state.draft);
      },
      up(ctx) {
        const d = ctx.state.draft;
        if (d && Math.hypot(d.w, d.h) > 12) {
          let { x, y, w, h } = d;
          if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
          ctx.createTextBox(x, y, w, h);
        } else ctx.createText(ctx.state.x0, ctx.state.y0);
        ctx.preview(null);
        ctx.endTool();
      },
    };
  },
};

export const textHandlers = TextBrush.use();
