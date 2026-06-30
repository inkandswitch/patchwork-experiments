import { describe, it, expect } from "vitest";
import { textHandlers } from "./text-brush.js";
import { eraserHandlers } from "./eraser-brush.js";

describe("TextBrush — click vs drag", () => {
  function fakeCtx() {
    const out = { previews: [], point: null, box: null, ended: false, state: {} };
    return {
      out, p: { x: 5, y: 7 }, state: out.state,
      preview: (d) => out.previews.push(d),
      createText: (x, y) => (out.point = { x, y }),
      createTextBox: (x, y, w, h) => (out.box = { x, y, w, h }),
      endTool: () => (out.ended = true),
      move(x, y) { this.p = { x, y }; },
    };
  }
  it("a click (no real drag) drops POINT text at the press point", () => {
    const ctx = fakeCtx();
    textHandlers.down(ctx);
    textHandlers.up(ctx);
    expect(ctx.out.point).toEqual({ x: 5, y: 7 });
    expect(ctx.out.box).toBe(null);
    expect(ctx.out.ended).toBe(true);
  });
  it("a real drag makes a normalised text BOX", () => {
    const ctx = fakeCtx();
    textHandlers.down(ctx);
    ctx.move(105, 57); textHandlers.move(ctx);
    expect(ctx.out.previews.at(-1).w).toBe(100);
    textHandlers.up(ctx);
    expect(ctx.out.box).toEqual({ x: 5, y: 7, w: 100, h: 50 });
    expect(ctx.out.point).toBe(null);
  });
  it("normalises a backwards (up-left) drag", () => {
    const ctx = fakeCtx();
    textHandlers.down(ctx);          // start 5,7
    ctx.move(-95, -43); textHandlers.move(ctx); // w=-100, h=-50
    textHandlers.up(ctx);
    expect(ctx.out.box).toEqual({ x: -95, y: -43, w: 100, h: 50 });
  });
});

describe("EraserBrush — erase on down + every move", () => {
  it("calls eraseAt with the pointer event on down and move", () => {
    const events = [];
    const ctx = { event: { clientX: 1, clientY: 2 }, state: {}, eraseAt: (ev) => events.push(ev) };
    eraserHandlers.down(ctx);
    ctx.event = { clientX: 3, clientY: 4 };
    eraserHandlers.move(ctx);
    expect(events).toEqual([{ clientX: 1, clientY: 2 }, { clientX: 3, clientY: 4 }]);
  });
});
