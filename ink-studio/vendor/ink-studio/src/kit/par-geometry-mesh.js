/* Geometry adapters around Ink's construction, transforms and clipping. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, G = P.geometry, T = P.transforms;
  const { integer, range, vector, color, indexed, fromStream, toStream } = P.sceneGraphSupport;

  function box({ center = [0, 0, 0], half = [.5, .5, .5], color: tint = '#b7bccb' } = {}) {
    if (!vector(center, 3) || !vector(half, 3) || half.some(n => n <= 0)) throw new RangeError('Box needs a center and positive half sizes');
    return G.toKitMesh(P.pieces.box(center, half, K.M.id()).mesh, () => color(tint));
  }

  function tube(start, end, { radius = .2, sides = 12, color: tint = '#b7bccb' } = {}) {
    if (!vector(start, 3) || !vector(end, 3) || K.V.dist(start, end) < 1e-7 || !range(radius, 1e-6, 1e4) || !integer(sides, 3, 32))
      throw new RangeError('Tube needs distinct endpoints, a positive radius and 3 to 32 sides');
    return G.toKitMesh(P.pieces.tube(start, end, radius, {}, sides).mesh, () => color(tint));
  }

  function triangulate(rings, { z = 0, color: tint = '#b7bccb' } = {}) {
    if (!range(z, -1e6, 1e6)) throw new RangeError('Invalid triangulation Z coordinate');
    const { points, triangles } = G.triangulatePolygon(rings);
    return indexed({ points: points.map(p => [...p, z]), faces: triangles, mats: [{ name: 'surface', rgb: color(tint) }] });
  }

  function transform(source, options = {}) {
    const mesh = indexed(source), pose = T.local(options), det = K.M.det(pose.R);
    if (!Number.isFinite(det) || !det) throw new RangeError('Mesh transform must be invertible');
    const point = (data, fn) => {
      for (let i = 0; i < data.length; i += 3) {
        const p = fn(pose, data.subarray(i, i + 3));
        if (!vector(p, 3)) throw new RangeError('Mesh transform exceeds the coordinate budget');
        data.set(p, i);
      }
    };
    point(mesh.pos, T.point);
    if (mesh.normals) point(mesh.normals, (pose, n) => K.V.len(n) > 1e-9 ? T.normal(pose, n) : [0, 0, 0]);
    if (det < 0) for (let i = 0; i < mesh.tri.length; i += 3)
      [mesh.tri[i + 1], mesh.tri[i + 2]] = [mesh.tri[i + 2], mesh.tri[i + 1]];
    return mesh;
  }

  function merge(sources) {
    if (!Array.isArray(sources) || !integer(sources.length, 1, 64)) throw new RangeError('Mesh merge expects 1 to 64 meshes');
    const pos = [], tri = [], colors = [], mats = [], tmat = [], uvs = [], normals = [];
    let hasUV = false, hasNormals = false, hasVertexColor = false, vertices = 0;
    for (const source of sources) {
      const mesh = indexed(source), size = mesh.pos.length / 3;
      if (vertices + size > 250000 || tri.length + mesh.tri.length > 1500000 || mats.length + mesh.mats.length > 65535)
        throw new RangeError('Merged mesh exceeds the geometry budget');
      for (const p of mesh.pos) pos.push(p);
      for (const i of mesh.tri) tri.push(i + vertices);
      for (const m of mesh.tmat) tmat.push(m + mats.length);
      for (const material of mesh.mats) mats.push(material);
      if (mesh.uvs) hasUV = true;
      if (mesh.normals) hasNormals = true;
      if (mesh.vcol) hasVertexColor = true;
      for (let i = 0; i < size; i++) {
        uvs.push(mesh.uvs?.[i * 2] ?? 0, mesh.uvs?.[i * 2 + 1] ?? 0);
        for (let axis = 0; axis < 3; axis++) {
          normals.push(mesh.normals?.[i * 3 + axis] ?? 0);
          colors.push(mesh.vcol?.[i * 3 + axis] ?? 0);
        }
      }
      vertices += size;
    }
    // Vertex colors take precedence over face materials in native mesh shading.
    if (hasVertexColor && sources.some(source => !source.vcol))
      throw new TypeError('Merged meshes need either vertex colors on all inputs or face materials on all inputs');
    const result = K.mesh.make(pos, tri, hasVertexColor ? colors : null, tmat, mats);
    if (hasUV) result.uvs = Float32Array.from(uvs);
    if (hasNormals) result.normals = Float32Array.from(normals);
    return result;
  }

  function clip(source, planes, { cap = false, capColor = '#aa7b60' } = {}) {
    if (typeof cap !== 'boolean' || !Array.isArray(planes) || !integer(planes.length, 1, 32) ||
        !Array.from(planes).every(plane => vector(plane?.normal, 3) && K.V.len(plane.normal) > 1e-7 && Number.isFinite(plane.offset)))
      throw new RangeError('Clipping needs planes with finite normals and offsets');
    const mesh = indexed(source);
    if (mesh.vcol) throw new TypeError('Clipping requires mesh face materials');
    const stream = toStream(mesh);
    if (cap && mesh.mats.length === 65535) throw new RangeError('Convex cap exceeds the material budget');
    const material = String(mesh.mats.length);
    const result = cap ? G.clipConvex(stream, planes, { material }) : G.clipSurface(stream, planes);
    return fromStream(result, cap ? [...mesh.mats, { name: 'cap', rgb: color(capColor) }] : mesh.mats);
  }

  Object.assign(A, { mesh: indexed, box, tube, triangulate, transform, merge, clip });
})(KIT);
