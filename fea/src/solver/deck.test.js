import { writeDeck } from "./deck.js";
import { applySetup } from "./loads.js";
import { finishMesh } from "./mesh.js";
import { tetBox, partOf } from "../test/tetbox.js";
import { box, placed, turned } from "../test/shapes.js";

const size = [0.2, 0.1, 0.05];
const [lx, ly, lz] = size;
const part = partOf(box(...size));
const faceFacing = (p, n) => p.faces.find((f) => n.every((v, k) => Math.abs(f.normal[k] - v) < 1e-6)).id;
const material = { E: 70e9, nu: 0.33, density: 2700 };

/** The deck's lines, and its keyword blocks: [{ keyword, line, data: string[] }]. */
function read(text) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((line, i) => {
    if (line.startsWith("*")) blocks.push({ keyword: line, line: i, data: [] });
    else if (line && blocks.length) blocks.at(-1).data.push(line);
  });
  return { lines, blocks, find: (prefix) => blocks.filter((b) => b.keyword.startsWith(prefix)) };
}

/** The equations of an *EQUATION block: [{ terms: [[node, dof, coefficient], …] }]. */
function equations(block) {
  const out = [];
  for (let i = 0; i < block.data.length; ) {
    const count = Number(block.data[i++]);
    const terms = [];
    while (terms.length < count) {
      const f = block.data[i++].split(",").map((s) => Number(s.trim()));
      for (let k = 0; k < f.length; k += 3) terms.push([f[k], f[k + 1], f[k + 2]]);
    }
    out.push({ terms });
  }
  return out;
}

/** What a deck holds a node to: one row a constraint on (ux, uy, uz). */
function constraintsOn(deck, node) {
  const rows = [];
  const sets = new Map(deck.find("*NSET").map((b) => [b.keyword.split("NSET=")[1], b.data.flatMap((l) => l.split(",").map(Number))]));
  for (const b of deck.find("*BOUNDARY"))
    for (const d of b.data) {
      const [n, a, z] = d.split(",").map((s) => s.trim());
      if (Number(n) === node || sets.get(n)?.includes(node)) for (let k = Number(a); k <= Number(z); k++) rows.push([0, 1, 2].map((j) => (j === k - 1 ? 1 : 0)));
    }
  for (const b of deck.find("*EQUATION"))
    for (const eq of equations(b)) {
      if (!eq.terms.some(([n]) => n === node)) continue;
      const row = [0, 0, 0];
      for (const [n, dof, c] of eq.terms) if (n === node) row[dof - 1] += c;
      rows.push(row);
    }
  return rows;
}
const rank = (rows) => {
  const basis = [];
  for (const r of rows) {
    let v = [...r];
    for (const b of basis) {
      const d = v[0] * b[0] + v[1] * b[1] + v[2] * b[2];
      v = v.map((x, k) => x - d * b[k]);
    }
    const l = Math.hypot(...v);
    if (l > 1e-9) basis.push(v.map((x) => x / l));
  }
  return basis.length;
};

describe("writeDeck: a static run on a box", () => {
  for (const order of [1, 2]) {
    describe(`order ${order}`, () => {
      const mesh = finishMesh(tetBox(2, 2, 2, size, order), { method: "faces", part });
      const model = {
        supports: [{ id: "s1", name: "Wall", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] }],
        loads: [
          { id: "l1", name: "Tip", kind: "force", faces: [faceFacing(part, [1, 0, 0])], force: [5, -100, 2] },
          { id: "l2", name: "Press", kind: "pressure", faces: [faceFacing(part, [0, 1, 0])], pressure: 1e5 },
          { id: "g", name: "Weight", kind: "gravity", acceleration: [0, -9.80665, 0] },
        ],
      };
      const applied = applySetup(mesh, model);
      const out = writeDeck({ title: "a\nbox*study", mesh, material, applied, analysis: { kind: "static" } });
      const deck = read(out.text);
      const per = order === 1 ? 4 : 10;
      const N = mesh.nodes.length / 3, T = mesh.tets.length / per;

      it("its sections, in order", () => {
        const order_ = deck.blocks.map((b) => b.keyword.split(",")[0]);
        expect(order_).toEqual(["*HEADING", "*NODE", "*ELEMENT", "*NSET", "*MATERIAL", "*ELASTIC", "*DENSITY", "*SOLID SECTION", "*BOUNDARY", "*STEP", "*STATIC", "*CLOAD", "*DLOAD", "*NODE FILE", "*EL FILE", "*NODE PRINT", "*EL PRINT", "*END STEP"]);
        expect(deck.find("*ELEMENT")[0].keyword).toBe(`*ELEMENT, TYPE=${order === 1 ? "C3D4" : "C3D10"}, ELSET=EALL`);
        expect(out.text.endsWith("*END STEP\n")).toBe(true);
      });

      it("the title on one line, no star in it", () => {
        expect(deck.find("*HEADING")[0].data).toEqual(["a box study"]);
      });

      it("every field fits CalculiX's 20 characters, and no line has more than 16 entries", () => {
        for (const line of deck.lines) {
          if (!line || line.startsWith("*")) continue;
          const fields = line.split(",");
          expect(fields.length).toBeLessThanOrEqual(16);
          for (const f of fields) expect(f.trim().length).toBeLessThanOrEqual(20);
        }
      });

      it("nodes and elements numbered from 1, in the mesh's order, each element its nodes", () => {
        const nodes = deck.find("*NODE,")[0].data;
        expect(nodes.length).toBe(N);
        nodes.forEach((l, n) => {
          const f = l.split(",").map(Number);
          expect(f[0]).toBe(n + 1);
          for (let k = 0; k < 3; k++) expect(f[1 + k]).toBeCloseTo(mesh.nodes[n * 3 + k], 15);
        });
        const elements = deck.find("*ELEMENT")[0].data;
        expect(elements.length).toBe(T);
        elements.forEach((l, t) => {
          const f = l.split(",").map(Number);
          expect(f.length).toBe(per + 1);
          expect(f[0]).toBe(t + 1);
          expect(f.slice(1)).toEqual(Array.from(mesh.tets.subarray(t * per, (t + 1) * per), (n) => n + 1));
        });
      });

      it("the support's node set holds its nodes, 1-based, 12 a line; the fixed support is SUP1, 1, 3", () => {
        const nset = deck.find("*NSET")[0];
        expect(nset.keyword).toBe("*NSET, NSET=SUP1");
        const ids = nset.data.flatMap((l) => l.split(",").map(Number));
        expect(ids).toEqual(Array.from(applied.supports[0].nodes, (n) => n + 1));
        for (const l of nset.data.slice(0, -1)) expect(l.split(",").length).toBe(12);
        expect(deck.find("*BOUNDARY")[0].data).toEqual(["SUP1, 1, 3"]);
        expect(out.sets).toEqual([{ id: "s1", set: "SUP1" }]);
        expect(out.held).toBe(applied.supports[0].nodes.length);
      });

      it("the material in SI", () => {
        expect(deck.find("*MATERIAL")[0].keyword).toBe("*MATERIAL, NAME=M1");
        expect(deck.find("*ELASTIC")[0].data[0].split(",").map(Number)).toEqual([70e9, 0.33]);
        expect(Number(deck.find("*DENSITY")[0].data[0])).toBe(2700);
        expect(deck.find("*SOLID SECTION")[0].keyword).toBe("*SOLID SECTION, ELSET=EALL, MATERIAL=M1");
      });

      it("*CLOAD lines add up, direction by direction, to every face load's total", () => {
        const want = [0, 0, 0];
        for (const l of applied.loads) for (let k = 0; k < 3; k++) want[k] += l.total[k];
        const got = [0, 0, 0];
        const seen = new Set();
        for (const l of deck.find("*CLOAD")[0].data) {
          const [n, dof, f] = l.split(",").map(Number);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(N);
          expect(f).not.toBe(0);
          expect(seen.has(`${n},${dof}`)).toBe(false);
          seen.add(`${n},${dof}`);
          got[dof - 1] += f;
        }
        for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 6);
        expect(want[1]).toBeCloseTo(-100 - 1e5 * lx * lz, 6);
      });

      it("gravity is one *DLOAD GRAV with its size and a unit direction", () => {
        const [f0, kind, g, ...d] = deck.find("*DLOAD")[0].data[0].split(",").map((s) => s.trim());
        expect([f0, kind]).toEqual(["EALL", "GRAV"]);
        expect(Number(g)).toBeCloseTo(9.80665, 12);
        expect(d.map(Number)).toEqual([0, -1, 0]);
      });

      it("asks for displacements, stresses, each support's reaction total, and the strain energy", () => {
        expect(deck.find("*NODE FILE")[0].data).toEqual(["U"]);
        expect(deck.find("*EL FILE")[0].data).toEqual(["S"]);
        const prints = deck.find("*NODE PRINT");
        expect(prints.map((b) => [b.keyword, b.data])).toEqual([["*NODE PRINT, NSET=SUP1, TOTALS=ONLY", ["RF"]]]);
        expect(deck.find("*EL PRINT").map((b) => [b.keyword, b.data])).toEqual([["*EL PRINT, ELSET=EALL, TOTALS=ONLY", ["ELSE"]]]);
      });
    });
  }

  it("no face loads: no *CLOAD; no gravity: no *DLOAD", () => {
    const mesh = finishMesh(tetBox(1, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, { supports: [{ id: "s", name: "W", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] }], loads: [] });
    const deck = read(writeDeck({ title: "t", mesh, material, applied, analysis: { kind: "static" } }).text);
    expect(deck.find("*CLOAD")).toEqual([]);
    expect(deck.find("*DLOAD")).toEqual([]);
  });
});

describe("writeDeck: a modal run", () => {
  it("*FREQUENCY with the number of modes, mode shapes out, and no loads", () => {
    const mesh = finishMesh(tetBox(2, 1, 1, size, 2), { method: "faces", part });
    const applied = applySetup(mesh, {
      supports: [{ id: "s", name: "W", kind: "fixed", faces: [faceFacing(part, [-1, 0, 0])] }],
      loads: [{ id: "f", name: "F", kind: "force", faces: [faceFacing(part, [1, 0, 0])], force: [0, -1, 0] }, { id: "g", name: "G", kind: "gravity", acceleration: [0, -9.8, 0] }],
    });
    const deck = read(writeDeck({ title: "m", mesh, material, applied, analysis: { kind: "modal", modes: 8 } }).text);
    expect(deck.blocks.map((b) => b.keyword.split(",")[0]).slice(-4)).toEqual(["*STEP", "*FREQUENCY", "*NODE FILE", "*END STEP"]);
    expect(deck.find("*FREQUENCY")[0].data).toEqual(["8"]);
    expect(deck.find("*NODE FILE")[0].data).toEqual(["U"]);
    expect(deck.find("*CLOAD")).toEqual([]);
    expect(deck.find("*DLOAD")).toEqual([]);
    expect(deck.find("*NODE PRINT")).toEqual([]);
  });

  it("at least one mode", () => {
    const mesh = finishMesh(tetBox(1, 1, 1, size, 1), { method: "faces", part });
    const deck = read(writeDeck({ title: "m", mesh, material, applied: { supports: [], nodal: new Map(), loads: [], gravity: null }, analysis: { kind: "modal", modes: 0 } }).text);
    expect(deck.find("*FREQUENCY")[0].data).toEqual(["1"]);
  });
});

describe("writeDeck: sliding supports", () => {
  it("on an axis-aligned face: a plain condition on that axis at each node, no equation", () => {
    const mesh = finishMesh(tetBox(2, 2, 2, size, 2), { method: "faces", part });
    const applied = applySetup(mesh, { supports: [{ id: "s", name: "Floor", kind: "slide", faces: [faceFacing(part, [0, -1, 0])] }], loads: [] });
    const out = writeDeck({ title: "s", mesh, material, applied, analysis: { kind: "static" } });
    const deck = read(out.text);
    expect(deck.find("*EQUATION")).toEqual([]);
    const lines = deck.find("*BOUNDARY")[0].data;
    expect(lines).toEqual(Array.from(applied.supports[0].nodes, (n) => `${n + 1}, 2, 2`));
    expect(out.held).toBe(applied.supports[0].nodes.length);
  });

  it("on a turned face: an equation n·u = 0 a node, its first term the normal's largest part", () => {
    const turn = { axis: [0, 0, 1], angle: 0.4 };
    const tp = partOf(placed(box(...size), turn));
    const parsed = tetBox(2, 2, 2, size, 2);
    const mesh = finishMesh({ ...parsed, nodes: placed(parsed.nodes, turn) }, { method: "angle", part: tp });
    expect(mesh.unplaced).toBe(0);
    const n = turned([1, 0, 0], turn);
    const face = tp.faces.find((f) => f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2] > 0.9999).id;
    const applied = applySetup(mesh, { supports: [{ id: "s", name: "Ramp", kind: "slide", faces: [face] }], loads: [] });
    expect(applied.problems).toEqual([]);
    const normal = applied.supports[0].normal;
    for (let k = 0; k < 3; k++) expect(normal[k]).toBeCloseTo(n[k], 6);
    const out = writeDeck({ title: "s", mesh, material, applied, analysis: { kind: "static" } });
    const deck = read(out.text);
    expect(deck.find("*BOUNDARY")).toEqual([]);
    const eqs = equations(deck.find("*EQUATION")[0]);
    expect(eqs.length).toBe(applied.supports[0].nodes.length);
    const largest = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    eqs.forEach((eq, i) => {
      // cos 0.4 ≈ 0.92 along x, sin 0.4 ≈ 0.39 along y, nothing along z
      expect(eq.terms.length).toBe(2);
      expect(eq.terms.every(([node]) => node === applied.supports[0].nodes[i] + 1)).toBe(true);
      expect(eq.terms[0][1]).toBe(largest + 1);
      for (const [, dof, c] of eq.terms) expect(c).toBeCloseTo(normal[dof - 1], 11);
    });
    expect(out.held).toBe(applied.supports[0].nodes.length);
  });

  it("a face turned off every axis: three terms an equation", () => {
    const turn = { axis: [1, 1, 1].map((v) => v / Math.sqrt(3)), angle: 0.5 };
    const tp = partOf(placed(box(...size), turn));
    const parsed = tetBox(1, 1, 1, size, 1);
    const mesh = finishMesh({ ...parsed, nodes: placed(parsed.nodes, turn) }, { method: "angle", part: tp });
    const n = turned([0, 1, 0], turn);
    const face = tp.faces.find((f) => f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2] > 0.9999).id;
    const applied = applySetup(mesh, { supports: [{ id: "s", name: "Tilt", kind: "slide", faces: [face] }], loads: [] });
    const eqs = equations(read(writeDeck({ title: "s", mesh, material, applied, analysis: { kind: "static" } }).text).find("*EQUATION")[0]);
    const normal = applied.supports[0].normal;
    const first = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))) + 1;
    expect(eqs.length).toBe(4);
    for (const eq of eqs) {
      expect(eq.terms.length).toBe(3);
      expect(eq.terms[0][1]).toBe(first);
      expect(eq.terms.map((t) => t[1]).sort()).toEqual([1, 2, 3]);
      for (const [, dof, c] of eq.terms) expect(c).toBeCloseTo(normal[dof - 1], 11);
    }
  });

  // Hand-made supports on a single node, to see what the deck holds that node to.
  const one = { nodes: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), tets: Uint32Array.from([0, 1, 2, 3]), per: 4 };
  const slide = (id, normal, nodes = [0]) => ({ id, name: id, kind: "slide", nodes: Uint32Array.from(nodes), area: 1, normal });
  const fixed = (id, nodes = [0]) => ({ id, name: id, kind: "fixed", nodes: Uint32Array.from(nodes), area: 1, normal: null });
  const deckOf = (supports) => {
    const out = writeDeck({ title: "h", mesh: one, material, applied: { supports, nodal: new Map(), loads: [], gravity: null }, analysis: { kind: "static" } });
    return { out, deck: read(out.text) };
  };
  const tilted = [0.6, 0.8, 0];

  it("a node on a fixed and a sliding support is fixed, and gets no equation", () => {
    for (const supports of [[fixed("a"), slide("b", tilted)], [slide("b", tilted), fixed("a")]]) {
      const { out, deck } = deckOf(supports);
      expect(deck.find("*EQUATION")).toEqual([]);
      expect(rank(constraintsOn(deck, 1))).toBe(3);
      expect(out.held).toBe(1);
    }
  });

  it("a node on two sliding supports facing different ways: two equations with different first terms", () => {
    const { out, deck } = deckOf([slide("a", tilted), slide("b", [0, 0.6, 0.8])]);
    const eqs = equations(deck.find("*EQUATION")[0]);
    expect(eqs.length).toBe(2);
    expect(eqs[0].terms[0][1]).toBe(2); // 0.8 along y
    expect(eqs[1].terms[0][1]).toBe(3); // y is taken: the next largest, z
    expect(rank(constraintsOn(deck, 1))).toBe(2);
    expect(out.held).toBe(1);
  });

  it("an axis slide and a turned one on one node: both hold, as two plain conditions", () => {
    // with y held, what the turned face [0.6, 0.8, 0] adds is that x is held too: no equation is needed
    const { deck } = deckOf([slide("a", [0, 1, 0]), slide("b", tilted)]);
    expect(deck.find("*BOUNDARY")[0].data).toEqual(["1, 2, 2", "1, 1, 1"]);
    expect(deck.find("*EQUATION")).toEqual([]);
    expect(rank(constraintsOn(deck, 1))).toBe(2);
  });

  // the order the supports come in doesn't matter: each node's directions are reduced together
  it("a turned slide, then an axis slide on the axis its equation took: both hold", () => {
    const { deck } = deckOf([slide("a", tilted), slide("b", [0, 1, 0])]);
    expect(rank(constraintsOn(deck, 1))).toBe(2);
  });

  // the same direction asked twice (two supports on one face) is one condition
  it("the same turned slide twice on a node writes one equation, not two", () => {
    const { deck } = deckOf([slide("a", tilted), slide("b", tilted)]);
    const rows = constraintsOn(deck, 1);
    expect(rows.length).toBe(rank(rows));
  });

  it("held counts each held node once", () => {
    const { out } = deckOf([fixed("a", [0, 1]), fixed("b", [1, 2]), slide("c", [1, 0, 0], [2, 3])]);
    expect(out.held).toBe(4);
  });

  it("each support gets its own node set and reaction print, in order", () => {
    const { out, deck } = deckOf([fixed("a", [0]), slide("b", [1, 0, 0], [1])]);
    expect(out.sets).toEqual([{ id: "a", set: "SUP1" }, { id: "b", set: "SUP2" }]);
    expect(deck.find("*NSET").map((b) => [b.keyword, b.data])).toEqual([["*NSET, NSET=SUP1", ["1"]], ["*NSET, NSET=SUP2", ["2"]]]);
    expect(deck.find("*NODE PRINT").map((b) => b.keyword)).toEqual(["*NODE PRINT, NSET=SUP1, TOTALS=ONLY", "*NODE PRINT, NSET=SUP2, TOTALS=ONLY"]);
    expect(deck.find("*BOUNDARY")[0].data).toEqual(["SUP1, 1, 3", "2, 1, 1"]);
  });
});

describe("writeDeck: numbers", () => {
  it("−0 is written 0, and the longest number fits in 19 characters", () => {
    const mesh = { nodes: Float64Array.from([-0, -1.2345678901234e-100, 1e300, 0, 0, 0, 0, 0, 0, 0, 0, 0]), tets: Uint32Array.from([0, 1, 2, 3]), per: 4 };
    const deck = read(writeDeck({ title: "n", mesh, material, applied: { supports: [], nodal: new Map(), loads: [], gravity: null }, analysis: { kind: "static" } }).text);
    const [, x, y, z] = deck.find("*NODE,")[0].data[0].split(",").map((s) => s.trim());
    expect(x.startsWith("-")).toBe(false);
    expect(Number(x)).toBe(0);
    expect(y.length).toBeLessThanOrEqual(19);
    expect(Number(y)).toBeCloseTo(-1.2345678901234e-100, 110);
    expect(Number(z)).toBe(1e300);
  });
});
