import { describe, it, expect } from "vitest";
import { shapeHandlers } from "../src/shape-brush.js";

// a fake per-phase ctx whose preview/commit/endTool we observe
function fakeCtx(shapeType) {
  const params = { color: "#111", fill: "paper", size: 3, roughness: 1.5, bowing: 1, fillStyle: "solid", strokeStyle: "solid", corner: "squircle", startArrow: false, endArrow: true };
  const out = { previews: [], committed: null, ended: false, state: {} };
  return {
    out, shapeType, p: { x: 0, y: 0 }, state: out.state,
    param: (k) => params[k],
    seed: () => 42,
    preview: (d) => out.previews.push(d),
    commit: (item) => (out.committed = item),
    bindArrow: () => ({}),
    endTool: () => (out.ended = true),
    move(x, y) { this.p = { x, y }; },
  };
}

describe("ShapeBrush — draw a rectangle", () => {
  it("down previews a 0-size seeded shape of the active type", () => {
    const ctx = fakeCtx("rectangle");
    shapeHandlers.down(ctx);
    const dr = ctx.out.previews.at(-1);
    expect(dr.kind).toBe("shape");
    expect(dr.type).toBe("rectangle");
    expect(dr.w).toBe(0);
    expect(dr.fill).toBe("paper");   // closed shape → takes a fill
    expect(dr.seed).toBe(42);
  });
  it("a line/arrow gets fill:none", () => {
    const ctx = fakeCtx("line");
    shapeHandlers.down(ctx);
    expect(ctx.out.previews.at(-1).fill).toBe("none");
  });
  it("move resizes; up commits a sized shape and snaps the tool back", () => {
    const ctx = fakeCtx("ellipse");
    shapeHandlers.down(ctx);
    ctx.move(40, 30); shapeHandlers.move(ctx);
    expect(ctx.out.previews.at(-1).w).toBe(40);
    shapeHandlers.up(ctx);
    expect(ctx.out.committed.type).toBe("ellipse");
    expect(ctx.out.committed.w).toBe(40);
    expect(ctx.out.committed.rotation).toBe(0);
    expect(ctx.out.ended).toBe(true);
    expect(ctx.out.previews.at(-1)).toBe(null);
  });
  it("a tiny drag commits nothing (below threshold)", () => {
    const ctx = fakeCtx("rectangle");
    shapeHandlers.down(ctx);
    ctx.move(2, 1); shapeHandlers.move(ctx);
    shapeHandlers.up(ctx);
    expect(ctx.out.committed).toBe(null);
    expect(ctx.out.ended).toBe(true); // still snaps back
  });
});
