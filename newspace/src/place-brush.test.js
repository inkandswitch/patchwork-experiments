import { describe, it, expect } from "vitest";
import { placeHandlers } from "./place-brush.js";

function fakeCtx() {
  const out = { previews: [], placed: null, ended: false, state: {} };
  return {
    out, p: { x: 10, y: 20 }, state: out.state,
    preview: (d) => out.previews.push(d),
    placeAt: (d) => (out.placed = d),
    endTool: () => (out.ended = true),
    move(x, y) { this.p = { x, y }; },
  };
}

describe("PlaceBrush — draw a rect, then materialise", () => {
  it("down previews a 0-size placement rect", () => {
    const ctx = fakeCtx();
    placeHandlers.down(ctx);
    expect(ctx.out.previews.at(-1)).toEqual({ kind: "place", x: 10, y: 20, w: 0, h: 0 });
  });
  it("move resizes; up hands the rect to placeAt and snaps the tool back", () => {
    const ctx = fakeCtx();
    placeHandlers.down(ctx);
    ctx.move(110, 90); placeHandlers.move(ctx);
    expect(ctx.out.previews.at(-1).w).toBe(100);
    placeHandlers.up(ctx);
    expect(ctx.out.placed).toEqual({ kind: "place", x: 10, y: 20, w: 100, h: 70 });
    expect(ctx.out.ended).toBe(true);
    expect(ctx.out.previews.at(-1)).toBe(null);
  });
});
