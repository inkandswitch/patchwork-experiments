// What goes into gmsh and what comes out, as text. Pure: the daemon writes
// these files, runs gmsh, and reads its answer back with parseMsh.
//
// The part's surface goes in as a mesh whose triangles carry their face's
// number, and gmsh is asked to build its geometry from exactly those faces
// (CreateTopology, CreateGeometry): every face of the part becomes one gmsh
// surface with the same number, so the volume mesh's skin is split along the
// part's faces by construction, and a load on "face 7" lands on the mesh
// triangles of surface 7, with nothing to match up afterwards.
//
// gmsh can't lay out every face that way (one that closes on itself with no
// edge: a ball, a ring). The second way lets gmsh split the surface as it
// likes (ClassifySurfaces, by angle), and the mesh's skin is matched back to
// the part's faces by position (src/solver/mesh.js, nearestFace).
//
// gmsh works in millimetres here: its tolerances are absolute, and a part a
// few centimetres across in metres sits near them.

export const GMSH_SCALE = 1000;

const f = (x) => (Object.is(x, -0) ? 0 : x).toPrecision(17).replace(/\.?0+(e|$)/, "$1");

/**
 * The part's surface as an MSH 2.2 file: every triangle an element whose
 * entity is its face's number + 1 (gmsh's start at 1).
 * @param {{ positions: Float64Array, tris: Uint32Array, faceOf: Uint32Array }} part
 */
export function surfaceMsh(part, { scale = GMSH_SCALE } = {}) {
  const { positions, tris, faceOf } = part;
  const V = positions.length / 3, T = tris.length / 3;
  const out = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat", "$Nodes", String(V)];
  for (let v = 0; v < V; v++) out.push(`${v + 1} ${f(positions[v * 3] * scale)} ${f(positions[v * 3 + 1] * scale)} ${f(positions[v * 3 + 2] * scale)}`);
  out.push("$EndNodes", "$Elements", String(T));
  for (let t = 0; t < T; t++) {
    const tag = faceOf[t] + 1;
    // no physical group (the 0): with one, gmsh would save only the elements in groups, and the volume is in none
    out.push(`${t + 1} 2 2 0 ${tag} ${tris[t * 3] + 1} ${tris[t * 3 + 1] + 1} ${tris[t * 3 + 2] + 1}`);
  }
  out.push("$EndElements", "");
  return out.join("\n");
}

/**
 * The script gmsh runs.
 * @param {object} o
 * @param {"faces"|"angle"} o.method   the part's own faces, or gmsh's split by angle
 * @param {string} o.input             the surface file (surfaceMsh)
 * @param {string} o.output            the volume mesh to write
 * @param {number} o.size              the element size asked for, in metres
 * @param {number} [o.order]           2: ten-node tetrahedra (the default); 1: four-node
 * @param {{ face: number, size: number }[]} [o.finer]  faces to mesh finer than `size` (round ones: metres)
 * @param {number} [o.sharpDeg]        for "angle": the angle gmsh splits at
 * @param {number} [o.threads]
 */
export function geoScript({ method, input, output, size, order = 2, finer = [], sharpDeg = 30, threads = 1, scale = GMSH_SCALE }) {
  const h = size * scale;
  const lines = [
    "General.Terminal = 1;",
    `General.NumThreads = ${Math.max(1, threads | 0)};`,
    `Merge "${input}";`,
    method === "faces" ? "CreateTopology;" : `ClassifySurfaces{${f((sharpDeg * Math.PI) / 180)}, 1, 1, Pi};`,
    "CreateGeometry;",
    "Surface Loop(1) = Surface{:};",
    "Volume(1) = {1};",
    `Mesh.MeshSizeMax = ${f(h)};`,
    `Mesh.MeshSizeMin = ${f(h / 20)};`,
    "Mesh.MeshSizeFromPoints = 0;",
    "Mesh.MeshSizeFromCurvature = 0;",
    "Mesh.MeshSizeExtendFromBoundary = 1;",
  ];
  // round faces get elements small enough to follow them: within the face its own
  // size, growing back to the general size over a few of its own radii
  const fields = [];
  if (method === "faces")
    finer.forEach(({ face, size: s }, i) => {
      const d = 2 * i + 1, t = 2 * i + 2;
      const small = Math.min(h, s * scale);
      lines.push(
        `Field[${d}] = Distance;`,
        `Field[${d}].SurfacesList = {${face + 1}};`,
        `Field[${d}].Sampling = 40;`,
        `Field[${t}] = Threshold;`,
        `Field[${t}].InField = ${d};`,
        `Field[${t}].SizeMin = ${f(small)};`,
        `Field[${t}].SizeMax = ${f(h)};`,
        `Field[${t}].DistMin = ${f(small)};`,
        `Field[${t}].DistMax = ${f(small + 3 * (h - small))};`,
      );
      fields.push(t);
    });
  if (fields.length) {
    const m = 2 * finer.length + 1;
    lines.push(`Field[${m}] = Min;`, `Field[${m}].FieldsList = {${fields.join(", ")}};`, `Background Field = ${m};`);
  }
  lines.push(
    "Mesh.Algorithm = 6;", // frontal-Delaunay on surfaces
    "Mesh.Algorithm3D = 1;", // Delaunay in the volume
    "Mesh.Optimize = 1;",
    "Mesh.OptimizeNetgen = 1;",
    `Mesh.ElementOrder = ${order === 1 ? 1 : 2};`,
    // straight-sided: the part is facets, so there is no curve to bend an edge to, and a straight
    // ten-node tetrahedron is never inside out
    "Mesh.SecondOrderLinear = 1;",
    "Mesh.HighOrderOptimize = 0;",
    "Mesh.MshFileVersion = 2.2;",
    "Mesh.Binary = 0;",
    "Mesh 3;",
    `Save "${output}";`,
    "",
  );
  return lines.join("\n");
}

/** gmsh's element type numbers that matter here → nodes each. */
const NODES_OF = { 2: 3, 9: 6, 4: 4, 11: 10 };

/**
 * A gmsh MSH 2.2 text file → the volume mesh and gmsh's own skin of it.
 * Nodes are renumbered 0…n−1 in the order tetrahedra first use them, corners
 * first, so nodes no tetrahedron uses are gone; coordinates come back in
 * metres.
 * @returns {{
 *   order: 1|2,
 *   nodes: Float64Array,          // xyz
 *   tets: Uint32Array,            // 4 or 10 a tetrahedron, in gmsh's node order
 *   skin: Uint32Array,            // gmsh's surface triangles: 3 corners each
 *   skinSurface: Int32Array }}    // and the gmsh surface each is on
 */
export function parseMsh(text, { scale = GMSH_SCALE } = {}) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const seek = (tag) => {
    while (i < lines.length && lines[i].trim() !== tag) i++;
    if (i >= lines.length) throw new Error(`the mesh file has no ${tag}`);
    i++;
  };
  seek("$MeshFormat");
  const version = lines[i].trim().split(/\s+/);
  if (!version[0]?.startsWith("2.") || version[1] !== "0") throw new Error(`a text MSH 2 file was expected, not "${lines[i].trim()}"`);
  seek("$Nodes");
  const count = Number(lines[i++]);
  const idAt = new Map();
  const xyz = new Float64Array(count * 3);
  for (let n = 0; n < count; n++) {
    const p = lines[i++].trim().split(/\s+/);
    idAt.set(Number(p[0]), n);
    xyz[n * 3] = Number(p[1]) / scale;
    xyz[n * 3 + 1] = Number(p[2]) / scale;
    xyz[n * 3 + 2] = Number(p[3]) / scale;
  }
  seek("$Elements");
  const elements = Number(lines[i++]);
  const tetNodes = [];
  const triNodes = [];
  const triSurface = [];
  let order = 0;
  for (let e = 0; e < elements; e++) {
    const p = lines[i++].trim().split(/\s+/);
    const type = Number(p[1]);
    const per = NODES_OF[type];
    if (!per) continue;
    const tags = Number(p[2]);
    const at = 3 + tags;
    if (type === 4 || type === 11) {
      const o = type === 4 ? 1 : 2;
      if (order && order !== o) throw new Error("the mesh mixes four- and ten-node tetrahedra");
      order = o;
      for (let k = 0; k < per; k++) tetNodes.push(Number(p[at + k]));
    } else {
      for (let k = 0; k < 3; k++) triNodes.push(Number(p[at + k]));
      triSurface.push(Number(p[4])); // the entity it is on
    }
  }
  if (!order) throw new Error("gmsh made no volume mesh");
  const per = order === 1 ? 4 : 10;
  // renumber by use: every tetrahedron's corners, then the mid-edge nodes
  const newOf = new Int32Array(count).fill(-1);
  let used = 0;
  const take = (id) => {
    const old = idAt.get(id);
    if (old === undefined) throw new Error(`an element names node ${id}, which the file doesn't have`);
    if (newOf[old] < 0) newOf[old] = used++;
    return newOf[old];
  };
  const tets = new Uint32Array(tetNodes.length);
  for (let t = 0; t < tetNodes.length; t += per) for (let k = 0; k < 4; k++) tets[t + k] = take(tetNodes[t + k]);
  for (let t = 0; t < tetNodes.length; t += per) for (let k = 4; k < per; k++) tets[t + k] = take(tetNodes[t + k]);
  const nodes = new Float64Array(used * 3);
  for (let old = 0; old < count; old++) {
    const n = newOf[old];
    if (n < 0) continue;
    nodes[n * 3] = xyz[old * 3];
    nodes[n * 3 + 1] = xyz[old * 3 + 1];
    nodes[n * 3 + 2] = xyz[old * 3 + 2];
  }
  const skin = [];
  const skinSurface = [];
  for (let t = 0; t < triNodes.length; t += 3) {
    const a = newOf[idAt.get(triNodes[t]) ?? -1], b = newOf[idAt.get(triNodes[t + 1]) ?? -1], c = newOf[idAt.get(triNodes[t + 2]) ?? -1];
    // a surface triangle no tetrahedron touches isn't the solid's skin
    if (!(a >= 0 && b >= 0 && c >= 0)) continue;
    skin.push(a, b, c);
    skinSurface.push(triSurface[t / 3]);
  }
  return { order, nodes, tets, skin: Uint32Array.from(skin), skinSurface: Int32Array.from(skinSurface) };
}
