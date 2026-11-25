import { readFileSync } from "node:fs";
import { surfaceMsh, geoScript, parseMsh, GMSH_SCALE } from "./gmsh.js";
import { readPart } from "../part/faces.js";
import { box, plateWithHole } from "../test/shapes.js";

const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8");

describe("surfaceMsh", () => {
  const part = readPart(plateWithHole(0.1, 0.06, 0.005, 0.01, 16));
  const text = surfaceMsh(part);
  const lines = text.split("\n");
  const section = (tag) => lines.slice(lines.indexOf(`$${tag}`) + 1, lines.indexOf(`$End${tag}`));

  it("is a text MSH 2.2 file", () => {
    expect(section("MeshFormat")).toEqual(["2.2 0 8"]);
    expect(text.endsWith("$EndElements\n")).toBe(true);
  });

  it("one node a vertex, numbered from 1, in millimetres", () => {
    const nodes = section("Nodes");
    const V = part.positions.length / 3;
    expect(Number(nodes[0])).toBe(V);
    expect(nodes.length).toBe(V + 1);
    nodes.slice(1).forEach((line, v) => {
      const p = line.split(" ").map(Number);
      expect(p[0]).toBe(v + 1);
      for (let k = 0; k < 3; k++) expect(p[1 + k]).toBe(part.positions[v * 3 + k] * GMSH_SCALE);
    });
  });

  it("one triangle element a triangle: no physical group, its entity its face's number + 1", () => {
    const elements = section("Elements");
    const T = part.tris.length / 3;
    expect(Number(elements[0])).toBe(T);
    expect(elements.length).toBe(T + 1);
    elements.slice(1).forEach((line, t) => {
      const p = line.split(" ").map(Number);
      expect(p).toEqual([t + 1, 2, 2, 0, part.faceOf[t] + 1, part.tris[t * 3] + 1, part.tris[t * 3 + 1] + 1, part.tris[t * 3 + 2] + 1]);
    });
  });

  it("writes numbers in full, without trailing zeros, and −0 as 0", () => {
    const t = surfaceMsh({ positions: Float64Array.from([-0, 0.1, 1 / 3]), tris: new Uint32Array(0), faceOf: new Uint32Array(0) }, { scale: 1 });
    const node = t.split("\n")[5].split(" ");
    expect(node[1]).toBe("0");
    expect(node[2]).toBe("0.10000000000000001");
    expect(Number(node[3])).toBe(1 / 3);
  });

  it("reads back through parseMsh's node reader to the same metres", () => {
    // parseMsh wants a volume; give the surface a tetrahedron of its own first four nodes
    const p = readPart(box(0.1, 0.02, 0.03));
    const withTet = surfaceMsh(p).replace(/\$Elements\n(\d+)\n/, (_, n) => `$Elements\n${Number(n) + 1}\n999 4 2 0 1 1 2 3 5\n`);
    const parsed = parseMsh(withTet);
    expect(parsed.order).toBe(1);
    // the tetrahedron's nodes 1 2 3 5 are the part's vertices 0 1 2 4, now 0 1 2 3
    [0, 1, 2, 4].forEach((v, n) => {
      for (let k = 0; k < 3; k++) expect(Math.abs(parsed.nodes[n * 3 + k] - p.positions[v * 3 + k])).toBeLessThan(1e-17);
    });
    // the part's surface triangles among those four nodes come back as skin, on their faces
    expect(parsed.skin.length / 3).toBe(2);
    for (let s = 0; s < parsed.skin.length / 3; s++) {
      const t = [...parsed.skin.subarray(s * 3, s * 3 + 3)].map((n) => [0, 1, 2, 4][n]);
      const i = [...Array(p.tris.length / 3).keys()].find((u) => [0, 1, 2].every((k) => p.tris[u * 3 + k] === t[k]));
      expect(parsed.skinSurface[s]).toBe(p.faceOf[i] + 1);
    }
  });
});

describe("parseMsh", () => {
  const parsed = parseMsh(fixture("one-tet.msh"));

  it("a ten-node tetrahedron: order 2, the stray node gone", () => {
    expect(parsed.order).toBe(2);
    expect(parsed.nodes.length / 3).toBe(10);
  });

  it("renumbers by use, corners first, and keeps gmsh's node order in the tetrahedron", () => {
    expect(Array.from(parsed.tets)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("converts millimetres to metres", () => {
    const want = [
      [0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10], // corners 10 20 30 40
      [5, 0, 0], [5, 5, 0], [0, 5, 0], [0, 0, 5], [0, 5, 5], [5, 0, 5], // mid nodes 50 … 100
    ];
    want.forEach((p, n) => p.forEach((v, k) => expect(parsed.nodes[n * 3 + k]).toBe(v / 1000)));
  });

  it("returns the skin's corners and the surface each is on; lines are ignored", () => {
    expect(Array.from(parsed.skin)).toEqual([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    expect(Array.from(parsed.skinSurface)).toEqual([1, 2, 3, 4]);
    expect(parsed.skin).toBeInstanceOf(Uint32Array);
    expect(parsed.skinSurface).toBeInstanceOf(Int32Array);
  });

  it("reads Windows line endings and a scale of its own", () => {
    const p = parseMsh(fixture("one-tet.msh").replace(/\n/g, "\r\n"), { scale: 1 });
    expect(p.nodes[3]).toBe(10);
  });

  it("drops a surface triangle no tetrahedron touches", () => {
    const text = fixture("one-tet.msh").replace("$Elements\n6\n", "$Elements\n7\n7 2 2 0 9 5 10 20\n");
    const p = parseMsh(text);
    expect(Array.from(p.skinSurface)).toEqual([1, 2, 3, 4]);
  });

  it("errors for a file with no tetrahedra", () => {
    const text = fixture("one-tet.msh").replace("$Elements\n6\n", "$Elements\n5\n").replace(/^6 11 .*\n/m, "");
    expect(() => parseMsh(text)).toThrow("gmsh made no volume mesh");
  });

  it("errors for a format other than text MSH 2", () => {
    expect(() => parseMsh(fixture("one-tet.msh").replace("2.2 0 8", "4.1 0 8"))).toThrow(/a text MSH 2 file was expected, not "4.1 0 8"/);
    expect(() => parseMsh(fixture("one-tet.msh").replace("2.2 0 8", "2.2 1 8"))).toThrow(/text MSH 2/);
  });

  it("errors for a missing section, a node an element names that isn't there, and mixed orders", () => {
    expect(() => parseMsh("hello")).toThrow(/no \$MeshFormat/);
    expect(() => parseMsh(fixture("one-tet.msh").replace("6 11 2 0 1 10 20", "6 11 2 0 1 11 20"))).toThrow(/node 11/);
    const mixed = fixture("one-tet.msh").replace("$Elements\n6\n", "$Elements\n7\n7 4 2 0 1 10 20 30 40\n");
    expect(() => parseMsh(mixed)).toThrow(/mixes/);
  });

  it("a four-node tetrahedron: order 1", () => {
    const text = fixture("one-tet.msh").replace("6 11 2 0 1 10 20 30 40 50 60 70 80 90 100", "6 4 2 0 1 10 20 30 40");
    const p = parseMsh(text);
    expect(p.order).toBe(1);
    expect(Array.from(p.tets)).toEqual([0, 1, 2, 3]);
    expect(p.nodes.length / 3).toBe(4);
  });
});

describe("geoScript", () => {
  const finer = [{ face: 3, size: 0.0005 }, { face: 7, size: 0.004 }];
  const base = { input: "surface.msh", output: "volume.msh", size: 0.002, finer };

  it("'faces' builds on the part's own faces, with a field for each finer face and the Min of them as background", () => {
    const s = geoScript({ ...base, method: "faces" }).split("\n");
    expect(s).toContain("CreateTopology;");
    expect(s.some((l) => l.startsWith("ClassifySurfaces"))).toBe(false);
    expect(s).toContain('Merge "surface.msh";');
    expect(s).toContain('Save "volume.msh";');
    expect(s).toContain("Field[1] = Distance;");
    expect(s).toContain("Field[1].SurfacesList = {4};");
    expect(s).toContain("Field[2] = Threshold;");
    expect(s).toContain("Field[2].InField = 1;");
    expect(s).toContain("Field[3] = Distance;");
    expect(s).toContain("Field[3].SurfacesList = {8};");
    expect(s).toContain("Field[4].InField = 3;");
    expect(s).toContain("Field[5] = Min;");
    expect(s).toContain("Field[5].FieldsList = {2, 4};");
    expect(s).toContain("Background Field = 5;");
    // the order the lines must come in: the geometry before the mesh, the fields before Mesh 3
    expect(s.indexOf("CreateTopology;")).toBeLessThan(s.indexOf("CreateGeometry;"));
    expect(s.indexOf("Background Field = 5;")).toBeLessThan(s.indexOf("Mesh 3;"));
    expect(s.indexOf("Mesh 3;")).toBeLessThan(s.indexOf('Save "volume.msh";'));
  });

  it("sizes are in millimetres; a finer face is never coarser than the general size", () => {
    const s = geoScript({ ...base, method: "faces" }).split("\n");
    const value = (prefix) => Number(s.find((l) => l.startsWith(prefix)).split("=")[1].replace(";", ""));
    expect(value("Mesh.MeshSizeMax")).toBeCloseTo(2, 12);
    expect(value("Mesh.MeshSizeMin")).toBeCloseTo(0.1, 12);
    expect(value("Field[2].SizeMin")).toBeCloseTo(0.5, 12);
    expect(value("Field[2].SizeMax")).toBeCloseTo(2, 12);
    expect(value("Field[2].DistMin")).toBeCloseTo(0.5, 12);
    expect(value("Field[2].DistMax")).toBeCloseTo(0.5 + 3 * 1.5, 12);
    // asked for 4 mm on a 2 mm mesh: 2 mm it is, and the threshold has no width
    expect(value("Field[4].SizeMin")).toBeCloseTo(2, 12);
    expect(value("Field[4].DistMax")).toBeCloseTo(2, 12);
  });

  it("'angle' lets gmsh split by angle, and adds no fields", () => {
    const text = geoScript({ ...base, method: "angle", sharpDeg: 40 });
    const s = text.split("\n");
    expect(s).not.toContain("CreateTopology;");
    const classify = s.find((l) => l.startsWith("ClassifySurfaces{"));
    expect(Number(classify.match(/\{([^,]+),/)[1])).toBeCloseTo((40 * Math.PI) / 180, 15);
    expect(classify.endsWith(", 1, 1, Pi};")).toBe(true);
    expect(text).not.toMatch(/Field/);
  });

  it("no finer faces: no fields", () => {
    expect(geoScript({ ...base, finer: [], method: "faces" })).not.toMatch(/Field/);
  });

  it("order 2 by default, 1 when asked; straight-sided; text MSH 2.2 out; threads at least 1", () => {
    const two = geoScript({ ...base, method: "faces" }).split("\n");
    expect(two).toContain("Mesh.ElementOrder = 2;");
    expect(two).toContain("Mesh.SecondOrderLinear = 1;");
    expect(two).toContain("Mesh.MshFileVersion = 2.2;");
    expect(two).toContain("Mesh.Binary = 0;");
    expect(two).toContain("General.NumThreads = 1;");
    const one = geoScript({ ...base, method: "faces", order: 1, threads: 8 }).split("\n");
    expect(one).toContain("Mesh.ElementOrder = 1;");
    expect(one).toContain("General.NumThreads = 8;");
    expect(geoScript({ ...base, method: "faces", threads: 0 })).toMatch(/General.NumThreads = 1;/);
  });
});
