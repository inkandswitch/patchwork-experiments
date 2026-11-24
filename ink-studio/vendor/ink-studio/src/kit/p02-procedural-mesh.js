/* Triangle geometry with optional owner, material and UV metadata. */
(function (K) {
  const A = K.procedural,
    { clone, freeze } = A.data,
    V = K.V,
    M = K.M;
  const EPS = 1e-8,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const { local, point, normal } = A.transforms;
  function builder() {
    const positions = [],
      normals = [],
      uv = [],
      groups = [];
    function triangle(a, b, c, meta, coords, ns) {
      if (
        ![a, b, c].every(vector) ||
        (ns && (!Array.isArray(ns) || ns.length !== 3 || !ns.every(vector))) ||
        (coords &&
          (!Array.isArray(coords) ||
            coords.length !== 3 ||
            !coords.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))))
      ) {
        throw new Error('Geometry vertices and attributes must be finite');
      }
      const cross = V.cross(V.sub(b, a), V.sub(c, a));
      if (V.len(cross) < EPS * EPS) return;
      const n = V.norm(cross),
        info = Object.assign({ owner: '', surface: '', material: 'default' }, meta),
        start = positions.length / 3;
      for (const [i, p] of [a, b, c].entries()) {
        positions.push(...p);
        normals.push(...(ns ? ns[i] : n));
        uv.push(...(coords ? coords[i] : [0, 0]));
      }
      const last = groups[groups.length - 1];
      if (
        last &&
        last.owner === info.owner &&
        last.surface === info.surface &&
        last.material === info.material &&
        last.start + last.count === start
      )
        last.count += 3;
      else groups.push(Object.assign(info, { start, count: 3 }));
    }
    function quad(a, b, c, d, meta, coords, ns) {
      const u = coords || [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0]
      ];
      triangle(a, b, c, meta, [u[0], u[1], u[2]], ns && [ns[0], ns[1], ns[2]]);
      triangle(a, c, d, meta, [u[0], u[2], u[3]], ns && [ns[0], ns[2], ns[3]]);
    }
    function append(mesh, pose) {
      const p = pose || local(),
        mirrored = M.det(p.R) < 0;
      for (const g of mesh.groups)
        for (let i = g.start; i < g.start + g.count; i += 3) {
          const order = mirrored ? [i, i + 2, i + 1] : [i, i + 1, i + 2];
          const ps = order.map(j => point(p, Array.from(mesh.positions.slice(j * 3, j * 3 + 3)))),
            ns = order.map(j => normal(p, Array.from(mesh.normals.slice(j * 3, j * 3 + 3)))),
            coords = order.map(j => Array.from(mesh.uv.slice(j * 2, j * 2 + 2)));
          triangle(...ps, g, coords, ns);
        }
    }
    function finish() {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.length; i++) {
        const k = i % 3;
        min[k] = Math.min(min[k], positions[i]);
        max[k] = Math.max(max[k], positions[i]);
      }
      return {
        positions: Float32Array.from(positions),
        normals: Float32Array.from(normals),
        uv: Float32Array.from(uv),
        groups: freeze(clone(groups)),
        bounds: positions.length ? { min, max } : null
      };
    }
    return { triangle, quad, append, finish };
  }
  function toKitMesh(mesh, resolveMaterial) {
    if (typeof resolveMaterial !== 'function') throw new Error('A material resolver is required');
    const positions = [],
      triangles = [],
      tmat = [],
      mats = [],
      vertices = new Map(),
      materials = new Map();
    for (const g of mesh.groups) {
      const key = JSON.stringify([g.owner, g.material]);
      if (!materials.has(key)) {
        const color = resolveMaterial(g.owner, g.material);
        if (!vector(color) || color.some(v => v < 0 || v > 1))
          throw new Error('Material resolver must return normalized RGB');
        materials.set(key, mats.length);
        mats.push({ name: key, rgb: color.slice() });
      }
      for (let i = g.start; i < g.start + g.count; i++) {
        const p = Array.from(mesh.positions.slice(i * 3, i * 3 + 3)),
          vkey = p.join(',');
        if (!vertices.has(vkey)) {
          vertices.set(vkey, positions.length / 3);
          positions.push(...p);
        }
        triangles.push(vertices.get(vkey));
        if ((i - g.start) % 3 === 0) tmat.push(materials.get(key));
      }
    }
    return K.mesh.make(positions, triangles, null, tmat, mats);
  }
  A.geometry = { builder, toKitMesh };
})(KIT);
