/* Deterministic fragment animation on the original native splat rows. */
(function (K) {
  const { M, V } = K;
  const states = { solid: [0, 0], fragmented: [1, 0], sparse: [1, .8], reassembled: [0, 0] };
  const ruleFields = ['select', 'cell', 'distance', 'spin', 'seed', 'origin', 'keys'];
  const keyFields = ['time', 'state', 'spread', 'withdrawal', 'ease'];
  const plans = new WeakMap();
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

  function prepare(definition) {
    if (definition === false || definition === undefined) return [];
    const rules = Array.isArray(definition) ? definition : [definition];
    if (rules.length > 16) throw new RangeError('Use up to 16 reconstruction tracks');
    return Array.from(rules, (rule, index) => {
      if (!record(rule) || Object.keys(rule).some(field => !ruleFields.includes(field)))
        throw new TypeError('Invalid reconstruction track ' + index);
      const { select, cell = .35, distance = 1, spin = Math.PI / 3, seed = 0, origin, keys } = rule;
      if (!inRange(cell, 1e-4, 1e4) || !inRange(distance, 0, 1e4) || !inRange(spin, 0, Math.PI * 8) ||
          !Number.isSafeInteger(seed) || seed < -2147483648 || seed > 2147483647 ||
          (origin !== undefined && (!Array.isArray(origin) || origin.length !== 3 || !Array.from(origin).every(Number.isFinite))) ||
          !Array.isArray(keys) || !keys.length || keys.length > 256)
        throw new RangeError('A reconstruction track needs bounded fragment controls, an optional XYZ origin and 1 to 256 keys');
      let previous = -Infinity;
      const timeline = Array.from(keys, key => {
        if (!record(key) || Object.keys(key).some(field => !keyFields.includes(field)) ||
            !Number.isFinite(key.time) || key.time <= previous ||
            (key.state !== undefined && (typeof key.state !== 'string' || !Object.hasOwn(states, key.state))) ||
            (key.state === undefined && key.spread === undefined && key.withdrawal === undefined))
          throw new TypeError('Reconstruction keys need increasing finite times and a state, spread or withdrawal');
        const [defaultSpread, defaultWithdrawal] = states[key.state] ?? states.solid;
        const { time, spread = defaultSpread, withdrawal = defaultWithdrawal, ease = 'smooth' } = key;
        if (!inRange(spread, 0, 1) || !inRange(withdrawal, 0, 1) || !['linear', 'smooth', 'hold'].includes(ease))
          throw new RangeError('Reconstruction spread and withdrawal range from 0 to 1 and easing is linear, smooth or hold');
        previous = time;
        return { time, spread, withdrawal, ease };
      });
      return { select: TargetSelectors.prepare(select), cell, distance, spin, seed, origin: origin?.slice(), keys: timeline };
    });
  }

  function at(keys, time) {
    const next = keys.findIndex(key => key.time > time);
    if (next < 0) return keys[keys.length - 1];
    if (next === 0) return keys[0];
    const a = keys[next - 1], b = keys[next];
    let t = (time - a.time) / (b.time - a.time);
    if (a.ease === 'hold') t = 0;
    else if (a.ease === 'smooth') t = t * t * (3 - 2 * t);
    return { spread: a.spread + (b.spread - a.spread) * t, withdrawal: a.withdrawal + (b.withdrawal - a.withdrawal) * t };
  }

  const point = (data, i) => [data[i * 16], data[i * 16 + 1], data[i * 16 + 2]];
  function average(rows, data) {
    const center = [0, 0, 0];
    for (const { index } of rows) for (let axis = 0; axis < 3; axis++) center[axis] += data[index * 16 + axis];
    return V.mul(center, 1 / rows.length);
  }

  function attachPaint(world, marks, byIndex, base) {
    if (!marks.size || !byIndex.size) return;
    const spatial = K.world.spatial.create();
    const excluded = new Set(world.back ?? []);
    const radius = 2 / (world.detail || 12);
    for (let i = 0; i < world.count; i++) {
      const q = i * 16;
      if (marks.has(i) || excluded.has(i) || base[q + 3] <= 0 || base[q + 1] < -30 || (Math.round(base[q + 11]) & 128)) continue;
      const at = point(base, i);
      if (at.every(Number.isFinite)) spatial.set(i, { min: at, max: at, rank: i, value: at });
    }
    const surfaceFrame = SplatFrames.create({ ...world, data: base, rest: undefined, anim: undefined }, 0, M);
    const normals = new Map();
    for (const [index, mark] of marks) {
      const nearest = spatial.nearest(mark.at, row => {
        if (!normals.has(row.id)) normals.set(row.id, surfaceFrame(row.id).normal);
        const normal = normals.get(row.id);
        const alignment = normal ? V.dot(mark.n, normal) : 1;
        if (alignment < .25) return Infinity;
        return V.len(V.sub(row.value, mark.at)) + (1 - alignment) * radius * .5;
      });
      const parent = nearest && byIndex.get(nearest.id);
      if (!parent || nearest.value > radius) continue;
      parent.marks.push({ ...mark, index });
    }
  }

  function compile(world, rules, base) {
    const targets = TargetSelectors.index(world);
    const corrections = world.paintCorrections?.rows ?? [];
    const marks = new Map((world.paintDecals ?? []).map(row => [row.index, row]));
    for (const row of corrections) marks.set(row.index, row);
    const byIndex = new Map(), partitions = rules.map(() => new Map());
    const excluded = new Set(world.back ?? []);
    const unsupported = new Set();
    for (let i = 0; i < world.count; i++) {
      const q = i * 16, code = Math.round(base[q + 11]);
      if (marks.has(i) || excluded.has(i) || (code & 128) || base[q + 1] < -30) continue;
      const target = targets.row(i), track = rules.findIndex(rule => TargetSelectors.matches(rule.select, target));
      if (track < 0) continue;
      const kind = code & 15;
      const rig = world.anim?.rig;
      if (![0, 1, 4, 7].includes(kind) || (rig?.bid?.[i] && !rig.free?.[i])) {
        unsupported.add(track);
        continue;
      }
      const { cell, seed, origin } = rules[track], at = point(base, i);
      if (!at.every(Number.isFinite)) continue;
      const grid = at.map((value, axis) => Math.floor((value - (origin?.[axis] ?? 0)) / cell));
      const key = JSON.stringify([target.entity, target.object, grid]);
      const groups = partitions[track];
      if (!groups.has(key)) groups.set(key, []);
      const row = { index: i, marks: [], rank: (SampleCoverage.cohort(at[0], at[1], at[2], cell / 32, seed) + .5) / SampleCoverage.bins };
      groups.get(key).push(row);
      byIndex.set(i, row);
    }
    attachPaint(world, marks, byIndex, base);
    return partitions.map((groups, i) => {
      const { origin, cell, seed, distance, spin } = rules[i];
      const all = [...groups.values()];
      const rows = all.flat();
      const last = rows.reduce((best, row) => !best || row.rank > best.rank ? row : best, null);
      if (last) last.rank = 1;
      const center = origin ?? (rows.length ? average(rows, base) : [0, 0, 0]);
      return { ...rules[i], unsupported: unsupported.has(i), fragments: all.map(rows => {
        const pivot = average(rows, base);
        const noise = salt => SampleCoverage.cohort(...pivot, cell / 4, seed ^ salt) / (SampleCoverage.bins - 1);
        const axis = V.norm([noise(4779) + .1, noise(7247) - .5, noise(17117) - .5]);
        const away = V.sub(pivot, center), outward = V.len(away) > 1e-8 ? V.norm(away) : axis;
        const heading = V.norm(V.add(outward, V.mul(axis, .28)));
        return { rows, offset: V.mul(heading, distance * (.7 + .3 * noise(12973))),
          axis, angle: spin * (.55 + .45 * noise(24767)) * (noise(31887) < .5 ? -1 : 1) };
      }) };
    });
  }

  function turnVector(data, start, rotation) {
    data.set(M.app(rotation, data.subarray(start, start + 3)), start);
  }

  function turnFacing(pix, at, rotation) {
    const x = pix[at], z = pix[at + 1];
    if (x > 8) return;
    const sign = n => n < 0 ? -1 : 1;
    const y = 1 - Math.abs(x) - Math.abs(z);
    const n = y >= 0 ? [x, y, z] : [(1 - Math.abs(z)) * sign(x), y, (1 - Math.abs(x)) * sign(z)];
    const rotated = M.app(rotation, n);
    const [rx, ry, rz] = V.mul(rotated, 1 / (Math.abs(rotated[0]) + Math.abs(rotated[1]) + Math.abs(rotated[2])));
    pix[at] = ry >= 0 ? rx : (1 - Math.abs(rz)) * sign(rx);
    pix[at + 1] = ry >= 0 ? rz : (1 - Math.abs(rx)) * sign(rz);
  }

  function apply(world, entry, values) {
    const { tracks, base } = entry;
    const data = world.data.slice(), normals = world.renderMetadata?.normals?.slice();
    const pix = world.pix?.slice(), fine = world.fine?.slice(), surfaceData = world.surfaceData?.slice();
    const painted = new Map(), poses = new Map(), hidden = new Set();
    const move = (i, carry, rotation, transpose) => {
      const q = i * 16;
      data.set(carry(point(data, i)), q);
      if (!rotation) return;
      const shape = SplatFrames.covariance(data, q, rotation, M, transpose);
      data[q + 4] = shape[0]; data[q + 5] = shape[1]; data[q + 6] = shape[2];
      data[q + 8] = shape[4]; data[q + 9] = shape[5]; data[q + 10] = shape[8];
      if (normals?.length >= i * 3 + 3) turnVector(normals, i * 3, rotation);
      if (pix?.[i * 8]) {
        turnVector(pix, i * 8 + 3, rotation);
        turnFacing(pix, i * 8 + 6, rotation);
      }
      if (surfaceData?.[i * SurfaceLook.STRIDE]) {
        turnVector(surfaceData, i * SurfaceLook.STRIDE + 1, rotation);
        turnVector(surfaceData, i * SurfaceLook.STRIDE + 5, rotation);
      }
      if (fine?.length >= i * 12 + 12) {
        turnVector(fine, i * 12 + 4, rotation);
        turnVector(fine, i * 12 + 8, rotation);
      }
    };
    for (let i = 0; i < tracks.length; i++) {
      const { spread, withdrawal } = values[i], track = tracks[i];
      if (!spread && !withdrawal) continue;
      if (track.unsupported) throw new TypeError('Reconstruction targets must use native splats without bone, rig or shader-driven position changes');
      for (const { rows: originalRows, offset, axis, angle } of track.fragments) {
        const rows=originalRows.filter(({index})=>!world.anim?.geometryOwned?.[index]&&!world.anim?.physicsOwned?.[index]);
        if(!rows.length)continue;
        const pivot = spread ? average(rows, world.data) : null;
        const rotation = spread && angle ? M.rot(axis, angle * spread) : null;
        const transpose = rotation && M.tr(rotation);
        const shift = spread ? V.mul(offset, spread) : null;
        const center = shift && V.add(pivot, shift);
        const carry = p => rotation ? V.add(center, M.app(rotation, V.sub(p, pivot))) : V.add(p, shift);
        const pose = { rotation, transpose, carry };
        for (const { index, rank, marks } of rows) {
          const hide = withdrawal >= rank;
          if (hide) {
            data[index * 16 + 3] = 0;
            hidden.add(index);
          }
          if (spread) {
            move(index, carry, rotation, transpose);
            poses.set(index, pose);
          }
          for (const mark of marks) {
            if (hide) data[mark.index * 16 + 3] = 0;
            if (spread) move(mark.index, carry, rotation, transpose);
            if (hide) painted.set(mark.index, null);
            else if (spread) painted.set(mark.index, { ...mark, at: carry(mark.at),
              n: rotation ? M.app(rotation, mark.n) : mark.n, ...(mark.samples && { samples: rotation ?
                mark.samples.map(sample => ({ ...sample, toward: M.app(rotation, sample.toward) })) : mark.samples }) });
          }
        }
      }
    }
    const marks = rows => rows.map(row => painted.has(row.index) ? painted.get(row.index) : row).filter(Boolean);
    const paintCorrections = painted.size && world.paintCorrections ?
      PaintCorrections.bind(marks(world.paintCorrections.rows)) : world.paintCorrections;
    const paintDecals = painted.size && world.paintDecals ? marks(world.paintDecals) : world.paintDecals;
    const result = { ...world, data, pix, fine, surfaceData, paintCorrections, paintDecals,
      reconstructionPose: { base, poses },
      renderMetadata: normals ? { ...world.renderMetadata, normals } : world.renderMetadata };
    if (world.pix) {
      if (entry.anchors === undefined) {
        const { count, detail, pix, pats, pixAnchors = K.pixel.anchors } = world;
        entry.anchors = pixAnchors({ count, data: base, detail, pix, pats }) ?? null;
      }
      result._anchors = anchoredSprites(entry.anchors, poses, hidden);
      if (world.pixAnchors) result.pixAnchors = () => result._anchors;
    }
    return result;
  }

  function anchoredSprites(anchors, poses, hidden) {
    if (!anchors?.n) return anchors;
    const data = new Float32Array(anchors.data.length);
    let n = 0;
    for (let a = 0; a < anchors.n; a++) {
      const start = a * 12, i = anchors.data[start + 3];
      if (hidden.has(i)) continue;
      const out = n++ * 12, pose = poses.get(i);
      data.set(anchors.data.subarray(start, start + 12), out);
      if (pose) {
        data.set(pose.carry(data.subarray(out, out + 3)), out);
        if (pose.rotation) turnVector(data, out + 4, pose.rotation);
      }
    }
    return { n, data: data.subarray(0, n * 12) };
  }

  function frame(world, time, definition = world.look?.reconstruction) {
    if (world.reconstructionPose || definition === false || definition === undefined) return world;
    if (!Number.isFinite(time)) throw new RangeError('Reconstruction time must be finite');
    const signature = JSON.stringify(definition);
    const base = world.rest?.length >= world.count * 16 ? world.rest : world.data;
    let entry = plans.get(world);
    if (entry?.signature !== signature || entry.base !== base || entry.count !== world.count ||
        entry.metadata !== world.renderMetadata || entry.paint !== world.paintCorrections || entry.decals !== world.paintDecals || entry.pix !== world.pix || entry.pats !== world.pats) {
      entry = { signature, base, count: world.count, metadata: world.renderMetadata, paint: world.paintCorrections,
        decals: world.paintDecals, pix: world.pix, pats: world.pats, rules: prepare(definition) };
      plans.set(world, entry);
    }
    const values = entry.rules.map(rule => at(rule.keys, time));
    if (!values.some(value => value.spread || value.withdrawal)) return world;
    entry.tracks ??= compile(world, entry.rules, base);
    if (!entry.tracks.some((track, i) => (track.fragments.length || track.unsupported) && (values[i].spread || values[i].withdrawal))) return world;
    return apply(world, entry, values);
  }

  K.reconstruction = Object.freeze({ prepare, frame });
})(KIT);
