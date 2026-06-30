// The ERASER brush — drag across the canvas to rub out whatever you pass over. Pulled out
// of the host as a `use(canvas)` brush. Erasing is a host capability (ctx.eraseAt, which
// hit-tests the item under the pointer and removes it), so the brush is just the gesture:
// erase on down, and keep erasing on every move.
//
// (Clicking a single item to delete it still works via the item's own grab handler — this
// brush adds the DRAG-to-erase you'd expect from a real eraser, starting on empty canvas.)

export const EraserBrush = {
  id: "eraser",
  use() {
    return {
      down(ctx) { ctx.eraseAt(ctx.event); },
      move(ctx) { ctx.eraseAt(ctx.event); },
    };
  },
};

export const eraserHandlers = EraserBrush.use();
