// Turn indexed authoring geometry, corner UVs and skin weights into glTF primitives.
const png = require('./png');
const { unwrap, area2 } = require('./glb-uv');
const bake = require('./glb-bake');

function meshWriter(doc, mesh, rig, { V }, options) {
  const { name, points } = mesh;
  const validVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
  if (!points?.length || !points.every(p => validVector(p, 3)) || !mesh.faces?.length)
    throw new Error('GLB export requires finite vertices and faces for ' + name);
  if (mesh.uvs && mesh.uvs.length !== mesh.faces.length) throw new Error('Face UV count does not match faces');
  if (mesh.colors && (mesh.colors.length !== points.length || !mesh.colors.every(c => validVector(c, 3) && c.every(x => x >= 0 && x <= 1))))
    throw new Error('Expected one linear RGB color per vertex');
  if (mesh.normals && (mesh.normals.length !== points.length || !mesh.normals.every(n => validVector(n, 3) && V.len(n)>0)))
    throw new Error('Expected one normal per vertex');
  if (mesh.faceMaterials && mesh.faceMaterials.length !== mesh.faces.length)
    throw new Error('Face material count does not match faces');
  const materials = mesh.materials?.length ? mesh.materials : [{ name, color: [0.45, 0.45, 0.45] }];
  const faces = [], faceMaterials = [], corners = [], hardNormals = [], sourceFaces = [];
  const once = new Set();
  for (const [f, face] of mesh.faces.entries()) {
    if (!Array.isArray(face) || face.length < 3 || face.length > 4 || new Set(face).size !== face.length ||
        !face.every(i => Number.isInteger(i) && i >= 0 && i < points.length))
      throw new Error('Expected indexed triangles or quads with distinct vertices on ' + name);
    if (mesh.uvs && (mesh.uvs[f]?.length !== face.length || !mesh.uvs[f].every(p => validVector(p, 2))))
      throw new Error('Expected UVs for every face corner');
    if (mesh.cornerNormals && (mesh.cornerNormals[f]?.length !== face.length ||
        !mesh.cornerNormals[f].every(v => validVector(v, 3) && V.len(v) > 0)))
      throw new Error('Expected normals for every face corner');
    const m = mesh.faceMaterials?.[f] ?? 0;
    if (!Number.isInteger(m) || m < 0 || m >= materials.length) throw new Error('Invalid face material on ' + name);
    let split = [[0, 1, 2]];
    if (face.length === 4) {
      split = V.dist(points[face[0]], points[face[2]]) <= V.dist(points[face[1]], points[face[3]])
        ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
    }
    for (const tri of split) {
      const ids = tri.map(i => face[i]), key = ids.slice().sort((a, b) => a - b).join('/');
      if (once.has(key)) throw new Error('Duplicate triangles on ' + name);
      once.add(key);
      faces.push(ids);
      faceMaterials.push(m);
      sourceFaces.push(f);
      if (mesh.uvs) corners.push(tri.map(i => mesh.uvs[f][i]));
      if (mesh.cornerNormals) hardNormals.push(tri.map(i => V.norm(mesh.cornerNormals[f][i])));
    }
  }

  if (mesh.closed) {
    const edges = new Map();
    for (const face of faces) for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = a < b ? a + '/' + b : b + '/' + a;
      const use = edges.get(key) || [0, 0];
      use[a < b ? 0 : 1]++;
      edges.set(key, use);
    }
    if ([...edges.values()].some(([a, b]) => a !== 1 || b !== 1))
      throw new Error('Closed model has inconsistent winding or a non-manifold edge on ' + name);
  }
  const vertexNormals = points.map(() => [0, 0, 0]);
  const faceNormals = faces.map(face => {
    const [a, b, c] = face.map(i => points[i]), ab = V.sub(b, a), ac = V.sub(c, a);
    const cross = V.cross(ab, ac), length = V.len(cross);
    if (!Number.isFinite(length) || length <= 1e-12 * V.len(ab) * V.len(ac)) throw new Error('Degenerate triangle on ' + name);
    for (const v of face) vertexNormals[v] = V.add(vertexNormals[v], cross);
    return V.mul(cross, 1 / length);
  });
  const normals = (mesh.normals || vertexNormals).map(n => V.norm(n));
  const { uvMargin } = options, textureSize = options.textureSize === 0 ? 0 : mesh.textureSize ?? options.textureSize;
  if (![0, 256, 512, 1024, 2048, 4096].includes(textureSize)) throw new Error('Invalid texture size on ' + name);
  const generated = !mesh.uvs, atlas = generated ? unwrap(points, faces, faceNormals, {
    size: textureSize || 1024, margin: uvMargin, groups: mesh.chartGroups ? sourceFaces.map(i => mesh.chartGroups[i]) : undefined
  }) : { uvs: corners, padding: Math.max(2, Math.ceil(textureSize * uvMargin / 2)) };
  const uvs = atlas.uvs;
  if (uvs.some(uv => Math.abs(area2(...uv)) < 1e-15)) throw new Error('Degenerate UV mapping on ' + name);
  const bakeSource = (generated || mesh.bakeUVs) && textureSize && materials.every(m => !m.texture && !m.alphaMode);
  if (bakeSource && uvs.some(face => face.some(uv => uv.some(x => x < 0 || x > 1))))
    throw new Error('UV coordinates for a texture bake must be inside the atlas');
  const texture = (bytes, label, mime) => ({ index: doc.texture(bytes, name + ' · ' + label, mime) });
  function emissive(material, value, strength) {
    if (value.some(x => x > 0)) material.emissiveFactor = value;
    if (strength > 1) {
      const ext = 'KHR_materials_emissive_strength';
      material.extensions = { [ext]: { emissiveStrength: strength } };
      const list = (doc.gltf.extensionsUsed ||= []);
      if (!list.includes(ext)) list.push(ext);
    }
  }
  function materialFor(m) {
    const material = {
      name: m.name || name,
      pbrMetallicRoughness: { baseColorFactor: [...(m.color || [0.45, 0.45, 0.45]), m.opacity ?? 1],
        roughnessFactor: m.roughness ?? 0.8, metallicFactor: m.metallic ?? 0 }
    };
    if (m.texture) {
      const { width, height, pixels, channels = 4, bytes, mimeType } = m.texture;
      material.pbrMetallicRoughness.baseColorTexture = texture(bytes || png.encode(width, height, pixels, channels), m.name || 'base color', mimeType);
    }
    if (m.alphaMode) material.alphaMode = m.alphaMode;
    if (m.alphaMode === 'MASK') material.alphaCutoff = m.alphaCutoff ?? 0.5;
    if (m.doubleSided) material.doubleSided = true;
    const emission = m.emission || [0, 0, 0], strength = Math.max(1, ...emission);
    emissive(material, emission.map(q => q / strength), strength);
    return doc.add('materials', material);
  }
  let materialIds;
  if (bakeSource) {
    const sample = mesh.sampleSurface;
    const { textures, strength, coverage } = bake({
      ...mesh, materials, faceMaterials, cornerNormals: hardNormals, sampleSurface: sample && ((p, n, f) => sample(p, n, sourceFaces[f]))
    }, faces, uvs, normals, textureSize, atlas.padding, { V });
    const material = { name, pbrMetallicRoughness: {
      baseColorTexture: texture(textures.base, 'base color'), metallicFactor: 0, roughnessFactor: 0.8
    } };
    if (textures.normal) material.normalTexture = texture(textures.normal, 'normal');
    if (textures.surface) {
      material.pbrMetallicRoughness.metallicRoughnessTexture = texture(textures.surface, 'roughness and metal');
      material.pbrMetallicRoughness.metallicFactor = material.pbrMetallicRoughness.roughnessFactor = 1;
    }
    if (textures.emission) {
      material.emissiveTexture = texture(textures.emission, 'emission');
      emissive(material, [1, 1, 1], strength);
    }
    atlas.coverage = coverage;
    materialIds = materials.map(() => 0);
    materialIds[0] = doc.add('materials', material);
  } else materialIds = materials.map(materialFor);

  if (mesh.weights && (!rig.size || mesh.weights.length !== points.length)) throw new Error('Weights need a skeleton and one list per vertex');
  if (rig.size && !mesh.weights && !mesh.static) throw new Error('Provide weights or mark ' + name + ' static');
  const weights = mesh.weights?.map((weights, v) => {
    const combined = new Map();
    for (const [i, w] of weights) {
      if (!Number.isInteger(i) || i < 0 || i >= rig.size || i > 65535 || !Number.isFinite(w) || w < 0)
        throw new Error('Invalid skin weight on ' + name);
      combined.set(i, (combined.get(i) || 0) + w);
    }
    const best = [...combined].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const sum = best.reduce((s, pair) => s + pair[1], 0);
    if (!(sum > 0) || !Number.isFinite(sum)) throw new Error('Missing weight at vertex ' + v + ' of ' + name);
    while (best.length < 4) best.push([0, 0]);
    return best.map(([i, w]) => [w > 0 ? i : 0, w / sum]);
  });
  const primitives = [], byMaterial = new Map();
  for (let f = 0; f < faces.length; f++) {
    const m = materialIds[bakeSource ? 0 : faceMaterials[f]];
    if (!byMaterial.has(m)) byMaterial.set(m, []);
    byMaterial.get(m).push(f);
  }
  let vertices = 0;
  for (const [material, subset] of byMaterial) {
    const pos = [], nr = [], uv = [], indices = [], colors = [], weight = [], joint = [], unique = new Map();
    for (const f of subset) for (const [c, vertex] of faces[f].entries()) {
      const tex = uvs[f][c].map(Math.fround);
      const normal = hardNormals[f]?.[c] || (mesh.smooth === false ? faceNormals[f] : normals[vertex]);
      const key = [vertex, ...tex, ...normal.map(Math.fround)].join('/');
      if (!unique.has(key)) {
        unique.set(key, pos.length / 3);
        pos.push(...points[vertex]);
        nr.push(...normal);
        uv.push(...tex);
        if (mesh.colors) colors.push(...mesh.colors[vertex]);
        if (weights) for (const [i, w] of weights[vertex]) {
          joint.push(i);
          weight.push(w);
        }
      }
      indices.push(unique.get(key));
    }
    vertices += pos.length / 3;
    const float = (data, type, bounds = false) => doc.accessor(Float32Array.from(data), type, { target: 34962, bounds });
    const attributes = { POSITION: float(pos, 'VEC3', true), NORMAL: float(nr, 'VEC3'), TEXCOORD_0: float(uv, 'VEC2') };
    if (mesh.colors) attributes.COLOR_0 = float(colors, 'VEC3');
    if (weights) {
      attributes.JOINTS_0 = doc.accessor(Uint16Array.from(joint), 'VEC4', { target: 34962 });
      attributes.WEIGHTS_0 = float(weight, 'VEC4');
    }
    const Index = unique.size < 65536 ? Uint16Array : Uint32Array;
    primitives.push({ attributes, indices: doc.accessor(Index.from(indices), 'SCALAR', { target: 34963 }), material });
  }
  const meshIndex = doc.add('meshes', { name, primitives });
  const node = doc.add('nodes', { name, mesh: meshIndex, ...(weights ? { skin: rig.skin() } : {}) });
  doc.gltf.scenes[0].nodes.push(node);
  return { name, vertices: new Set(faces.flat()).size, renderVertices: vertices, triangles: faces.length, uvLayers: 1,
    generatedUVs: generated, ...(mesh.sourceTriangles === undefined ? {} : { sourceTriangles: mesh.sourceTriangles }), ...(generated ? { charts: atlas.charts, uvUtilization: atlas.utilization } : {}) };
}

module.exports = meshWriter;
