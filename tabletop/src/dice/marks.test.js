// What's drawn on a die: every mark kind's art stays in its box, a face's
// marks stay in their circle however many and however turned, and on every
// preset every mark lies on its own side of the solid, clear of the edges.
import { describe, it, expect } from "vitest";
import { STROKE, SYMBOLS, dieMarks, flatSide, layoutMarks, lift, markArt, placements, polyRoom } from "./marks.js";
import { MARK_KINDS, MAX_MARKS, PRESETS, dieOf } from "./die.js";
import { cross, dot, len, sub, unit } from "./m3.js";
import { SHAPES, solid } from "./solids.js";

/** One of every mark there is: every numeral and letter, every count of spots, every symbol. */
const EVERY_MARK = [
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 64, 100, -3, 9999].map((value) => ({ kind: "number", value })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => ({ kind: "pips", value })),
  ...["A", "00", "90", "HEADS", "QJKXYZ", "+1", "a b", "W/M", "50%", "?!.:", "BCDEFG", "ILNOPR", "STUV"].map((value) => ({ kind: "text", value })),
  ...SYMBOLS.map((value) => ({ kind: "symbol", value })),
];
const TURNS = [0, 90, 180, 270, 37];
/** Every point drawn, with how far its ink reaches round it. */
const inked = (art) => [...art.strokes.flatMap((s) => s.points.map((p) => ({ p, r: s.width / 2 }))), ...art.discs.map((d) => ({ p: d.c, r: d.r }))];

describe("a mark's art", () => {
  it("every kind is covered, and every mark draws something", () => {
    expect(new Set(EVERY_MARK.map((m) => m.kind))).toEqual(new Set(MARK_KINDS));
    for (const m of EVERY_MARK) {
      const art = markArt(m);
      expect([m, art.strokes.length + art.discs.length > 0]).toEqual([m, true]);
    }
  });

  it("lies inside its own box, the strokes' width included; a 6 or 9 underlined too", () => {
    for (const m of EVERY_MARK) for (const underline of [false, true]) {
      const art = markArt(m, { underline });
      for (const s of art.strokes) for (const [x, y] of s.points) {
        expect(x).toBeGreaterThanOrEqual(STROKE / 2 - 1e-9);
        expect(x).toBeLessThanOrEqual(art.w - STROKE / 2 + 1e-9);
        expect(y).toBeGreaterThanOrEqual(STROKE / 2 - 1e-9);
        expect(y).toBeLessThanOrEqual(art.h - STROKE / 2 + 1e-9);
      }
      for (const d of art.discs) {
        expect(d.c[0] - d.r).toBeGreaterThanOrEqual(-1e-9);
        expect(d.c[0] + d.r).toBeLessThanOrEqual(art.w + 1e-9);
        expect(d.c[1] - d.r).toBeGreaterThanOrEqual(-1e-9);
        expect(d.c[1] + d.r).toBeLessThanOrEqual(art.h + 1e-9);
      }
    }
  });

  it("only a lone 6 or 9 is underlined, and only when asked", () => {
    const strokes = (value, underline) => markArt({ kind: "number", value }, { underline }).strokes.length;
    for (const v of [6, 9]) expect(strokes(v, true)).toBe(strokes(v, false) + 1);
    for (const v of [0, 8, 16, 66, 69, 96]) expect(strokes(v, true)).toBe(strokes(v, false));
  });

  it("spots: as many as the number says", () => {
    for (let n = 1; n <= 9; n++) expect(markArt({ kind: "pips", value: n }).discs).toHaveLength(n);
  });
});

describe("a face's marks, set out", () => {
  it("one to six of any marks, turned any way, lie within their circle", () => {
    const rho = 0.3;
    for (let n = 1; n <= MAX_MARKS; n++) for (let start = 0; start < EVERY_MARK.length; start++) {
      const marks = Array.from({ length: n }, (_, k) => EVERY_MARK[(start + k * 7) % EVERY_MARK.length]);
      for (const turn of TURNS) for (const q of inked(layoutMarks(marks, rho, turn, { underline: true }))) expect(Math.hypot(...q.p) + q.r).toBeLessThanOrEqual(rho + 1e-9);
    }
  });

  it("turning a face's marks turns every point about the middle, and nothing else", () => {
    const marks = [{ kind: "number", value: 12 }, { kind: "symbol", value: "sword" }];
    const a = inked(layoutMarks(marks, 1, 0)), b = inked(layoutMarks(marks, 1, 90));
    a.forEach((q, i) => {
      expect(b[i].p[0]).toBeCloseTo(-q.p[1], 12);
      expect(b[i].p[1]).toBeCloseTo(q.p[0], 12);
      expect(b[i].r).toBe(q.r);
    });
  });

  it("no marks draw nothing", () => {
    expect(layoutMarks([], 1)).toEqual({ strokes: [], discs: [] });
  });
});

describe.each(SHAPES)("where marks go on a %s", (shape) => {
  const s = solid(shape);

  it("each outcome's place is on the side it's read from: in its plane, in a right-handed frame, its circle clear of every edge", () => {
    s.outcomes.forEach((o, i) => {
      const places = placements(s, i);
      // read from the top side: one place; from the top corner: one on each of the three sides meeting there
      expect(places).toHaveLength(s.read === "face" ? 1 : 3);
      for (const pl of places) {
        const poly = s.polys[pl.poly];
        if (s.read === "face") expect(pl.poly).toBe(o.readPoly);
        else expect(poly.verts).toContain(o.readVert);
        expect(dot(poly.normal, pl.at)).toBeCloseTo(poly.d, 9);
        expect(len(pl.up)).toBeCloseTo(1, 9);
        expect(dot(pl.up, poly.normal)).toBeCloseTo(0, 9);
        cross(pl.right, pl.up).forEach((v, k) => expect(v).toBeCloseTo(poly.normal[k], 9));
        const pts = poly.verts.map((v) => s.verts[v]);
        pts.forEach((a, k) => {
          const b = pts[(k + 1) % pts.length];
          expect(dot(sub(pl.at, a), unit(cross(poly.normal, sub(b, a))))).toBeGreaterThan(pl.rho + 1e-6);
        });
      }
    });
  });

  it("no two outcomes' circles on one side overlap (a d4's three numbers per side)", () => {
    const all = s.outcomes.flatMap((_, i) => placements(s, i));
    all.forEach((a, i) => all.forEach((b, j) => j > i && a.poly === b.poly && expect(len(sub(a.at, b.at))).toBeGreaterThan(a.rho + b.rho)));
    // and every side that's read from has its place: on a d4, three on each of four sides
    if (shape === "d4") for (let p = 0; p < 4; p++) expect(all.filter((pl) => pl.poly === p)).toHaveLength(3);
  });

  it("on a level side a mark's top is towards −Z or a corner nearest it, so the top face reads from the +Z side", () => {
    const top = placements(s, 0);
    if (s.read === "face") expect(top[0].up[2]).toBeLessThan(-0.8);
  });
});

describe.each(Object.keys(PRESETS))("the marks of the preset %s", (id) => {
  const die = dieOf(PRESETS[id].make());
  const s = solid(die.shape);
  const marks = dieMarks(die, s);

  it("every face with marks is drawn where it's read, every blank face nowhere", () => {
    die.faces.forEach((f, i) => expect(marks.filter((m) => m.face === i).length).toBe(f.marks.length ? placements(s, i).length : 0));
  });

  it("every point drawn lies on its side of the solid, inside every edge by its own width", () => {
    for (const m of marks) {
      const poly = s.polys[m.poly];
      const pts = poly.verts.map((v) => s.verts[v]);
      for (const q of inked(m)) {
        const p = lift(m.placement, q.p);
        expect(dot(poly.normal, p)).toBeCloseTo(poly.d, 9);
        pts.forEach((a, k) => {
          const b = pts[(k + 1) % pts.length];
          expect(dot(sub(p, a), unit(cross(poly.normal, sub(b, a))))).toBeGreaterThan(q.r);
        });
      }
    }
  });

  it("laid flat for a picture, each side keeps its shape and its marks stay inside it", () => {
    s.polys.forEach((poly, p) => {
      const side = flatSide(die, s, p, marks);
      expect(side.points).toHaveLength(poly.verts.length);
      // the same edge lengths as on the solid
      side.points.forEach((a, k) => {
        const b = side.points[(k + 1) % side.points.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(len(sub(s.verts[poly.verts[k]], s.verts[poly.verts[(k + 1) % poly.verts.length]])), 9);
      });
      const { room } = polyRoom(s, poly);
      expect(room).toBeGreaterThan(0);
      for (const item of side.items) for (const q of inked(item)) {
        side.points.forEach((a, k) => {
          const b = side.points[(k + 1) % side.points.length];
          // anticlockwise: inside is to the left of every edge
          expect((b[0] - a[0]) * (q.p[1] - a[1]) - (b[1] - a[1]) * (q.p[0] - a[0])).toBeGreaterThan(0);
        });
      }
    });
  });
});
