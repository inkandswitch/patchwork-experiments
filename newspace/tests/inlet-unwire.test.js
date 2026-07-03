// REGRESSION: removing a wire must actually disconnect the inlet — for EVERY node,
// including a bare layer tool (the minimap) whose inlet names all match canvas
// outlets. The bug: unwire deleted the `inlets` key, and the bare auto-wire fallback
// (any UNSET inlet matching a canvas outlet is fed the ambient canvas stream)
// immediately rebound the proxy to the very same data — so "delete the wire" was a
// cosmetic no-op. The fix: unwire writes a `null` TOMBSTONE (explicitly disconnected),
// and `inletBackingPlan` never splat/auto-feeds a tombstoned inlet.
import { describe, it, expect } from "vitest";
import { inletProxy, inletBackingPlan, chromePressTool } from "../src/brush/items/editor-item.jsx";
import { Opstream } from "../src/opstreams.js";

describe("inletBackingPlan — wiring entry → backing decision", () => {
  it("an explicit wire wins", () => {
    const plan = inletBackingPlan({ rects: { node: "ns-ctx-mm", outlet: "rects" } }, "rects", { auto: true });
    expect(plan.kind).toBe("wired");
    expect(plan.wire).toEqual({ node: "ns-ctx-mm", outlet: "rects" });
  });

  it("a NEVER-wired inlet on a bare tool auto-wires to the canvas outlet", () => {
    expect(inletBackingPlan({}, "rects", { auto: true }).kind).toBe("auto");
    expect(inletBackingPlan(undefined, "rects", { auto: true }).kind).toBe("auto");
  });

  it("a never-wired inlet prefers the splat over the auto outlet", () => {
    expect(inletBackingPlan({}, "rects", { splat: true, auto: true }).kind).toBe("splat");
  });

  it("nothing available ⇒ the proxy's own buffer", () => {
    expect(inletBackingPlan({}, "rects").kind).toBe("buffer");
  });

  it("the null tombstone (unwire) CUTS the inlet — no auto, no splat", () => {
    // this is the minimap bug: after unwire the auto fallback must NOT rebind
    expect(inletBackingPlan({ rects: null }, "rects", { auto: true }).kind).toBe("cut");
    expect(inletBackingPlan({ rects: null }, "rects", { splat: true }).kind).toBe("cut");
    expect(inletBackingPlan({ rects: null }, "rects", { splat: true, auto: true }).kind).toBe("cut");
  });

  it("re-wiring over a tombstone works", () => {
    expect(inletBackingPlan({ rects: { node: "n2", outlet: "o" } }, "rects", { auto: true }).kind).toBe("wired");
  });
});

describe("inletProxy — wire removal disconnects the upstream", () => {
  it("setBacking(null) after a wired stream: emits undefined and stops receiving", () => {
    const src = new Opstream([{ x: 0, y: 0, w: 10, h: 10 }]);
    const p = inletProxy();
    p.setBacking(src);
    const seen = [];
    p.connect((op) => seen.push(op));
    expect(p.value).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(p.wired).toBe(true);

    // the wire is removed → the effect resolves to the buffer (plan "cut")
    p.setBacking(null);
    expect(p.wired).toBe(false);
    expect(p.value).toBeUndefined();
    // subscribers were told immediately (the buffer's snapshot re-emits on rewire)
    expect(seen.at(-1)).toEqual({ type: "snapshot", value: undefined });

    // ops on the OLD upstream no longer reach the proxy
    const n = seen.length;
    src.apply({ type: "snapshot", value: "still flowing upstream" });
    expect(seen.length).toBe(n);
    expect(p.value).toBeUndefined();
  });
});

describe("chromePressTool — which tools press an editor item's chrome", () => {
  it("select/wire grab-move it, eraser deletes it", () => {
    expect(chromePressTool("select")).toBe(true);
    expect(chromePressTool("wire")).toBe(true);
    expect(chromePressTool("eraser")).toBe(true);
  });
  it("drawing/placing brushes fall through to the canvas draw handler", () => {
    for (const t of ["pen", "rectangle", "ellipse", "line", "arrow", "text", "place", "box", "marker", "hand"]) {
      expect(chromePressTool(t)).toBe(false);
    }
  });
});
