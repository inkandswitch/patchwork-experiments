/* Exposed voxel boundaries from raster silhouettes and ordered slices. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, R = P.raster;
  const { integer, vector, range, color } = P.sceneGraphSupport;
  const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const corners = [
    [1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]
  ];
  const bits = i => [i & 1, i >> 1 & 1, i >> 2 & 1];
  const octants = Array.from({ length: 8 }, (_, i) => bits(i));
  const orient = {
    z: ([x, y, z]) => [x, y, z],
    x: ([x, y, z]) => [z, y, -x],
    y: ([x, y, z]) => [x, z, -y]
  };

  // Incident cells that meet only at an edge or corner need separate vertices.
  const fans = Array.from({ length: 256 }, (_, mask) => {
    const groups = Array(8).fill(-1);
    for (let start = 0; start < 8; start++) {
      if (!(mask & (1 << start)) || groups[start] !== -1) continue;
      const queue = [start];
      groups[start] = start;
      for (const cell of queue) for (const adjacency of [1, 2, 4]) {
        const next = cell ^ adjacency;
        if (mask & (1 << next) && groups[next] === -1) {
          groups[next] = start;
          queue.push(next);
        }
      }
    }
    return groups;
  });

  function meshVolume(slices, { pixelSize = .05, spacing = typeof pixelSize === 'number' ? pixelSize : pixelSize?.[0], center = [0, 0, 0], axis = 'z', alphaThreshold = 128,
    channel = 'alpha', edgeColor, extrude = false } = {}) {
    const { width, height } = slices?.[0] ?? {}, count = slices?.length;
    const size = typeof pixelSize === 'number' ? [pixelSize, pixelSize] : pixelSize;
    const valid = P.graphTypes.validator('raster');
    if (!Array.isArray(slices) || !integer(count, 1, 256) || !integer(width, 1, 1024) || !integer(height, 1, 1024) ||
        width * height * count > 131072 || !Array.from(slices).every(image => image?.width === width && image?.height === height && valid(image)) ||
        !vector(size, 2) || size.some(n => !range(n, 1e-5, 1e3)) || !range(spacing, 1e-5, 1e3) || !vector(center, 3) ||
        !Object.hasOwn(orient, axis) || !integer(alphaThreshold, 1, 255))
      throw new RangeError('Slice mesh needs aligned rasters within its voxel budget, positive spacing and a valid axis');
    const pixels = slices.map(R.rgba), masks = slices.map(slice => R.channel(slice, { channel }).data);
    const at = (x, y) => (height - 1 - y) * width + x;
    const filled = (x, y, z) => x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < count &&
      masks[z][at(x, y)] >= alphaThreshold;
    const pos = [], uv = [], tri = [], front = [], tmat = [], frontMaterials = [], materials = [], faces = new Map();
    const vertexMap = new Map(), cache = new Map();
    const edge = edgeColor === undefined ? null : color(edgeColor);
    const rgbMaterial = rgb => {
      const key = rgb.map(n => Math.round(n * 255)).join(',');
      if (!faces.has(key)) {
        if (materials.length >= 65535) throw new RangeError('Slice mesh exceeds 65,535 materials');
        faces.set(key, materials.length);
        materials.push({ name: 'cell-' + key, rgb });
      }
      return faces.get(key);
    };
    function vertex(x, y, z, corner) {
      const [dx, dy, dz] = octants[corner], a = x + dx, b = y + dy, c = z + dz;
      const cornerKey = (c * (height + 1) + b) * (width + 1) + a;
      let groupMask = cache.get(cornerKey);
      if (groupMask === undefined) {
        groupMask = 0;
        for (const [i, [u, v, w]] of octants.entries()) if (filled(a - u, b - v, c - w)) groupMask |= 1 << i;
        cache.set(cornerKey, groupMask);
      }
      const key = cornerKey * 8 + fans[groupMask][corner];
      if (!vertexMap.has(key)) {
        if (pos.length >= 750000) throw new RangeError('Slice mesh exceeds the vertex budget');
        vertexMap.set(key, pos.length / 3);
        const local = [(a - width / 2) * size[0], (b - height / 2) * size[1], (c - count / 2) * spacing];
        const point = orient[axis](local).map((n, i) => n + center[i]);
        if (!vector(point, 3)) throw new RangeError('Slice geometry exceeds the coordinate budget');
        pos.push(...point);
        uv.push(a / width, 1 - b / height);
      }
      return vertexMap.get(key);
    }
    let solid = 0;
    for (let z = 0; z < count; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!filled(x, y, z)) continue;
      solid++;
      const i = at(x, y) * 4, rgb = Array.from(pixels[z].data.subarray(i, i + 3), n => n / 255);
      for (const [side, [dx, dy, dz]] of offsets.entries()) {
        if (filled(x + dx, y + dy, z + dz)) continue;
        if (tri.length >= 1500000) throw new RangeError('Slice mesh exceeds the triangle budget');
        const [a, b, c, d] = corners[side].map(corner => vertex(x, y, z, corner));
        const mat = rgbMaterial(edge && side < 4 ? edge : rgb);
        tri.push(a, b, c, a, c, d);
        tmat.push(mat, mat);
        if (extrude && side === 4) {
          front.push(a, b, c, a, c, d);
          frontMaterials.push(mat, mat);
        }
      }
    }
    if (!solid) throw new RangeError('No raster cells meet the slice threshold');
    const mesh = K.mesh.make(pos, tri, null, tmat, materials);
    mesh.uvs = Float32Array.from(uv);
    const report = { solid, slices: count, vertices: pos.length / 3, triangles: tri.length / 3, axis };
    const { lo, hi } = K.mesh.box(mesh);
    const result = { value: mesh, bounds: { min: lo, max: hi }, report };
    if (extrude) {
      const frontPositions = [], frontUV = [], vertices = new Map();
      const frontIndices = front.map(id => {
        if (!vertices.has(id)) {
          vertices.set(id, vertices.size);
          frontPositions.push(...mesh.pos.subarray(id * 3, id * 3 + 3));
          frontUV.push(...mesh.uvs.subarray(id * 2, id * 2 + 2));
        }
        return vertices.get(id);
      });
      result.front = K.mesh.make(frontPositions, frontIndices, null, frontMaterials, materials);
      result.front.uvs = Float32Array.from(frontUV);
    }
    return result;
  }

  function extrudeImage(source, { depth = .24, ...options } = {}) {
    return meshVolume([source], { ...options, spacing: depth, axis: 'z', extrude: true });
  }

  function sliceStack(slices, options) {
    return meshVolume(slices, options);
  }

  P.sceneGraphSupport.sliceAxes = orient;
  Object.assign(A, { extrudeImage, sliceStack });
})(KIT);
