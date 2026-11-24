/* Authored splat correspondences and rigid feature tracks. */
const SplatGeometryMorph = (() => {
  const K = KIT, { V, M, Q } = K, { freeze } = K.procedural.data;
  const finite = v => Number.isFinite(v) && Number.isFinite(Math.fround(v));
  const validId = v => (typeof v === 'string' && v.length > 0) || (Number.isSafeInteger(v) && v >= 0);
  const xyz = p => (Array.isArray(p) || ArrayBuffer.isView(p)) && p.length === 3 && Array.from(p).every(finite);
  const check = (valid, message) => {
    if (!valid) throw new RangeError('Geometry morph: ' + message);
  };

  function positions(input) {
    check(Array.isArray(input) && input.length, 'each endpoint needs a nonempty point set');
    const rows = new Map();
    for (const row of input) {
      check(row && validId(row.id) && xyz(row.position) && !rows.has(row.id),
        'endpoint points need distinct IDs and finite XYZ positions');
      rows.set(row.id, Array.from(row.position));
    }
    return rows;
  }

  function compile(source, target, { points = [], features = [], ease = 'smooth', tolerance = .0001 } = {}) {
    check(Array.isArray(points) && Array.isArray(features) && finite(tolerance) && tolerance >= 0 &&
      K.anim.keyframeTrack.eases.includes(ease), 'invalid point, feature, easing or tolerance settings');
    const a = positions(source), b = positions(target), used = new Set();
    const pair = (from, to) => {
      check(a.has(from) && b.has(to), 'pairs must address distinct, unused points in the respective endpoint sets');
      const start = a.get(from), end = b.get(to);
      a.delete(from);
      b.delete(to);
      return { from, to, start, end };
    };
    const named = key => {
      check(validId(key) && !used.has(key), 'tracks need distinct IDs');
      used.add(key);
      return key;
    };
    const pose = raw => {
      check(xyz(raw?.position), 'feature poses need a finite pivot position');
      return { position: Array.from(raw.position), rotation: Q.normalize(raw.rotation ?? Q.id()) };
    };
    function track(start, end, keys, rigid) {
      check(Array.isArray(keys), 'expected an array of constraints');
      const interior = keys.map(key => {
        check(Number.isFinite(key?.at) && key.at > 0 && key.at < 1 && xyz(key.position),
          'constraints need finite positions at progress strictly between 0 and 1');
        return {
          time: key.at, ease: key.ease ?? ease,
          value: rigid ? pose(key) : { position: Array.from(key.position) }
        };
      });
      const schema = rigid ? { position: 'vector', rotation: 'quaternion' } : { position: 'vector' };
      return K.anim.keyframeTrack.create(schema, [
        { time: 0, value: start, ease }, ...interior, { time: 1, value: end, ease }
      ]);
    }

    const tracks = Array.from(points, raw => {
      const key = named(raw?.id), member = pair(raw.from, raw.to);
      const path = track({ position: member.start }, { position: member.end }, raw.keys ?? [], false);
      return { key, path, pairs: [member] };
    });
    for (const raw of features) {
      const key = named(raw?.id), from = pose(raw.from), to = pose(raw.to);
      check(Array.isArray(raw.pairs) && raw.pairs.length, 'a feature needs at least one explicit pair');
      const sourceInverse = M.tr(Q.toMatrix(from.rotation)), targetRotation = Q.toMatrix(to.rotation);
      const pairs = Array.from(raw.pairs, link => {
        check(Array.isArray(link) && link.length === 2, 'a feature pair needs a source and target ID');
        const member = pair(...link);
        const local = M.app(sourceInverse, V.sub(member.start, from.position));
        check(V.dist(member.end, V.add(to.position, M.app(targetRotation, local))) <= tolerance,
          'feature ' + key + ' has a target point outside its rigid pose tolerance');
        return { ...member, local };
      });
      const path = track(from, to, raw.keys ?? [], true);
      tracks.push({ key, path, pairs, sourceInverse, targetInverse: M.tr(targetRotation) });
    }
    check(a.size === 0 && b.size === 0, 'pair every endpoint point exactly once');

    const matches = freeze(tracks.flatMap(({ key, pairs }) => pairs.map(({ from, to }) => ({ track: key, from, to }))));
    function visit(progress, write) {
      check(Number.isFinite(progress), 'progress must be finite');
      const t = Math.max(0, Math.min(1, progress));
      for (const group of tracks) {
        const { position, rotation } = group.path.sample(t);
        const basis = rotation ? Q.toMatrix(rotation) : null;
        const transpose = basis && M.tr(basis);
        const relative = basis && M.mul(basis, group.sourceInverse);
        for (const member of group.pairs) {
          const point = t === 0 ? member.start : t === 1 ? member.end
            : basis ? V.add(position, M.app(basis, member.local)) : position;
          write(point, member, group, t, basis, transpose, relative);
        }
      }
    }

    const plan = Object.freeze({
      matches,
      sample(progress) {
        const out = [];
        visit(progress, (point, { from, to }, { key }) => out.push({ track: key, from, to, position: point.slice() }));
        return freeze(out);
      }
    });
    return { plan, tracks, visit };
  }

  const covSlots = [4, 5, 6, 8, 9, 10], entries = [0, 1, 2, 4, 5, 8];
  function stage(st, a, b, options) {
    check(new Set([...a, ...b]).size === a.length + b.length, 'stage endpoint sets must be disjoint and distinct');
    const { base, D, W } = st;
    const samples = ids => ids.map(id => ({ id, position: base.subarray(id * 16, id * 16 + 3) }));
    const { plan, tracks, visit } = compile(samples(a), samples(b), options);
    const channels = [
      [W.pix, 8, 3], [W.surfaceData, SurfaceLook.STRIDE, 1], [W.surfaceData, SurfaceLook.STRIDE, 5],
      [W.renderMetadata?.normals, 3, 0]
    ].filter(([array]) => array);
    for (const { pairs, sourceInverse, targetInverse } of tracks) {
      for (const member of pairs) {
        const from = 16 * member.from, to = 16 * member.to;
        member.startShape = covSlots.map(k => base[from + k]);
        member.endShape = covSlots.map(k => base[to + k]);
        if (sourceInverse) {
          member.localStart = K.splatFrames.covariance(base, from, sourceInverse, M);
          member.localEnd = K.splatFrames.covariance(base, to, targetInverse, M);
          member.axes = channels.map(([array, stride, offset]) => {
            const start = member.from * stride + offset;
            return { array, start, vector: Array.from(array.subarray(start, start + 3)) };
          });
        }
      }
    }
    function hide() {
      for (const index of b) {
        const opacity = 16 * index + 3;
        if (!st.physicsOwned?.[index] && D[opacity]) {
          D[opacity] = 0;
          st.touch(index);
        }
      }
    }
    function write(point, member, _group, t, basis, transpose, relative) {
      const { from, startShape, endShape, localStart, localEnd, axes } = member;
      if (st.physicsOwned?.[from]) return;
      let shape;
      if (t === 0) shape = startShape;
      else if (t === 1) shape = endShape;
      else if (basis) {
        const local = localStart.map((v, i) => v + t * (localEnd[i] - v));
        const world = M.mul(M.mul(basis, local), transpose);
        shape = entries.map(i => world[i]);
      } else shape = startShape.map((v, i) => v + t * (endShape[i] - v));
      const offset = 16 * from;
      D.set(point, offset);
      covSlots.forEach((k, i) => { D[offset + k] = shape[i]; });
      if (axes) for (const { array, start, vector } of axes)
        array.set(t === 0 ? vector : M.app(relative, vector), start);
      st.touch(from);
    }

    if (W.pix && tracks.some(({ sourceInverse, pairs }) =>
      sourceInverse && pairs.some(({ from }) => W.pix[from * 8])))
      st.dynamicPatternNormals = true;
    hide();
    return { geometry: plan, draw: progress => visit(progress, write), post: hide };
  }

  K.procedural.motion.geometryMorph = (source, target, options) => compile(source, target, options).plan;
  return stage;
})();
