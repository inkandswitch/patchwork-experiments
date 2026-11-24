/* Indexed rest geometry and editable skin data for mesh export. */
(function (K) {
  const G = K.procedural.geometry,
    V = K.V;
  const linear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const rgb = hex => [hex >> 16, (hex >> 8) & 255, hex & 255].map(channel => linear(channel / 255));

  function manifoldEdges(faces) {
    const edges = new Map();
    for (const face of faces)
      for (let i = 0; i < face.length; i++) {
        const a = face[i],
          b = face[(i + 1) % face.length],
          key = a < b ? a + '/' + b : b + '/' + a;
        const record = edges.get(key) || [0, 0];
        record[a < b ? 0 : 1]++;
        edges.set(key, record);
      }
    return [...edges.values()].every(([forward, back]) => forward === 1 && back === 1);
  }

  function fromSdf(field, { bounds, resolution = 0.08, maxCells = 500000, method = 'auto', ...options } = {}) {
    const fn = typeof field === 'function' ? field : field?.sd?.bind(field);
    const box = bounds ?? (field?.lo && field?.hi ? { min: field.lo, max: field.hi } : null);
    if (!fn || !box) throw new Error('Model export requires an SDF and sampling bounds');
    if (!['auto', 'adaptive', 'dualContour', 'surfaceNets', 'tetrahedra'].includes(method))
      throw new Error('Unknown model meshing method');
    const { min, max } = K.procedural.spatial.bounds(box);
    if (!Number.isFinite(resolution) || resolution <= 0 || !Number.isSafeInteger(maxCells) || maxCells < 8)
      throw new Error('Model meshing needs a positive resolution and a sampling budget');
    const counts = max.map((v, i) => Math.max(1, Math.ceil((v - min[i]) / resolution)));
    if (counts.reduce((a, b) => a * b, 1) > maxCells && method !== 'adaptive')
      throw new Error(
        'Model bounds need ' + counts.join(' × ') + ' cells at this resolution. Use larger --res or tighter bounds.'
      );
    if (method === 'adaptive') for (let i = 0; i < 3; i++) counts[i] = Math.min(256, counts[i]);
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3,
        c = (a + 2) % 3,
        p = min.slice();
      for (const side of [min[a], max[a]]) {
        p[a] = side;
        for (let j = 0; j <= counts[b]; j++)
          for (let k = 0; k <= counts[c]; k++) {
            p[b] = min[b] + ((max[b] - min[b]) * j) / counts[b];
            p[c] = min[c] + ((max[c] - min[c]) * k) / counts[c];
            const distance = fn(...p);
            if (!Number.isFinite(distance) || distance <= 0)
              throw new Error(
                'The SDF must be positive at the sampling bounds. Enlarge the bounds or use a finite sculpt.'
              );
          }
      }
    }
    if (method === 'adaptive') {
      const depth = Math.max(2, Math.min(8, Math.ceil(Math.log2(Math.max(...counts)))));
      const dual = G.adaptiveSurface(fn, { min, max }, { maxDepth: depth, minDepth: Math.max(2, depth - 3),
        maxNodes: Math.min(520000, maxCells), tolerance: resolution * 0.24, lipschitz: 0 });
      if (!dual.triangles.length || !manifoldEdges(dual.triangles))
        throw new Error('Adaptive field extraction did not produce a closed surface; use regular meshing for this field');
      return { points: dual.points, faces: dual.triangles, closed: true, ...options };
    }
    if (method !== 'tetrahedra') {
      const dual = G[method === 'auto' ? 'surfaceNets' : method](fn, { min, max }, { cell: resolution, maxCells });
      if (!dual.quads.length) throw new Error('No zero surface in the model bounds');
      if (method !== 'auto' || manifoldEdges(dual.quads))
        return { points: dual.points, faces: dual.quads, closed: true, ...options };
    }
    const mesh = G.implicitSurface(p => fn(...p), { min, max }, { resolution, maxCells });
    if (!mesh.positions.length) throw new Error('No zero surface in the model bounds');
    const indexed = G.toKitMesh(mesh, () => [0.45, 0.45, 0.45]);
    const output = fromMesh(indexed, { closed: true, ...options });
    const keys = new Map(), welded = [], aliases = [], quantum = Math.max(...max.map((v, i) => v - min[i])) * 1e-9;
    for (const point of output.points) {
      const key = point.map((v, i) => Math.round((v - min[i]) / quantum)).join('/');
      if (!keys.has(key)) { keys.set(key, welded.length); welded.push(point); }
      aliases.push(keys.get(key));
    }
    output.points = welded;
    output.faces = output.faces.map(face => face.map(i => aliases[i]));
    if (!manifoldEdges(output.faces)) throw new Error('Sculpt extraction left an open seam. Adjust the sampling resolution.');
    return output;
  }

  function triangulate(mesh) {
    const faces = [], uvs = mesh.uvs && [], cornerNormals = mesh.cornerNormals && [], chartGroups = mesh.chartGroups && [];
    for (const [index, face] of mesh.faces.entries()) {
      const quad = face.length === 4;
      if (face.length !== 3 && !quad) throw new Error('Runtime topology needs indexed triangles or quads');
      const split = !quad ? [[0, 1, 2]] :
        V.dist(mesh.points[face[0]], mesh.points[face[2]]) <= V.dist(mesh.points[face[1]], mesh.points[face[3]])
          ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
      for (const tri of split) {
        faces.push(tri.map(i => face[i]));
        if (uvs) uvs.push(tri.map(i => mesh.uvs[index][i]));
        if (cornerNormals) cornerNormals.push(tri.map(i => mesh.cornerNormals[index][i]));
        if (chartGroups) chartGroups.push(mesh.chartGroups[index]);
      }
    }
    return { faces, uvs, cornerNormals, chartGroups };
  }

  function bakeMaterial(palette, material, p, n) {
    const [x, y, z] = p;
    const ramp = material?.rf?.(x, y, z) || material?.r;
    const t = material?.em ? (material.v ?? 1) : K.clamp(0.55 + (material?.mod?.(x, y, z) || 0), 0, 1);
    const sampled = material?.tex?.(x, y, z, n[1], t, n[0], n[2], null);
    const index = Number.isInteger(sampled) ? sampled : ramp?.[Math.min(ramp.length - 1, Math.floor(ramp.length * t))];
    const color = rgb(palette[index] ?? 0xa8a8a8);
    const authored = typeof material?.model === 'function' ? material.model(p, n) : material?.model;
    return {
      name: material?.exportName,
      color,
      roughness: 0.8,
      metallic: 0,
      emission: material?.em ? color : [0, 0, 0],
      normal: n,
      ...authored
    };
  }

  function fromSculpt(sculpt, { palette = PAL_HEX, bounds, resolution = 0.08, targetTriangles = 16000,
      guides = [], topology, fur = {}, ...options } = {}) {
    const { field, parts, noise } = sculpt.modelSource();
    if (!(targetTriangles === Infinity || Number.isInteger(targetTriangles) && targetTriangles >= 4))
      throw new Error('Target triangles must be an integer of at least four');
    if (!Array.isArray(guides) || guides.some(g => !Array.isArray(g.center) || g.center.length !== 3 ||
      !g.center.every(Number.isFinite) || !Number.isFinite(g.radius) || g.radius <= 0 ||
      (g.axis && (!Array.isArray(g.axis) || g.axis.length !== 3 || !g.axis.every(Number.isFinite) || V.len(g.axis) <= 1e-6))))
      throw new Error('Topology guides need a center and positive radius');
    const sample = (material, p, n) => bakeMaterial(palette, sculpt.materialAt(material, p, n), p, n);
    const attachments = parts.map(part => G.analyticModelPart(part, sample));
    if (!field) {
      const [root, ...rest] = attachments;
      return { ...root, attachments: rest };
    }
    const raw = topology || fromSdf(field.sdf, { bounds: bounds ?? field.modelBounds(resolution * 2), resolution, ...options });
    const projected = triangulate(raw);
    let faces = projected.faces, points = raw.points;
    const sourceTriangles = faces.length;
    const midpoint = f => V.mul(f.reduce((out, i) => V.add(out, points[i]), [0, 0, 0]), 1 / f.length);
    let locked = [];
    if (!topology && guides.length) ({ points, faces, locked } = G.guideModelTopology({ points, faces }, guides));
    if (!topology && faces.length > targetTriangles) {
      const groups = faces.map(face => ({ owner: field.surfaceAt(...midpoint(face)).tag || '' }));
      const result = G.simplifyQEM({ points, triangles: faces }, { target: targetTriangles, groups, locked,
        maxError: resolution * 0.72, minNormal: 0.18 });
      points = result.points;
      faces = result.triangles;
    }
    const mesh = { ...raw, ...projected, points, faces, sourceTriangles, name: options.name || raw.name };
    const color = i => rgb(palette[i] ?? 0x504644);
    if (fur !== false) attachments.push(...G.modelFur(mesh, field, noise, color, fur));
    const tagAt = p => field.surfaceAt(...p).tag;
    const partTags = mesh.points.map(tagAt);
    const materials = [], shades = new Map();
    const faceMaterials = faces.map(face => {
      const p = midpoint(face), [a, b, c] = face.map(i => points[i]);
      const n = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
      const value = sample(field.surfaceAt(...p).material, p, n);
      const key = JSON.stringify([value.name, value.color, value.roughness, value.metallic, value.emission]);
      if (!shades.has(key)) {
        shades.set(key, materials.length);
        const { normal, ...material } = value;
        materials.push(material);
      }
      return shades.get(key);
    });
    const step = Math.max(1e-5, resolution * 0.075);
    function sampleSurface(point, fallback) {
      const [x, y, z] = point, value = field.surfaceAt(x, y, z), d = value.distance;
      const g = [field.sdf(x + step, y, z) - d, field.sdf(x, y + step, z) - d, field.sdf(x, y, z + step) - d];
      const length = V.len(g), n = V.norm(g, fallback);
      const valid = length > step * 0.05 && V.dot(n, fallback) > 0.2 && Math.abs(d) < resolution * 2;
      const p = valid ? V.mad(point, n, K.clamp(-d * step / length, -resolution, resolution)) : point;
      return sample((valid ? field.surfaceAt(...p) : value).material || value.material, p, valid ? n : fallback);
    }
    // An explicit topology can carry its own seams through the high-to-low bake.
    return { ...mesh, bakeUVs: !!mesh.uvs, materials, faceMaterials, partTags, tagAt, sampleSurface, attachments };
  }

  function mapModelMeshes(mesh, transform) {
    const { attachments = [], ...base } = mesh;
    return [transform(base), ...attachments.map(transform)];
  }

  function fromMesh(mesh, options = {}) {
    const points = [],
      faces = [];
    for (let i = 0; i < mesh.pos.length; i += 3) points.push(Array.from(mesh.pos.slice(i, i + 3)));
    for (let i = 0; i < mesh.tri.length; i += 3) faces.push(Array.from(mesh.tri.slice(i, i + 3)));
    const colors = [];
    if (mesh.vcol) for (let i = 0; i < mesh.vcol.length; i += 3) colors.push(Array.from(mesh.vcol.slice(i, i + 3)));
    return {
      points,
      faces,
      ...(colors.length ? { colors } : {}),
      faceMaterials: Array.from(mesh.tmat),
      materials: mesh.mats.map(({ name, rgb, texture }) => ({ name, color: rgb, texture })),
      ...(mesh.uvs ? { uvs: mesh.uvs } : {}),
      ...(mesh.cornerNormals ? { cornerNormals: mesh.cornerNormals } : {}),
      ...options
    };
  }

  function sampleClips(clips, sample) {
    return clips.map(({ name, duration, fps = 30, pose }) => {
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isInteger(fps) ||
        fps < 1 ||
        fps > 240 ||
        duration * fps > 7200 ||
        typeof pose !== 'function'
      )
        throw new Error('Each model clip needs a duration, sample rate and pose function');
      const steps = Math.ceil(duration * fps);
      let last = 0;
      const frames = Array.from({ length: steps + 1 }, (_, i) => {
        const time = (duration * i) / steps;
        const matrices = sample(pose, time, time - last);
        last = time;
        return { time, matrices };
      });
      return { name, frames };
    });
  }

  /* Use the same cell influences and deformation matrices as the rendered puppet. */
  function fromPuppet(mesh, puppet, { clips = [], tags = {}, defaultPart } = {}) {
    if (!mesh.partTags || mesh.partTags.length !== mesh.points.length)
      throw new Error('Puppet mesh export needs a tagged sculpt');
    const anchor = new Map(),
      cells = new Map(),
      joints = [];
    for (const name of puppet.order) {
      const part = puppet.parts[name];
      if (!part.ids.length || !part.skin.n) throw new Error('No splats were bound for puppet part ' + name);
      const parent = part.parent === null ? null : anchor.get(part.parent);
      const pivot = part.pivot,
        axis = part.axis;
      const length = Math.max(part.height / part.skin.n, 0.02);
      anchor.set(name, joints.length);
      joints.push({ name, parent, head: pivot, tail: V.mad(pivot, axis, length) });
      cells.set(
        name,
        part.skin.cells.map((point, index) => {
          const id = joints.length;
          joints.push({
            name: name + '.deform.' + (index + 1),
            parent: anchor.get(name),
            head: point,
            tail: V.mad(point, axis, length)
          });
          return id;
        })
      );
    }
    const weightsFor = part => (part.skinPoints || part.points).map((point, i) => {
      const tag = part.partTags[i],
        name = (Object.hasOwn(tags, tag) ? tags[tag] : tag) ?? defaultPart;
      if (!anchor.has(name)) throw new Error('Tag ' + String(tag) + ' does not map to a puppet part');
      const [a, b, w] = puppet.parts[name].skin.weightsAt(point),
        ids = cells.get(name);
      return w > 0
        ? [
            [ids[a], 1 - w],
            [ids[b], w]
          ]
        : [[ids[a], 1]];
    });
    const animations = sampleClips(clips, (pose, time, dt) => {
      puppet.time = time;
      puppet.clear();
      pose(time, dt, puppet);
      puppet.flush();
      return puppet.order.flatMap(name => {
        const part = puppet.parts[name];
        return [
          [...part.A, ...part.t],
          ...part.skin.cells.map((_, i) => {
            const k = 12 * (part.first + i);
            return Array.from(puppet.bones.slice(k, k + 12));
          })
        ];
      });
    });
    const baseWeights = weightsFor(mesh);
    return { meshes: mapModelMeshes(mesh, part => ({
      ...part, weights: part.skinAnchors ? part.skinAnchors.map(anchor => G.modelSkin.interpolate(baseWeights, anchor)) :
        part.points === mesh.points ? baseWeights : weightsFor(part)
    })), joints, animations };
  }

  function fromCreature(mesh, creature, { clips = [], parents = {}, bones = {}, weightZones = [], seamPasses = 7, defaultPart } = {}) {
    if (!Array.isArray(weightZones) || weightZones.some(z => !z || typeof z.a !== 'string' || typeof z.b !== 'string' ||
      !Array.isArray(z.center) || z.center.length !== 3 || !z.center.every(Number.isFinite) ||
      !Array.isArray(z.axis) || z.axis.length !== 3 || !z.axis.every(Number.isFinite) || V.len(z.axis) <= 1e-6 ||
      !Number.isFinite(z.radius) || z.radius <= 0)) throw new Error('Invalid creature weight zone');
    const used = new Map();
    function weightsFor(part) {
      if (!part.partTags || part.partTags.length !== part.points.length)
        throw new Error('Creature meshes need a part tag per vertex');
      return (part.skinPoints || part.points).map((p, i) => {
        const tag = part.partTags[i] ?? defaultPart;
        if (!tag) throw new Error('Assign a creature part to every deforming surface');
        let influences = creature.modelWeights(tag, p);
        if (part.rigidPart) return influences;
        for (const zone of weightZones) {
          const { center, radius, a, b, axis } = zone;
          if (tag !== a && tag !== b || V.dist(p, center) >= radius) continue;
          const k = K.clamp(0.5 + V.dot(V.sub(p, center), V.norm(axis)) / (2 * radius), 0, 1);
          const w = k * k * (3 - 2 * k);
          const strength = 1 - (V.dist(p, center) / radius) ** 2;
          influences = [...influences.map(([name, value]) => [name, value * (1 - strength)]),
            ...creature.modelWeights(a, p).map(([name, value]) => [name, value * strength * (1 - w)]),
            ...creature.modelWeights(b, p).map(([name, value]) => [name, value * strength * w])];
        }
        return influences;
      });
    }
    const base = G.modelSkin.blend(mesh, weightsFor(mesh), weightZones, seamPasses);
    const attached = mapModelMeshes(mesh, part => {
      const namedWeights = part.skinAnchors ? part.skinAnchors.map(anchor => G.modelSkin.interpolate(base, anchor)) :
        part.points === mesh.points ? base : weightsFor(part);
      for (const [i, row] of namedWeights.entries()) for (const [name, weight] of row) if (weight > 0) {
        if (!used.has(name)) used.set(name, { total: 0, p: [0, 0, 0] });
        const entry = used.get(name), p = part.skinPoints?.[i] || part.points[i];
        entry.total += weight;
        entry.p = V.mad(entry.p, p, weight);
      }
      return { ...part, namedWeights };
    });
    const takes = sampleClips(clips.map(clip => ({ ...clip, pose: clip.pose || ((t, dt) => creature.modelFrame(t, dt)) })), (pose, time, dt) => {
      return pose(time, dt, creature);
    });
    const labels = [], jointIndices = new Map(), visited = new Set();
    const parentOf = name => Object.hasOwn(parents, name) ? parents[name] : creature.modelJoint(name).parent ?? null;
    function add(name) {
      if (jointIndices.has(name)) return;
      if (visited.has(name)) throw new Error('Creature joint parent cycle at ' + name);
      visited.add(name);
      const parent = parentOf(name);
      if (parent !== null) add(parent);
      jointIndices.set(name, labels.length);
      labels.push(name);
    }
    for (const name of used.keys()) add(name);
    const joints = labels.map(name => {
      const parent = parentOf(name), entry = used.get(name);
      const bind = { ...creature.modelJoint(name), ...(bones[name] || {}) };
      const head = bind.head || (entry ? V.mul(entry.p, 1 / entry.total) : null);
      if (!head) throw new Error('Missing rest position for creature joint ' + name);
      const tail = bind.tail || V.add(head, [0, 0.15, 0]);
      return { name, head, tail, parent: parent === null ? null : jointIndices.get(parent) };
    });
    const identity = [...K.M.id(), 0, 0, 0];
    const animations = takes.map(clip => ({ ...clip, frames: clip.frames.map(frame => ({
      time: frame.time, matrices: labels.map(name => {
        if (!frame.matrices) throw new Error('Creature clip needs a named matrix sample');
        const matrix = frame.matrices[name];
      if (!matrix && used.has(name)) throw new Error('Missing pose for ' + name);
      return matrix || identity;
      })
    })) }));
    const meshes = attached.map(({ namedWeights, ...part }) => ({
      ...part, weights: namedWeights.map(weights => weights.filter(([, w]) => w > 0).map(([name, w]) => [jointIndices.get(name), w]))
    }));
    return { meshes, joints, animations };
  }

  K.model = { fromSdf, fromSculpt, fromMesh, fromPuppet, fromCreature, sampleClips, mapModelMeshes };
})(KIT);
