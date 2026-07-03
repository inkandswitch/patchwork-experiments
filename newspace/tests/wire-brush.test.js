import { describe, it, expect } from "vitest";
import { wireHandlers } from "../src/wire-brush.js";

// a fake wire ctx whose capabilities we observe
function fakeCtx(isClick) {
  const out = { updated: 0, inspected: 0, dropped: 0 };
  return { out, isClick, updateWire: () => out.updated++, inspectPort: () => out.inspected++, drop: () => out.dropped++ };
}

describe("WireBrush — drag state machine", () => {
  it("move drags the wire's loose end", () => {
    const ctx = fakeCtx(false);
    wireHandlers.move(ctx);
    wireHandlers.move(ctx);
    expect(ctx.out.updated).toBe(2);
  });
  it("up on a CLICK inspects the port's schema (no drop)", () => {
    const ctx = fakeCtx(true);
    wireHandlers.up(ctx);
    expect(ctx.out.inspected).toBe(1);
    expect(ctx.out.dropped).toBe(0);
  });
  it("up after a real DRAG resolves the drop (no inspect)", () => {
    const ctx = fakeCtx(false);
    wireHandlers.up(ctx);
    expect(ctx.out.dropped).toBe(1);
    expect(ctx.out.inspected).toBe(0);
  });
  it("down is a no-op (the host grabbed the port in the capture phase)", () => {
    expect(() => wireHandlers.down({})).not.toThrow();
  });
});
