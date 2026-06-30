// The PLACE brush — draw a rectangle to drop a thing at those bounds. It backs BOTH the
// "place" tool (drop the chosen doc / editor / lens from the + menu or node palette) and the
// "box" tool (a new folder sub-space). The brush owns only the draw-a-rect gesture; WHAT gets
// created (and at what default size on a click) is the host capability ctx.placeAt — so a
// brush "is just the word for a tool", and placement is a tool like any other.
//
//   down → start a placement rect at the pointer
//   move → resize it
//   up   → hand the rect to the host to materialise (a click → a sensible default size)

export const PlaceBrush = {
  id: "place",
  use() {
    return {
      down(ctx) { ctx.state.draft = { kind: "place", x: ctx.p.x, y: ctx.p.y, w: 0, h: 0 }; ctx.preview(ctx.state.draft); },
      move(ctx) { const d = ctx.state.draft; if (!d) return; ctx.state.draft = { ...d, w: ctx.p.x - d.x, h: ctx.p.y - d.y }; ctx.preview(ctx.state.draft); },
      up(ctx) { const d = ctx.state.draft; if (d) ctx.placeAt(d); ctx.preview(null); ctx.endTool(); },
    };
  },
};

export const placeHandlers = PlaceBrush.use();
