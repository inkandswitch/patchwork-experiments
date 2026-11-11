// The die doc: what a doc is read as, and the presets' layouts, each checked
// face by face against the convention it follows.
import { describe, it, expect } from "vitest";
import { DEFAULT_BODY, DEFAULT_INK, MAX_MARKS, MAX_SIZE, MIN_SIZE, PRESETS, SHAPE_PRESET, USUAL_SIZE, cleanMark, dieKey, dieOf, faceLabel, opposed, presetDoc, spindown } from "./die.js";
import { DieDatatype } from "./datatype.js";
import { SHAPES, neighbours, shapeSides, solid } from "./solids.js";

const labels = (id) => dieOf(PRESETS[id].make()).faces.map((f) => f.label);
const numbers = (id) => labels(id).map(Number);

describe("a die doc, read", () => {
  it("anything at all reads as a whole die: a d6 at its usual size, in the usual colours, every face blank", () => {
    for (const doc of [undefined, null, {}, { shape: "d7" }, { shape: "constructor", faces: "no", size: -1, body: "red" }]) {
      const d = dieOf(doc);
      expect(d).toMatchObject({ shape: "d6", size: USUAL_SIZE.d6, body: DEFAULT_BODY, ink: DEFAULT_INK, turnOnly: false, underline: false });
      expect(d.faces).toHaveLength(6);
      for (const f of d.faces) expect(f).toEqual({ marks: [], name: null, color: null, ink: null, turn: 0, label: "blank" });
    }
  });

  it("has exactly its shape's faces: missing ones blank, extra ones dropped", () => {
    for (const shape of SHAPES) {
      const n = shapeSides(shape);
      const one = { marks: [{ kind: "number", value: 1 }] };
      expect(dieOf({ shape, faces: [one] }).faces.map((f) => f.label)).toEqual(["1", ...Array(n - 1).fill("blank")]);
      expect(dieOf({ shape, faces: Array(n + 5).fill(one) }).faces).toHaveLength(n);
    }
  });

  it("keeps only well-formed marks, at most six a face", () => {
    const good = [{ kind: "number", value: -3 }, { kind: "pips", value: 9 }, { kind: "text", value: " 00 " }, { kind: "symbol", value: "plus" }];
    expect(good.map(cleanMark)).toEqual([{ kind: "number", value: -3 }, { kind: "pips", value: 9 }, { kind: "text", value: "00" }, { kind: "symbol", value: "plus" }]);
    const bad = [null, 4, {}, { kind: "number", value: 1.5 }, { kind: "number", value: "4" }, { kind: "number", value: 10000 }, { kind: "pips", value: 0 }, { kind: "pips", value: 10 }, { kind: "text", value: "   " }, { kind: "text", value: 7 }, { kind: "symbol", value: "nope" }, { kind: "symbol", value: "constructor" }, { kind: "rune", value: 1 }];
    for (const m of bad) expect([m, cleanMark(m)]).toEqual([m, null]);
    expect(cleanMark({ kind: "text", value: "ABCDEFGHIJ" })).toEqual({ kind: "text", value: "ABCDEF" });
    const face = dieOf({ faces: [{ marks: [...bad, ...Array(9).fill(good[0])] }] }).faces[0];
    expect(face.marks).toHaveLength(MAX_MARKS);
  });

  it("a face is called its name, else its marks read in order, else blank", () => {
    expect(faceLabel({ marks: [] })).toBe("blank");
    expect(faceLabel({ marks: [{ kind: "symbol", value: "sword" }, { kind: "number", value: 2 }] })).toBe("sword 2");
    expect(faceLabel({ name: "heads", marks: [{ kind: "text", value: "H" }] })).toBe("heads");
    const f = dieOf({ faces: [{ name: "  two swords  ", marks: [], color: "#AA0000", ink: "nope", turn: 450 }] }).faces[0];
    expect(f).toMatchObject({ name: "two swords", label: "two swords", color: "#aa0000", ink: null, turn: 90 });
    expect(dieOf({ faces: [{ turn: -90 }] }).faces[0].turn).toBe(270);
  });

  it("its size is held to what a die can be", () => {
    expect(dieOf({ size: 1e-9 }).size).toBe(MIN_SIZE);
    expect(dieOf({ size: 99 }).size).toBe(MAX_SIZE);
    expect(dieOf({ size: 0.03 }).size).toBe(0.03);
    expect(dieOf({ shape: "d20", size: "big" }).size).toBe(USUAL_SIZE.d20);
  });

  it("a 6 and a 9 are underlined only on a die that has both alone on a face", () => {
    expect(dieOf(PRESETS.d20.make()).underline).toBe(true);
    expect(dieOf(PRESETS.d12.make()).underline).toBe(true);
    expect(dieOf(PRESETS["d10"].make()).underline).toBe(true);
    expect(dieOf(PRESETS["d6-numerals"].make()).underline).toBe(false);
    expect(dieOf(PRESETS.d8.make()).underline).toBe(false);
    expect(dieOf(PRESETS.d6.make()).underline).toBe(false);
  });

  it("what it's built from is its shape, size, colours and faces: never its title or its rolls", () => {
    const doc = PRESETS.d20.make();
    const key = dieKey(doc);
    expect(dieKey({ ...doc, title: "Lucky", rolls: [{ face: 3, at: 1 }], "@patchwork": { type: "die" } })).toBe(key);
    const changed = [
      { shape: "d12" },
      { size: 0.03 },
      { body: "#000000" },
      { ink: "#ffffff" },
      { turnOnly: true },
      { faces: doc.faces.map((f, i) => (i === 7 ? { ...f, turn: 90 } : f)) },
      { faces: doc.faces.map((f, i) => (i === 7 ? { ...f, name: "x" } : f)) },
      { faces: doc.faces.map((f, i) => (i === 7 ? { ...f, color: "#112233" } : f)) },
      { faces: doc.faces.map((f, i) => (i === 7 ? { marks: [] } : f)) },
      { faces: [...doc.faces].reverse() },
    ];
    for (const c of changed) expect([c, dieKey({ ...doc, ...c }) !== key]).toEqual([c, true]);
  });
});

describe("the datatype", () => {
  it("a new die is a d6 with spots, 16 mm across; a copy starts unrolled", () => {
    const doc = {};
    DieDatatype.init(doc);
    expect(doc).toEqual(presetDoc("d6"));
    expect(doc.size).toBe(0.016);
    expect(dieOf(doc).faces.every((f) => f.marks.length === 1 && f.marks[0].kind === "pips")).toBe(true);
    expect(DieDatatype.getTitle(doc)).toBe("d6");
    DieDatatype.setTitle(doc, "Mine");
    doc.rolls.push({ face: 1, at: 1 });
    DieDatatype.markCopy(doc);
    expect(doc.title).toBe("Copy of Mine");
    expect(doc.rolls).toEqual([]);
    expect(DieDatatype.getTitle({})).toBe("Die");
  });
});

describe("layouts", () => {
  it("opposed: on every shape with opposite faces, each pair holds the lowest and highest left", () => {
    for (const shape of ["d6", "d8", "d10", "d12", "d20", "coin"]) {
      const s = solid(shape);
      const n = s.outcomes.length;
      const values = opposed(shape, Array.from({ length: n }, (_, i) => i + 1));
      expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      s.outcomes.forEach((o, i) => expect(values[i] + values[o.opposite]).toBe(n + 1));
    }
    // a d4 has no opposite faces: in order
    expect(opposed("d4", [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("spindown: every value once, each on a face sharing an edge with the one before, on every shape read from its faces", () => {
    for (const shape of ["d6", "d8", "d10", "d12", "d20"]) {
      const s = solid(shape);
      const n = s.outcomes.length;
      const values = spindown(shape, Array.from({ length: n }, (_, i) => n - i));
      expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (let v = n; v > 1; v--) expect(neighbours(s, values.indexOf(v))).toContain(values.indexOf(v - 1));
      expect(values[0]).toBe(n);
    }
  });
});

describe("the presets", () => {
  it("every one is a whole, valid die doc that reads back as itself", () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      const doc = p.make();
      expect(typeof p.name).toBe("string");
      expect(Object.keys(doc).sort()).toEqual(["body", "faces", "ink", "rolls", "shape", "size", "title", "turnOnly"]);
      const die = dieOf(doc);
      expect([id, die.shape, die.size, die.body, die.ink, die.turnOnly]).toEqual([id, doc.shape, doc.size, doc.body, doc.ink, doc.turnOnly]);
      expect(doc.faces).toHaveLength(shapeSides(doc.shape));
      // nothing in it was dropped or altered on reading
      die.faces.forEach((f, i) => expect(f.marks).toEqual(doc.faces[i].marks));
      // each call makes a fresh one
      expect(p.make()).toEqual(doc);
      expect(p.make().faces).not.toBe(doc.faces);
    }
    for (const shape of SHAPES) expect(PRESETS[SHAPE_PRESET[shape]].make().shape).toBe(shape);
  });

  it("the numbered dice: each number once, opposite faces adding to one more than the faces (a d10, 0 to 9: to 9)", () => {
    for (const [id, lo] of [["d6-numerals", 1], ["d8", 1], ["d10", 0], ["d12", 1], ["d20", 1]]) {
      const s = solid(PRESETS[id].make().shape);
      const n = s.outcomes.length;
      const v = numbers(id);
      expect([...v].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => lo + i));
      s.outcomes.forEach((o, i) => expect(v[i] + v[o.opposite]).toBe(2 * lo + n - 1));
    }
    expect(numbers("d4")).toEqual([1, 2, 3, 4]);
  });

  it("a d6 with spots: one to six as spots, opposite faces adding to seven", () => {
    const die = dieOf(PRESETS.d6.make());
    const s = solid("d6");
    expect(die.faces.map((f) => f.marks[0].kind)).toEqual(Array(6).fill("pips"));
    s.outcomes.forEach((o, i) => expect(die.faces[i].marks[0].value + die.faces[o.opposite].marks[0].value).toBe(7));
  });

  it("the tens d10 is the d10 with a 0 after each number, on the same faces", () => {
    expect(labels("d10-tens")).toEqual(labels("d10").map((l) => `${l}0`));
    expect(labels("d10-tens")).toContain("00");
    expect(dieOf(PRESETS["d10-tens"].make()).faces.every((f) => f.marks[0].kind === "text")).toBe(true);
  });

  it("the spindown d20 has the standard d20's numbers on the same solid, laid out another way: neighbours count down", () => {
    const s = solid("d20");
    const v = numbers("d20-spindown");
    expect([...v].sort((a, b) => a - b)).toEqual([...numbers("d20")].sort((a, b) => a - b));
    expect(v).not.toEqual(numbers("d20"));
    for (let k = 20; k > 1; k--) expect(neighbours(s, v.indexOf(k))).toContain(v.indexOf(k - 1));
    // and the standard one's neighbours don't
    const std = numbers("d20");
    expect(Array.from({ length: 19 }, (_, k) => neighbours(s, std.indexOf(k + 2)).includes(std.indexOf(k + 1))).every(Boolean)).toBe(false);
  });

  it("the plus/minus die: two plus, two minus, two blank, opposite faces alike", () => {
    const l = labels("plus-minus");
    expect([...l].sort()).toEqual(["blank", "blank", "minus", "minus", "plus", "plus"]);
    solid("d6").outcomes.forEach((o, i) => expect(l[o.opposite]).toBe(l[i]));
  });

  it("the d3 is a d6 numbered one to three twice, opposite faces alike", () => {
    const l = labels("d3");
    expect([...l].sort()).toEqual(["1", "1", "2", "2", "3", "3"]);
    solid("d6").outcomes.forEach((o, i) => expect(l[o.opposite]).toBe(l[i]));
  });

  it("the doubling cube: 2 to 64, turned by hand and never rolled, 30 mm", () => {
    const die = dieOf(PRESETS.doubling.make());
    expect(die.faces.map((f) => Number(f.label)).sort((a, b) => a - b)).toEqual([2, 4, 8, 16, 32, 64]);
    expect(die.turnOnly).toBe(true);
    expect(die.size).toBe(0.03);
    // every other preset is rolled
    for (const [id, p] of Object.entries(PRESETS)) if (id !== "doubling") expect(p.make().turnOnly).toBe(false);
  });

  it("the d6 with a symbol for its 6 still reads 6 there, and spots elsewhere", () => {
    const die = dieOf(PRESETS["d6-logo"].make());
    expect(die.faces.map((f) => f.label).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    const six = die.faces.find((f) => f.label === "6");
    expect(six.marks).toEqual([{ kind: "symbol", value: "star" }]);
    expect(six.name).toBe("6");
  });

  it("the icon die's icons carry counts: faces with one mark and with two", () => {
    const die = dieOf(PRESETS.icons.make());
    expect(die.faces.map((f) => f.label).sort()).toEqual(["2 shields", "2 swords", "blank", "shield", "sword", "sword"]);
    expect(die.faces.map((f) => f.marks.length).sort()).toEqual([0, 1, 1, 1, 2, 2]);
  });

  it("a coin: heads and tails, heads up as it stands", () => {
    expect(labels("coin")).toEqual(["heads", "tails"]);
  });

  it("sizes are real: a d6 is 16 mm, a d20 20 mm, a coin 24 mm", () => {
    expect([presetDoc("d6").size, presetDoc("d20").size, presetDoc("coin").size]).toEqual([0.016, 0.02, 0.024]);
    expect(presetDoc("nope")).toEqual(presetDoc("d6"));
  });
});
