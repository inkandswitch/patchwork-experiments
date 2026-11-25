import { readFileSync } from "node:fs";
import { readFrd, readDat } from "./frd.js";

const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8");
const values = (block, node) => Array.from(block.values.subarray((node - 1) * block.components, node * block.components));

describe("readFrd: CalculiX 2.23's own displacement block", () => {
  const blocks = readFrd(fixture("ccx-2.23-disp.frd"), 4);

  it("one block, DISP, three components: the ALL line isn't a column", () => {
    expect(blocks.length).toBe(1);
    expect(blocks[0].name).toBe("DISP");
    expect(blocks[0].components).toBe(3);
    expect(blocks[0].values.length).toBe(12);
    expect(blocks[0].mode).toBeNull();
    expect(blocks[0].value).toBe(1);
  });

  it("values cut by column, so negatives touching their neighbours read right", () => {
    expect(values(blocks[0], 1)).toEqual([0, 0, 0]);
    expect(values(blocks[0], 2)).toEqual([2.85714e-3, 0, 0]);
    expect(values(blocks[0], 3)).toEqual([0, -8.57143e-4, 0]);
    expect(values(blocks[0], 4)).toEqual([0, 0, -8.57143e-4]);
  });

  it("Windows line endings read the same", () => {
    const b = readFrd(fixture("ccx-2.23-disp.frd").replace(/\n/g, "\r\n"), 4);
    expect(Array.from(b[0].values)).toEqual(Array.from(blocks[0].values));
  });
});

describe("readFrd: a static result with stresses", () => {
  const blocks = readFrd(fixture("static.frd"), 4);

  it("reads the result blocks only, not the node and element blocks before them", () => {
    expect(blocks.map((b) => [b.name, b.components])).toEqual([["DISP", 3], ["STRESS", 6]]);
  });

  it("a node the file leaves out stays NaN", () => {
    expect(values(blocks[0], 3).every(Number.isNaN)).toBe(true);
  });

  it("a three-digit exponent written without its E", () => {
    expect(values(blocks[0], 4)).toEqual([1.23456e-100, -1.23456e-100, 2.5e101]);
  });

  it("node ids outside 1…n are ignored", () => {
    // node 7 and node 0 carry 9s; nothing anywhere is 9
    expect(Array.from(blocks[0].values).some((v) => v === 9)).toBe(false);
    expect(blocks[0].values.length).toBe(12);
  });

  it("a stress block: six components a node, SXX SYY SZZ SXY SYZ SZX", () => {
    const s = blocks[1];
    expect(s.values.length).toBe(24);
    for (let n = 1; n <= 4; n++) expect(values(s, n)).toEqual([1, -2, 3, -4, 5, -6].map((v) => v * n * 1e6));
  });

  it("fewer nodes than the file names: the rest dropped; more: NaN", () => {
    expect(readFrd(fixture("static.frd"), 2)[0].values.length).toBe(6);
    const more = readFrd(fixture("static.frd"), 8)[1];
    expect(values(more, 8).every(Number.isNaN)).toBe(true);
  });
});

describe("readFrd: a frequency step", () => {
  const blocks = readFrd(fixture("modal.frd"), 4);

  it("each block carries the mode number of the PMODE line before it", () => {
    expect(blocks.map((b) => [b.name, b.mode])).toEqual([["DISP", 1], ["DISP", 2]]);
    expect(values(blocks[1], 3)).toEqual([6, -3, 0]);
  });

  it("and the value of its 100CL line", () => {
    expect(blocks[0].value).toBeCloseTo(1014.48, 9);
    expect(blocks[1].value).toBeCloseTo(1055.92, 9);
  });
});

describe("readFrd: odd files", () => {
  it("nothing in, nothing out", () => {
    expect(readFrd("", 3)).toEqual([]);
    expect(readFrd(" 9999\n", 3)).toEqual([]);
  });

  it("a block cut off before its -3 keeps what it has", () => {
    const text = fixture("ccx-2.23-disp.frd").split("\n").slice(0, 9).join("\n");
    const [b] = readFrd(text, 4);
    expect(values(b, 2)).toEqual([2.85714e-3, 0, 0]);
    expect(values(b, 3).every(Number.isNaN)).toBe(true);
  });

  it("a block with no component lines takes the count its -4 line gives", () => {
    const [b] = readFrd([" -4  TEMP        1    1", " -1         1 2.50000E+01", " -3"].join("\n"), 1);
    expect(b.components).toBe(1);
    expect(Array.from(b.values)).toEqual([25]);
  });
});

describe("readDat", () => {
  it("the total force on a set, and the strain energy (CalculiX 2.23)", () => {
    const dat = readDat(fixture("static.dat"));
    expect(dat.forces).toEqual([{ set: "SUP1", force: [1.485532e-10, 100, -8.829226e-10] }]);
    expect(dat.energy).toBe(9.999161e-3);
    expect(dat.frequencies).toEqual([]);
  });

  it("the eigenfrequencies in cycles per time, and not the participation factors after them", () => {
    const dat = readDat(fixture("modal.dat"));
    expect(dat.frequencies).toEqual([{ mode: 1, hz: 1014.478 }, { mode: 2, hz: 1055.919 }]);
    expect(dat.forces).toEqual([]);
    expect(dat.energy).toBeNull();
  });

  it("the table ends at a line of words even without the spaced-out heading", () => {
    const text = fixture("modal.dat").replace("     P A R T I C I P A T I O N   F A C T O R S\n\n", "");
    expect(readDat(text).frequencies).toEqual([{ mode: 1, hz: 1014.478 }, { mode: 2, hz: 1055.919 }]);
  });

  it("set names in any case come back upper-case; the last step's total is the one kept", () => {
    const text = [
      " total force (fx,fy,fz) for set sup2 and time  0.5000000E+00",
      "",
      "        1.0E+00  2.0E+00  3.0E+00",
      " total force (fx,fy,fz) for set SUP2 and time  0.1000000E+01",
      "",
      "        4.0E+00  5.0E+00  6.0E+00",
    ].join("\n");
    expect(readDat(text).forces).toEqual([{ set: "SUP2", force: [4, 5, 6] }]);
  });

  it("several sets, in the order they first appear", () => {
    const text = fixture("static.dat") + fixture("static.dat").replace("SUP1", "SUP2").replace("1.000000E+02", "2.000000E+02");
    expect(readDat(text).forces.map((f) => [f.set, f.force[1]])).toEqual([["SUP1", 100], ["SUP2", 200]]);
  });

  it("a total with words where its numbers should be is left out", () => {
    expect(readDat(" total force (fx,fy,fz) for set SUP1 and time 1\n\n  no numbers here\n").forces).toEqual([]);
    expect(readDat(" total internal energy for set EALL and time 1\n").energy).toBeNull();
  });

  it("nothing in, nothing out", () => {
    expect(readDat("")).toEqual({ forces: [], energy: null, frequencies: [] });
  });
});
