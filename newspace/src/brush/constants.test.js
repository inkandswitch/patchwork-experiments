import { describe, it, expect, vi, afterEach } from "vitest";
import {
  colorVar, fillVar, FILL_BG, fontFamily, FONTS, shapeRenderProps, shapePropsEqual,
  sortById, clamp, clonePlain, colorFor, SHAPE_TOOLS, rndSeed, uid,
} from "./constants.js";

describe("colorVar (palette name -> css var)", () => {
  it("maps a single-word palette name to a --space-color-* var", () => {
    expect(colorVar("blue")).toBe("var(--space-color-blue)");
  });
  it("hyphenates multi-word palette names", () => {
    // "deep purple" must collapse internal whitespace to one hyphen
    expect(colorVar("deep purple")).toBe("var(--space-color-deep-purple)");
    expect(colorVar("  deep   blue  ")).toBe("var(--space-color-deep-blue)");
  });
  it("passes legacy/raw css values straight through (has digits or punctuation)", () => {
    // anything that isn't a-z/space is treated as an already-resolved css value
    expect(colorVar("#ff2284")).toBe("#ff2284");
    expect(colorVar("oklch(0.6 0.1 30)")).toBe("oklch(0.6 0.1 30)");
  });
  it("returns the paper background var for 'paper'", () => {
    expect(colorVar("paper")).toBe(FILL_BG);
  });
  it("returns falsy/none unchanged", () => {
    expect(colorVar("none")).toBe("none");
    expect(colorVar("")).toBe("");
    expect(colorVar(undefined)).toBe(undefined);
  });
});

describe("fillVar (fills read as a paler tint)", () => {
  it("none / falsy are passed through (no fill)", () => {
    expect(fillVar("none")).toBe("none");
    expect(fillVar("")).toBe("");
    expect(fillVar(undefined)).toBe(undefined);
  });
  it("'paper' is the exact canvas colour, not a mix (so it occludes)", () => {
    expect(fillVar("paper")).toBe(FILL_BG);
  });
  it("a palette colour becomes a color-mix toward the background", () => {
    const f = fillVar("red");
    expect(f).toContain("color-mix");
    expect(f).toContain("var(--space-color-red)"); // built on top of colorVar
    expect(f).toContain(FILL_BG); // mixed toward paper
  });
});

describe("fontFamily", () => {
  it("resolves a known face to its var stack", () => {
    expect(fontFamily("serif")).toBe(FONTS.serif);
    expect(fontFamily("code")).toBe(FONTS.code);
  });
  it("falls back to the hand face for an unknown key", () => {
    expect(fontFamily("nope")).toBe(FONTS.hand);
    expect(fontFamily(undefined)).toBe(FONTS.hand);
  });
});

describe("shapeRenderProps", () => {
  it("resolves both colours through the resolver, leaving other props intact", () => {
    const it = { id: "x", type: "rectangle", color: "blue", fill: "red", w: 10 };
    // resolver records what var() strings it was handed, returns a marker
    const seen = [];
    const resolve = (v) => { seen.push(v); return `R(${v})`; };
    const out = shapeRenderProps(it, resolve);
    expect(seen).toEqual(["var(--space-color-blue)", expect.stringContaining("color-mix")]);
    expect(out.color).toBe("R(var(--space-color-blue))");
    expect(out.fill).toContain("R(color-mix");
    expect(out.w).toBe(10); // untouched
    expect(out.id).toBe("x");
  });
  it("keeps a 'none' fill as none through the resolver", () => {
    const out = shapeRenderProps({ color: "blue", fill: "none" }, (v) => v);
    expect(out.fill).toBe("none");
  });
});

describe("sortById (stable id order for DOM stability)", () => {
  it("sorts ascending by id without mutating the input", () => {
    const items = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const out = sortById(items);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(items.map((i) => i.id)).toEqual(["c", "a", "b"]); // original order untouched
  });
  it("tolerates null/undefined", () => {
    expect(sortById(null)).toEqual([]);
    expect(sortById(undefined)).toEqual([]);
  });
  it("returns a NEW array (a copy)", () => {
    const items = [{ id: "a" }];
    expect(sortById(items)).not.toBe(items);
  });
});

describe("clamp", () => {
  it("clamps below, above, and within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it("returns the bound when value equals it", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("clonePlain (plain copy for cross-doc moves)", () => {
  it("deep-copies stroke points and normalises a missing pressure to 0.5", () => {
    const o = { id: "s", kind: "stroke", points: [[1, 2], [3, 4, 0.9]], parent: "f1" };
    const c = clonePlain(o);
    expect(c.points).toEqual([[1, 2, 0.5], [3, 4, 0.9]]); // default pressure filled in
    c.points[0][0] = 999;
    expect(o.points[0][0]).toBe(1); // original untouched (deep copy)
  });
  it("drops the parent key (so a moved item is re-parented by the caller)", () => {
    expect(clonePlain({ kind: "doc", parent: "f1", x: 0 })).not.toHaveProperty("parent");
  });
  it("shallow-copies non-stroke items as-is (minus parent)", () => {
    const o = { id: "d", kind: "doc", url: "automerge:x", x: 1, parent: "f" };
    expect(clonePlain(o)).toEqual({ id: "d", kind: "doc", url: "automerge:x", x: 1 });
  });
});

describe("colorFor (stable fallback colour from a string)", () => {
  it("is deterministic for the same input", () => {
    expect(colorFor("alice")).toBe(colorFor("alice"));
  });
  it("produces a valid oklch hue in [0,360)", () => {
    const c = colorFor("bob");
    const hue = Number(c.match(/oklch\(0\.62 0\.19 (\d+)\)/)[1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
  it("handles empty / nullish input without throwing", () => {
    expect(colorFor("")).toContain("oklch");
    expect(colorFor(undefined)).toContain("oklch");
  });
  it("usually differs between distinct inputs", () => {
    expect(colorFor("alice")).not.toBe(colorFor("zara"));
  });
});

describe("SHAPE_TOOLS", () => {
  it("contains exactly the four sketchy shape tools", () => {
    expect([...SHAPE_TOOLS].sort()).toEqual(["arrow", "ellipse", "line", "rectangle"]);
    expect(SHAPE_TOOLS.has("pen")).toBe(false);
  });
});

describe("rndSeed / uid (id generators)", () => {
  it("rndSeed stays inside the 31-bit positive range", () => {
    for (let i = 0; i < 50; i++) {
      const s = rndSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2147483647);
    }
  });
  it("uid produces distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, uid));
    expect(ids.size).toBe(200);
  });
});

describe("shapePropsEqual (PERF.md Phase 7 — the shape-stream sync equality)", () => {
  afterEach(() => vi.restoreAllMocks());
  const points = Array.from({ length: 500 }, (_, i) => [i, i * 2, 0.5]);
  const stroke = { id: "s1", kind: "stroke", points, color: "line", size: 5, x: 10, y: 20 };

  it("same-identity points short-circuit — no stringify of the big array", () => {
    const spy = vi.spyOn(JSON, "stringify");
    expect(shapePropsEqual(stroke, { ...stroke })).toBe(true); // points share identity
    expect(spy).not.toHaveBeenCalled(); // every key compared by identity alone
  });

  it("changed identity but equal content still compares equal (deep fallback)", () => {
    const spy = vi.spyOn(JSON, "stringify");
    expect(shapePropsEqual(stroke, { ...stroke, points: structuredClone(points) })).toBe(true);
    expect(spy).toHaveBeenCalled(); // only the replaced key took the deep path
  });

  it("changed content is unequal", () => {
    const moved = structuredClone(points); moved[0][0] = 999;
    expect(shapePropsEqual(stroke, { ...stroke, points: moved })).toBe(false);
    expect(shapePropsEqual(stroke, { ...stroke, x: 11 })).toBe(false);
  });

  it("first push (previous value undefined) and key-set changes are unequal", () => {
    expect(shapePropsEqual(undefined, { ...stroke })).toBe(false);
    expect(shapePropsEqual({ ...stroke }, { ...stroke, extra: 1 })).toBe(false);
    const { size, ...smaller } = stroke;
    expect(shapePropsEqual(stroke, { ...smaller, other: 1 })).toBe(false); // same length, different keys
  });

  it("identical reference is equal", () => {
    expect(shapePropsEqual(stroke, stroke)).toBe(true);
  });
});
