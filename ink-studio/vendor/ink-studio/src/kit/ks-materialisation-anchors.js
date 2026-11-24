/* Surface anchors retain material coordinates while their geometry keeps moving. */
(function (K) {
  const api = (K.materialisation ??= {}),
    { V, M } = K,
    providers = new WeakSet();
  const vector = (p, n) => {
    if ((!Array.isArray(p) && !ArrayBuffer.isView(p)) || p.length !== n) return false;
    for (let i = 0; i < n; i++) if (!Number.isFinite(p[i])) return false;
    return true;
  };
  const sample = () => ({
    position: [0, 0, 0],
    normal: [0, 1, 0],
    covariance: [0.0004, 0, 0, 0.0004, 0, 0.0004],
    color: 0xffffff,
    alpha: 1,
    velocity: null
  });
  const copy = (out, row) => {
    for (const key of ['position', 'normal', 'covariance'])
      if (row[key]) {
        if (row[key].length !== out[key].length) throw new RangeError('Invalid anchor dimensions');
        for (let a = 0; a < out[key].length; a++) out[key][a] = row[key][a];
      }
    if (row.color !== undefined) out.color = api.color(row.color);
    if (row.alpha !== undefined) out.alpha = row.alpha;
    out.velocity = row.velocity ? Array.from(row.velocity) : null;
    return out;
  };
  function validate(row) {
    const c = row.covariance;
    if (
      !vector(row.position, 3) ||
      !row.position.every(v => Number.isFinite(Math.fround(v))) ||
      !vector(row.normal, 3) ||
      V.len(row.normal) < 1e-10 ||
      !vector(c, 6) ||
      !c.every(v => Number.isFinite(Math.fround(v))) ||
      c[0] < 0 ||
      c[3] < 0 ||
      c[5] < 0 ||
      c[0] * c[3] - c[1] * c[1] < -1e-12 ||
      c[0] * c[5] - c[2] * c[2] < -1e-12 ||
      c[3] * c[5] - c[4] * c[4] < -1e-12 ||
      c[0] * c[3] * c[5] + 2 * c[1] * c[2] * c[4] - c[0] * c[4] * c[4] - c[3] * c[2] * c[2] - c[5] * c[1] * c[1] <
        -1e-16 ||
      !Number.isInteger(row.color) ||
      row.color < 0 ||
      row.color > 0xffffff ||
      !Number.isFinite(row.alpha) ||
      row.alpha < 0 ||
      row.alpha > 100 ||
      (row.velocity !== null && !vector(row.velocity, 3))
    )
      throw new RangeError('A materialisation anchor must return finite geometry, PSD covariance and packed RGB');
    return row;
  }
  function createProvider({ count, sample: read, begin, restore } = {}, complete = false) {
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 250000 ||
      typeof read !== 'function' ||
      (begin !== undefined && typeof begin !== 'function') ||
      (restore !== undefined && typeof restore !== 'function')
    )
      throw new TypeError('Surface anchors need a bounded count and sample callback');
    let lastTime;
    const provider = Object.freeze({
      count,
      begin(time) {
        if (!Number.isFinite(time)) throw new RangeError('Anchor time must be finite');
        begin?.(time);
        lastTime = time;
      },
      sample(index, time, out = sample()) {
        if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(time))
          throw new RangeError('Invalid surface anchor sample');
        if (lastTime !== time) provider.begin(time);
        if (!complete) {
          out.position.fill(0);
          out.normal[0] = 0;
          out.normal[1] = 1;
          out.normal[2] = 0;
          out.covariance.fill(0);
          out.covariance[0] = out.covariance[3] = out.covariance[5] = 0.0004;
          out.color = 0xffffff;
          out.alpha = 1;
          out.velocity = null;
        }
        const row = read(index, time, out);
        const result = row && row !== out ? copy(out, row) : out;
        if (!complete) result.color = api.color(result.color);
        return validate(result);
      },
      ...(restore && { restore })
    });
    providers.add(provider);
    return provider;
  }
  const custom = options => createProvider(options);
  function indices(world, ids) {
    const selected =
      Array.isArray(ids) || ArrayBuffer.isView(ids)
        ? Array.from(ids)
        : ids && Number.isSafeInteger(ids.first) && Number.isSafeInteger(ids.count)
          ? Array.from({ length: ids.count }, (_, i) => i + ids.first)
          : null;
    if (
      !selected?.length ||
      selected.length > 250000 ||
      selected.some(i => !Number.isSafeInteger(i) || i < 0 || i >= world.count) ||
      new Set(selected).size !== selected.length
    )
      throw new RangeError('Surface splats need distinct valid indices');
    return selected;
  }
  function splats(input, selection, { pose, live = false } = {}) {
    const stage = input?.W ? input : null,
      world = stage?.W ?? input;
    if (
      !(world?.data instanceof Float32Array) ||
      typeof live !== 'boolean' ||
      (pose !== undefined && typeof pose !== 'function')
    )
      throw new TypeError('Splat anchors need a world or stage');
    const ids = indices(world, selection),
      count = ids.length,
      original = new Float32Array(count * 16),
      data = new Float32Array(count * 16);
    const pix = world.pix && new Float32Array(count * 8),
      surfaceData = world.surfaceData && new Float32Array(count * 8),
      normals = world.renderMetadata?.normals && new Float32Array(count * 3);
    ids.forEach((id, i) => {
      const rig = stage?.rig,
        raw = rig?.bid?.[id] ? stage.base : world.data;
      original.set(raw.subarray(id * 16, id * 16 + 16), i * 16);
      if (pix) pix.set(world.pix.subarray(id * 8, id * 8 + 8), i * 8);
      if (surfaceData) surfaceData.set(world.surfaceData.subarray(id * 8, id * 8 + 8), i * 8);
      if (normals) normals.set(world.renderMetadata.normals.subarray(id * 3, id * 3 + 3), i * 3);
    });
    data.set(original);
    let frames;
    const transforms = new Map();
    function begin(time) {
      pose?.(time);
      data.set(original);
      const rig = stage?.rig;
      transforms.clear();
      if (live) ids.forEach((id, i) => data.set(world.data.subarray(id * 16, id * 16 + 16), i * 16));
      else if (rig?.M)
        for (let i = 0; i < count; i++) {
          const part = rig.bid[ids[i]];
          if (!part) continue;
          const q = i * 16,
            k = part * 12;
          let transform = transforms.get(part);
          if (!transform) {
            const A = rig.M.subarray(k, k + 9);
            transform = { A, normal: Math.abs(M.det(A)) > 1e-10 ? M.tr(M.inv(A)) : null };
            transforms.set(part, transform);
          }
          const { A } = transform,
            x = original[q],
            y = original[q + 1],
            z = original[q + 2],
            xx = original[q + 4],
            xy = original[q + 5],
            xz = original[q + 6],
            yy = original[q + 8],
            yz = original[q + 9],
            zz = original[q + 10],
            a = A[0] * xx + A[1] * xy + A[2] * xz,
            b = A[0] * xy + A[1] * yy + A[2] * yz,
            c = A[0] * xz + A[1] * yz + A[2] * zz,
            d = A[3] * xx + A[4] * xy + A[5] * xz,
            e = A[3] * xy + A[4] * yy + A[5] * yz,
            f = A[3] * xz + A[4] * yz + A[5] * zz,
            g = A[6] * xx + A[7] * xy + A[8] * xz,
            h = A[6] * xy + A[7] * yy + A[8] * yz,
            j = A[6] * xz + A[7] * yz + A[8] * zz;
          data[q] = A[0] * x + A[1] * y + A[2] * z + rig.M[k + 9];
          data[q + 1] = A[3] * x + A[4] * y + A[5] * z + rig.M[k + 10];
          data[q + 2] = A[6] * x + A[7] * y + A[8] * z + rig.M[k + 11];
          data[q + 4] = a * A[0] + b * A[1] + c * A[2];
          data[q + 5] = a * A[3] + b * A[4] + c * A[5];
          data[q + 6] = a * A[6] + b * A[7] + c * A[8];
          data[q + 8] = d * A[3] + e * A[4] + f * A[5];
          data[q + 9] = d * A[6] + e * A[7] + f * A[8];
          data[q + 10] = g * A[6] + h * A[7] + j * A[8];
        }
      const anim = { bones: world.anim?.bones },
        fake = { data, rest: data, anim, pix, surfaceData, renderMetadata: { normals } };
      frames = K.splatFrames.create(fake, time, M);
    }
    const provider = createProvider(
      {
        count,
        begin,
        sample(i, time, out) {
          if (!frames) begin(time);
          out.velocity = null;
          const q = i * 16,
            p = i * 8,
            r = i * 3,
            plain = Math.round(data[q + 11]) % 16 === 0,
            frame = plain ? null : frames(i),
            position = plain ? null : frame.position();
          for (let a = 0; a < 3; a++) out.position[a] = plain ? data[q + a] : position[a];
          if (plain) {
            const c = out.covariance;
            c[0] = data[q + 4];
            c[1] = data[q + 5];
            c[2] = data[q + 6];
            c[3] = data[q + 8];
            c[4] = data[q + 9];
            c[5] = data[q + 10];
          } else frame.covariance(out.covariance);
          let normal = frame?.normal;
          if (plain) {
            let source, offset;
            if (pix?.[p]) {
              source = pix;
              offset = p + 3;
            } else if (normals?.[r] || normals?.[r + 1] || normals?.[r + 2]) {
              source = normals;
              offset = r;
            } else if (surfaceData?.[p]) {
              source = surfaceData;
              offset = p + 1;
            }
            if (source) {
              for (let a = 0; a < 3; a++) out.normal[a] = source[offset + a];
              const length = Math.hypot(out.normal[0], out.normal[1], out.normal[2]);
              if (length > 1e-8) {
                for (let a = 0; a < 3; a++) out.normal[a] /= length;
                normal = out.normal;
              }
            }
          }
          const localNormal = !!normal;
          if (!normal) {
            const [a, b, c, d, e, f] = out.covariance,
              adj = [d * f - e * e, c * e - b * f, b * e - c * d, a * f - c * c, b * c - a * e, a * d - b * b];
            const columns = [
              [adj[0], adj[1], adj[2]],
              [adj[1], adj[3], adj[4]],
              [adj[2], adj[4], adj[5]]
            ];
            let best = 1;
            for (const i of [0, 2]) if (V.len(columns[i]) > V.len(columns[best]) * 1.00001) best = i;
            normal = V.norm(columns[best], [0, 1, 0]);
          }
          for (let a = 0; a < 3; a++) out.normal[a] = normal[a];
          const rig = stage?.rig,
            part = rig?.bid?.[ids[i]];
          if (part && !live && localNormal) {
            const matrix = transforms.get(part)?.normal;
            if (matrix) {
              const x = matrix[0] * normal[0] + matrix[1] * normal[1] + matrix[2] * normal[2],
                y = matrix[3] * normal[0] + matrix[4] * normal[1] + matrix[5] * normal[2],
                z = matrix[6] * normal[0] + matrix[7] * normal[1] + matrix[8] * normal[2],
                length = Math.hypot(x, y, z);
              out.normal[0] = length > 1e-9 ? x / length : 0;
              out.normal[1] = length > 1e-9 ? y / length : 1;
              out.normal[2] = length > 1e-9 ? z / length : 0;
            }
          }
          out.color = data[q + 7];
          out.alpha = plain ? data[q + 3] : frame.opacity();
          return out;
        },
        restore(i, out) {
          out.set(data.subarray(i * 16, i * 16 + 16));
        }
      },
      true
    );
    return provider;
  }
  function points(input, { size = 0.02, alpha = 2.4, color = 0xffffff, pose } = {}) {
    if (
      !Array.isArray(input) ||
      !input.length ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > 10 ||
      (pose !== undefined && typeof pose !== 'function')
    )
      throw new TypeError('Point anchors need samples and a positive size');
    const rows = input.map(p => {
      const row = sample();
      copy(row, Array.isArray(p) ? { position: p } : p);
      if (Array.isArray(p) || p.color === undefined) row.color = api.color(color);
      if (Array.isArray(p) || p.alpha === undefined) row.alpha = alpha;
      if (Array.isArray(p) || p.covariance === undefined)
        row.covariance = [size * size, 0, 0, size * size, 0, size * size];
      return validate(row);
    });
    return custom({
      count: rows.length,
      sample(i, t, out) {
        copy(out, rows[i]);
        if (pose) pose(out, t, i);
        return out;
      }
    });
  }
  function chart(carrier, seeds, { size = 0.02, thin = 0.004, color = 0xffffff, alpha = 2.4 } = {}) {
    if (
      !Array.isArray(seeds) ||
      !seeds.length ||
      seeds.some(p => !vector(p, 2)) ||
      !(size > 0) ||
      !(thin > 0) ||
      !Number.isFinite(size + thin) ||
      !(typeof carrier === 'function' || typeof carrier?.sample === 'function')
    )
      throw new TypeError('Chart anchors need UV seeds, a chart and positive splat dimensions');
    const uv = seeds.map(p => Array.from(p));
    let current;
    return custom({
      count: uv.length,
      begin(t) {
        current = typeof carrier === 'function' ? carrier(t) : carrier;
      },
      sample(i, t, out) {
        const raw = current.points && current.uvs ? current.sample(...uv[i]) : current.sample(uv[i], t);
        const row = { p: raw.p ?? raw.point, n: raw.n ?? raw.normal },
          n = V.norm(row.n),
          p = size * size,
          d = thin * thin - p;
        for (let a = 0; a < 3; a++) {
          out.position[a] = row.p[a];
          out.normal[a] = n[a];
        }
        out.covariance.splice(
          0,
          6,
          p + d * n[0] * n[0],
          d * n[0] * n[1],
          d * n[0] * n[2],
          p + d * n[1] * n[1],
          d * n[1] * n[2],
          p + d * n[2] * n[2]
        );
        out.color = api.color(color);
        out.alpha = alpha;
        return out;
      }
    });
  }
  api.anchors = Object.freeze({ custom, splats, points, chart, validate, is: provider => providers.has(provider) });
  api.sample = sample;
})(KIT);
