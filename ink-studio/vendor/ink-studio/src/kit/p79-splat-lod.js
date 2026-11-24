/* Error-driven Gaussian splat merging with explicit ownership and silhouette guards. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-10,
    integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b,
    finite = (n, a, b) => Number.isFinite(n) && n >= a && n <= b,
    name = s => typeof s === 'string' && s.length <= 256,
    label = s => name(s) || Number.isSafeInteger(s),
    vector = p => Array.isArray(p) && p.length === 3 && p.every(v => finite(v, -1e6, 1e6)),
    covar = (n, r) => {
      const f = r * r,
        k = f * 0.9775,
        [x, y, z] = n;
      return [f - k * x * x, -k * x * y, -k * x * z, f - k * y * y, -k * y * z, f - k * z * z];
    },
    square = ([x, y, z]) => [x * x, x * y, x * z, y * y, y * z, z * z];
  function covariance(raw) {
    if (!Array.isArray(raw) || raw.length !== 6 || !raw.every(v => finite(v, -1e12, 1e12)))
      throw new Error('Splat covariances need six finite symmetric components');
    const [a, b, c, d, e, f] = raw,
      peak = Math.max(a, d, f),
      determinant = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c);
    if (
      a <= 0 ||
      d <= 0 ||
      f <= 0 ||
      a * d < b * b - EPS * peak * peak ||
      d * f < e * e - EPS * peak * peak ||
      a * f < c * c - EPS * peak * peak ||
      determinant < -EPS * peak ** 3
    )
      throw new Error('Splat covariance must be positive semidefinite');
    return raw.slice();
  }
  const area = (c, n) => {
    const [x, y, z] = n,
      [a, b, d, e, f, g] = c;
    const projected =
      x * x * (e * g - f * f) +
      y * y * (a * g - d * d) +
      z * z * (a * e - b * b) +
      2 * (x * y * (d * f - b * g) + x * z * (b * f - d * e) + y * z * (b * d - a * f));
    return Math.max(Math.sqrt(Math.max(0, projected)), Number.EPSILON * Math.max(a, e, g));
  };

  const nativePartition = Symbol('native splat partition');

  function mergeSplats(
    input,
    {
      target,
      ratio = 0.5,
      maxDistance = 0.16,
      minNormal = 0.9,
      maxColor = 0.18,
      maxError = 1.4,
      maxRadius = maxDistance * 1.65,
      viewDirections = [],
      silhouette = 0.17,
      lockSeams = true,
      seamDistance = maxDistance,
      maxPairs = 1900000,
      candidateLimit = 8,
      guard
    } = {}
  ) {
    if (
      !Array.isArray(input) ||
      input.length > 250000 ||
      (target !== undefined && !integer(target, 0, input.length)) ||
      !finite(ratio, 0, 1) ||
      !finite(maxDistance, 1e-6, 1e4) ||
      !finite(seamDistance, 1e-6, 1e4) ||
      !finite(maxRadius, 1e-6, 1e5) ||
      !finite(minNormal, 0, 0.999999) ||
      !finite(maxColor, 1e-6, 3) ||
      !finite(maxError, 0, 1e6) ||
      !Array.isArray(viewDirections) ||
      viewDirections.length > 24 ||
      !viewDirections.every(v => vector(v) && V.len(v) > EPS) ||
      (guard !== undefined && typeof guard !== 'function') ||
      !finite(silhouette, 0, 1) ||
      typeof lockSeams !== 'boolean' ||
      !integer(maxPairs, 1, 10000000) ||
      !integer(candidateLimit, 1, 64)
    )
      throw new Error('Splat LOD needs bounded samples, error and view controls');
    const views = viewDirections.map(v => V.norm(v)),
      goal = target ?? Math.floor(input.length * ratio),
      ids = new Set(),
      grid = new Map(),
      work = { pairs: 0, merged: 0, protected: 0, maxError: 0 },
      nodes = Array.from(input, (raw, i) => {
        const {
          id = String(i),
          position,
          normal,
          radius,
          opacity = 1,
          color,
          owner = '',
          material = '',
          surface = '',
          target,
          [nativePartition]: partition,
          protect = false
        } = raw ?? {};
        if (
          !name(id) ||
          !id.length ||
          ids.has(id) ||
          !vector(position) ||
          !vector(normal) ||
          V.len(normal) < EPS ||
          !vector(color) ||
          !color.every(v => finite(v, 0, 1)) ||
          !finite(opacity, 1e-8, 1) ||
          ![owner, material].every(label) || !name(surface) ||
          typeof protect !== 'boolean' ||
          (raw?.covariance === undefined && !finite(radius, 1e-6, 1e5))
        )
          throw new Error('Splat LOD records need stable IDs, geometry and normalized color');
        const binding = target === undefined ? undefined : P.data.freeze(K.authoring.data.clone(TargetSelectors.describe(target)));
        ids.add(id);
        const n = V.norm(normal),
          c = raw.covariance === undefined ? covar(n, radius) : covariance(raw.covariance),
          projected = area(c, n),
          locked = protect || views.some(view => Math.abs(V.dot(view, n)) <= silhouette);
        return {
          id,
          position: position.slice(),
          normal: n,
          covariance: c,
          opacity,
          color: color.slice(),
          owner,
          material,
          surface, binding,
          weight: projected * opacity,
          group: JSON.stringify([owner, material, surface, binding && SplatProvenance.targetKey(binding), partition]),
          locked,
          alive: true,
          first: i
        };
      });
    const cell = p => p.map(v => Math.floor(v / seamDistance)),
      key = q => q.join('/');
    function put(n) {
      const slot = key(cell(n.position));
      let groups = grid.get(slot);
      if (!groups) grid.set(slot, (groups = new Map()));
      let group = groups.get(n.group);
      if (!group) groups.set(n.group, (group = []));
      group.push(n);
    }
    function* otherGroups(n) {
      const [x, y, z] = cell(n.position);
      for (let c = -1; c <= 1; c++)
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) {
            const groups = grid.get(key([x + a, y + b, z + c]));
            if (!groups) continue;
            for (const [label, group] of groups) if (label !== n.group) yield group;
          }
    }
    let capped = false;
    function compare() {
      if (work.pairs >= maxPairs) {
        capped = true;
        return false;
      }
      work.pairs++;
      return true;
    }
    if (lockSeams && goal < nodes.length) {
      if (new Set(nodes.map(n => n.group)).size > 1) {
        for (const n of nodes) put(n);
        scan: for (const n of nodes) {
          if (n.locked) continue;
          neighbors: for (const group of otherGroups(n))
            for (const m of group) {
              if (!compare()) break scan;
              if (V.dist(n.position, m.position) <= seamDistance) {
                n.locked = m.locked = true;
                break neighbors;
              }
            }
        }
        grid.clear();
      }
    }
    work.protected = nodes.filter(n => n.locked).length;
    const makeHeap = () =>
      new ProceduralHeap(
        (a, b) =>
          a.score < b.score ||
          (a.score === b.score && (a.a.first < b.a.first || (a.a.first === b.a.first && a.b.first < b.b.first)))
      );
    function enqueue(heap, a, b) {
      if (a.first > b.first) [a, b] = [b, a];
      if (a.locked || b.locked || a.group !== b.group || !compare()) return;
      const d = V.dist(a.position, b.position),
        c = V.dist(a.color, b.color),
        alignment = V.dot(a.normal, b.normal);
      if (d > maxDistance || c > maxColor || alignment < minNormal) return;
      const score =
        (d / maxDistance) ** 2 + 0.45 * (c / maxColor) ** 2 + (0.65 * Math.max(0, 1 - alignment)) / (1 - minNormal);
      if (score <= maxError) heap.push({ a, b, score });
    }

    function mergePair(a, b) {
      const weight = a.weight + b.weight,
        u = a.weight / weight,
        v = b.weight / weight,
        position = V.mad(a.position, V.sub(b.position, a.position), v),
        normal = V.norm(V.add(V.mul(a.normal, u), V.mul(b.normal, v))),
        da = square(V.sub(a.position, position)),
        db = square(V.sub(b.position, position)),
        covariance = a.covariance.map((q, i) => u * (q + da[i]) + v * (b.covariance[i] + db[i])),
        size = Math.sqrt(Math.max(covariance[0], covariance[3], covariance[5]));
      if (size > maxRadius) return null;
      return {
        position,
        normal,
        covariance,
        weight,
        opacity: Math.min(1, weight / area(covariance, normal)),
        color: V.mad(a.color, V.sub(b.color, a.color), v)
      };
    }

    // Partition each material independently. Query a bounded set of spatial neighbours
    // per survivor, then rebuild after a disjoint round of merges.
    const distanceLimit = maxDistance ** 2;
    function spatialTree(group, first = 0, end = group.length) {
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      let earliest = Infinity;
      for (let i = first; i < end; i++) {
        const { position, first: source } = group[i];
        earliest = Math.min(earliest, source);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], position[axis]);
          max[axis] = Math.max(max[axis], position[axis]);
        }
      }
      if (end - first <= 12) return { group, first, end, min, max, earliest };
      let axis = 0;
      for (let i = 1; i < 3; i++) if (max[i] - min[i] > max[axis] - min[axis]) axis = i;
      const sorted = group.slice(first, end).sort((a, b) => a.position[axis] - b.position[axis] || a.first - b.first);
      for (let i = 0; i < sorted.length; i++) group[first + i] = sorted[i];
      const middle = (first + end) >>> 1;
      return {
        axis,
        split: group[middle].position[axis],
        min,
        max,
        earliest,
        left: spatialTree(group, first, middle),
        right: spatialTree(group, middle, end)
      };
    }

    function closest(node, tree, best) {
      let bound = 0;
      for (let axis = 0; axis < 3; axis++) {
        const gap = Math.max(0, tree.min[axis] - node.position[axis], node.position[axis] - tree.max[axis]);
        bound += gap * gap;
      }
      if (bound > distanceLimit) return;
      if (best.length === candidateLimit) {
        const last = best[best.length - 1];
        if (bound > last.distance || (bound === last.distance && tree.earliest >= last.peer.first)) return;
      }
      if (tree.group) {
        for (let j = tree.first; j < tree.end; j++) {
          const peer = tree.group[j];
          if (peer === node) continue;
          const dx = peer.position[0] - node.position[0],
            dy = peer.position[1] - node.position[1],
            dz = peer.position[2] - node.position[2],
            distance = dx * dx + dy * dy + dz * dz;
          if (distance > distanceLimit) continue;
          let slot = best.length;
          while (
            slot > 0 &&
            (distance < best[slot - 1].distance ||
              (distance === best[slot - 1].distance && peer.first < best[slot - 1].peer.first))
          )
            slot--;
          if (slot >= candidateLimit) continue;
          best.splice(slot, 0, { peer, distance });
          if (best.length > candidateLimit) best.pop();
        }
        return;
      }
      if (node.position[tree.axis] < tree.split) {
        closest(node, tree.left, best);
        closest(node, tree.right, best);
      } else {
        closest(node, tree.right, best);
        closest(node, tree.left, best);
      }
    }

    let active = nodes.length;
    while (!capped && active > goal) {
      const groups = new Map();
      for (const node of nodes) {
        if (!node.alive || node.locked) continue;
        let group = groups.get(node.group);
        if (!group) groups.set(node.group, (group = []));
        group.push(node);
      }
      const heap = makeHeap(),
        pairs = new Set();
      search: for (const group of groups.values()) {
        if (group.length < 2) continue;
        const tree = spatialTree(group);
        const candidates = [];
        for (const node of group) {
          candidates.length = 0;
          closest(node, tree, candidates);
          for (const { peer } of candidates) {
            const id = Math.min(node.first, peer.first) * input.length + Math.max(node.first, peer.first);
            if (pairs.has(id)) continue;
            pairs.add(id);
            enqueue(heap, node, peer);
            if (capped) break search;
          }
        }
      }
      if (!heap.size) break;
      const before = active;
      while (active > goal && heap.size) {
        const { a, b, score } = heap.pop();
        if (!a.alive || !b.alive) continue;
        const hit = mergePair(a, b);
        if (!hit) continue;
        a.alive = b.alive = false;
        nodes.push({
          id: a.id,
          position: hit.position,
          normal: hit.normal,
          covariance: hit.covariance,
          opacity: hit.opacity,
          color: hit.color,
          owner: a.owner,
          material: a.material,
          surface: a.surface,
          binding: a.binding,
          group: a.group,
          weight: hit.weight,
          locked: false,
          alive: true,
          first: a.first,
          parts: [a, b]
        });
        active--;
        work.merged++;
        work.maxError = Math.max(work.maxError, score);
      }
      if (active === before) break;
    }
    function records(selection) {
      return selection
        .sort((a, b) => a.first - b.first)
        .map(n => {
          const { id, position, normal, covariance, opacity, color, owner, material, surface, binding, locked: protect } = n,
            members = [],
            pending = [n];
          while (pending.length) {
            const node = pending.pop();
            if (node.parts) pending.push(node.parts[1], node.parts[0]);
            else members.push(node.id);
          }
          return { id, position, normal, covariance, opacity, color, owner, material, surface, ...(binding && { target: binding }), protect, members };
        });
    }
    const splats = records(nodes.filter(n => n.alive));
    if (guard && work.merged) {
      const accepted = guard(P.data.freeze(splats));
      if (typeof accepted !== 'boolean') throw new TypeError('Splat LOD guard must return a boolean');
      if (!accepted)
        return P.data.freeze({
          status: 'coverage',
          splats: records(nodes.slice(0, input.length)),
          work: { ...work, attemptedMerges: work.merged, merged: 0 }
        });
    }
    return P.data.freeze({ status: active <= goal ? 'ok' : capped ? 'budget' : 'constrained', splats, work });
  }

  function writeRow(data, i, p, alpha) {
    const [r, g, b] = p.color.map(v => Math.round(v * 255)), [x, y, z] = p.position;
    const [xx, xy, xz, yy, yz, zz] = p.covariance;
    data.set([x, y, z, alpha, xx, xy, xz, r + 256 * g + 65536 * b, yy, yz, zz, 0, 0, 0, 0, 0], i * 16);
  }

  function packSplats(input, { alphaScale = 3 } = {}) {
    const splats = Array.isArray(input) ? input : input?.splats;
    if (!Array.isArray(splats) || splats.length > 250000 || !finite(alphaScale, 1e-6, 10))
      throw new Error('Native splat packing needs a bounded static splat list');
    const data = new Float32Array(splats.length * 16);
    for (const [i, p] of splats.entries()) {
      if (!vector(p?.position) || !vector(p?.color) || !p.color.every(v => finite(v, 0, 1)) || !finite(p.opacity, 0, 1) ||
          (p.normal !== undefined && (!vector(p.normal) || V.len(p.normal) < EPS)) ||
          (p.owner !== undefined && !label(p.owner)) || (p.material !== undefined && !label(p.material)) ||
          (p.surface !== undefined && !name(p.surface)))
        throw new Error('Invalid native splat');
      covariance(p.covariance);
      if (p.target !== undefined) TargetSelectors.describe(p.target);
      writeRow(data, i, p, p.opacity * alphaScale);
    }
    return { count: splats.length, data, renderMetadata: SplatProvenance.fromRecords(splats),
      ...(splats.some(row => row.id !== undefined) && { splatIds: Object.freeze(splats.map(row => row.id ?? null)) }) };
  }

  function reduceWorld(world, options) {
    if (!world || !integer(world.count, 0, 250000) || !(world.data instanceof Float32Array) || world.data.length < world.count * 16 ||
        world.anim || world.rest || world.pixAnchors || world.effectParticles?.length || world.sortRanges?.length)
      throw new TypeError('Native LOD needs a baked world without external per-splat animation or draw ranges');
    const { data, count, renderMetadata: meta, materialAlbedo, materialPixelStyles, opticalSplats, surfaceData, pix, fine, attr } = world;
    const index = TargetSelectors.index(world);
    const samples = Array.from({ length: count }, (_, i) => {
      const q = i * 16, color = Math.round(data[q + 7]), metadata = index.row(i);
      const styleCode = materialPixelStyles?.[i * 4 + 1] || 0, shadeSteps = styleCode >> 3 & 127;
      const normal = Array.from(meta?.normals?.subarray(i * 3, i * 3 + 3) ?? []);
      const validNormal = normal.length === 3 && V.len(normal) > EPS;
      return { id: String(i), position: Array.from(data.subarray(q, q + 3)), normal: validNormal ? normal : [0, 1, 0],
        covariance: [4, 5, 6, 8, 9, 10].map(k => data[q + k]),
        opacity: Math.max(1e-8, Math.min(1, data[q + 3])),
        color: [color & 255, color >> 8 & 255, color >> 16].map(value => value / 255),
        owner: metadata.object ?? '', material: metadata.material ?? '', surface: metadata.surface ?? '',
        [nativePartition]: [meta?.objectIds?.[i] || 0, meta?.materialIds?.[i] || 0, meta?.targetIds?.[i] || 0,
          materialAlbedo?.[i] || 0, materialPixelStyles?.[i * 4] || 0, shadeSteps, shadeSteps ? color : 0].join('/'),
        protect: !validNormal || data[q + 3] < 1 || Boolean(data[q + 11] || opticalSplats?.[i * OpticalMaterials.STRIDE + 3] || surfaceData?.[i * 8] ||
          pix?.[i * 8] || fine?.[i * 12 + 11] || (styleCode & MaterialPixelStyle.PAIR) ||
          attr?.subarray(i * 4, i * 4 + 4).some(Boolean)) };
    });
    const reduced = mergeSplats(samples, options);
    const result = SplatProvenance.subset(world, reduced.splats.map(row => Number(row.id)));
    for (let i = 0; i < reduced.splats.length; i++) {
      const row = reduced.splats[i];
      if (row.members.length < 2) continue;
      // Merged dabs still cover the solid footprint of their original samples.
      writeRow(result.data, i, row, Math.max(data[Number(row.id) * 16 + 3], row.opacity * 3));
      result.renderMetadata.normals.set(row.normal, i * 3);
    }
    result.lod = P.data.freeze({ status: reduced.status, sourceCount: count, ...reduced.work });
    return result;
  }

  // Compare coverage arrays captured with the same camera and render settings.
  // Measure missing foreground as well as expanded silhouette.
  function compareCoverage(reference, preview, { threshold = 0.5, maxMissing = 0.001, maxExtra = 0.01 } = {}) {
    if (
      !(reference instanceof Float32Array) ||
      !(preview instanceof Float32Array) ||
      reference.length !== preview.length ||
      !finite(threshold, 1e-6, 1) ||
      !finite(maxMissing, 0, 1) ||
      !finite(maxExtra, 0, 1)
    )
      throw new TypeError('Coverage comparison needs matching Float32 frames and normalized thresholds');
    let foreground = 0,
      missing = 0,
      extra = 0;
    for (let i = 0; i < reference.length; i++) {
      const a = reference[i],
        b = preview[i];
      if (!finite(a, 0, 1) || !finite(b, 0, 1)) throw new TypeError('Invalid coverage sample');
      if (a >= threshold) {
        foreground++;
        if (b < threshold) missing++;
      } else if (b >= threshold) extra++;
    }
    const missingFraction = missing / Math.max(1, foreground),
      extraFraction = extra / Math.max(1, foreground);
    return {
      accepted: missingFraction <= maxMissing && extraFraction <= maxExtra,
      foreground,
      missing,
      extra,
      missingFraction,
      extraFraction
    };
  }

  P.splatProvenance = SplatProvenance;
  P.lod = { mergeSplats, packSplats, reduceWorld, compareCoverage };
})(KIT);
