/* Shared headless 3D graph contracts and native indexed-mesh adapters. */
(function (K) {
  const P = K.procedural, G = P.geometry, M = K.mesh;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const coordinate = n => range(n, -1e6, 1e6);
  const vector = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(coordinate);
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && typeof value.length === 'number';
  const record = P.graphTypes.validator('record');

  function color(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      const rgb = parseInt(value.slice(1), 16);
      return [rgb >> 16, rgb >> 8 & 255, rgb & 255].map(n => n / 255);
    }
    if (vector(value, 3) && value.every(n => range(n, 0, 1))) return value.slice();
    throw new TypeError('Expected an RGB color in #rrggbb or normalized channels');
  }

  function packed(rgb) {
    return rgb.reduce((n, channel) => n * 256 + Math.round(channel * 255), 0);
  }

  function bounds(value) {
    if (!vector(value?.min, 3) || !vector(value?.max, 3) || value.min.some((n, i) => n >= value.max[i]))
      throw new RangeError('Expected finite increasing XYZ bounds');
    return { min: value.min.slice(), max: value.max.slice() };
  }

  function pixels(width, height, max = 1048576) {
    if (!integer(width, 1, 4096) || !integer(height, 1, 4096) || width * height > max)
      throw new RangeError('3D graph image exceeds its pixel budget');
    return width * height;
  }

  function indexed(source) {
    const { points, faces } = G.topology(source);
    if (!faces.length || faces.some(face => face.length !== 3) || !points.every(p => vector(p, 3)))
      throw new RangeError('Expected finite XYZ triangle geometry');
    const { vcol, tmat, mats, uvs, normals } = source;
    const channel = (value, length, validate) => value == null ||
      list(value) && value.length === length && Array.from(value).every(validate);
    const materials = mats ?? [{ name: 'default', rgb: [.7, .7, .7] }];
    if (!Array.isArray(materials) || !integer(materials.length, 1, 65535) ||
        !Array.from(materials).every(m => typeof m?.name === 'string') ||
        !channel(tmat, faces.length, n => integer(n, 0, materials.length - 1)) ||
        !channel(vcol, points.length * 3, n => range(n, 0, 1)) ||
        !channel(uvs, points.length * 2, coordinate) || !channel(normals, points.length * 3, coordinate))
      throw new RangeError('Invalid mesh material, color, normal or UV buffer');
    const mesh = M.make(points.flat(), faces.flatMap(face => Array.from(face)), vcol, tmat,
      materials.map(({ name, rgb }) => ({ name, rgb: color(rgb) })));
    if (uvs) mesh.uvs = Float32Array.from(uvs);
    if (normals) mesh.normals = Float32Array.from(normals);
    return mesh;
  }

  function fromStream(stream, materials) {
    if (!stream.positions.length) throw new RangeError('Geometry has no triangles');
    const indices = Uint32Array.from({ length: stream.positions.length / 3 }, (_, i) => i);
    const tmat = new Uint16Array(indices.length / 3);
    for (const group of stream.groups) tmat.fill(Number(group.material) || 0, group.start / 3, (group.start + group.count) / 3);
    const mesh = M.make(stream.positions, indices, null, tmat, materials);
    mesh.uvs = stream.uv;
    mesh.normals = stream.normals;
    return mesh;
  }

  function toStream(mesh) {
    const out = G.builder(), { pos, tri, uvs, normals, tmat } = mesh;
    const tuple = (values, i, n) => Array.from(values.subarray(i * n, i * n + n));
    for (let i = 0; i < tri.length; i += 3) {
      const ids = [tri[i], tri[i + 1], tri[i + 2]], points = ids.map(j => tuple(pos, j, 3));
      out.triangle(...points, { material: String(tmat[i / 3]) },
        uvs && ids.map(j => tuple(uvs, j, 2)), normals && ids.map(j => tuple(normals, j, 3)));
    }
    return out.finish();
  }

  P.sceneGraph = {};
  P.sceneGraphSupport = { integer, range, coordinate, vector, list, record, color, packed, bounds, pixels, indexed, fromStream, toStream };
})(KIT);
