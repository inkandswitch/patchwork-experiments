/* Bounded scene-space pose history for object trails and surface marks. */
(function (K) {
  const { M, V, splatFrames } = K;
  const stride = 16, covarianceSlots = [4, 5, 6, 8, 9, 10], matrixSlots = [0, 1, 2, 4, 5, 8];
  // Native dabs stay translucent and leave depth and ownership to the scene.
  const noDepth = 16;
  const transparentCutoff = .004;
  const bounds = (n, lo, hi, whole = false) => Number.isFinite(n) && n >= lo && n <= hi && (!whole || Number.isInteger(n));
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const props = ['select', 'attach', 'at', 'project', 'lift', 'duration', 'interval', 'copies', 'opacity', 'color',
    'maxSamples', 'motionThreshold'];

  function prepare(value) {
    if (value === undefined || value === false) return [];
    if (!Array.isArray(value) || value.length > 8) throw new TypeError('Afterimages need an array of up to eight trails');
    return Array.from(value, def => {
      if (!def || typeof def !== 'object' || Array.isArray(def) || Object.keys(def).some(key => !props.includes(key)))
        throw new TypeError('Invalid afterimage trail');
      const { color, at, lift = .004, duration = .4, interval = 1 / 30, copies = 6, opacity = .45,
        maxSamples = 512, motionThreshold = .01 } = def;
      const select = TargetSelectors.prepare(def.select);
      const attach = def.attach === undefined ? null : TargetSelectors.prepare(def.attach);
      const project = def.project ?? Boolean(attach?.surface);
      if (typeof project !== 'boolean' || project && !attach || at !== undefined && (!attach || !xyz(at)) ||
          !bounds(lift, 0, 2) || !bounds(duration, .001, 8) || !bounds(interval, .001, 8) ||
          !bounds(copies, 1, 16, true) || !bounds(opacity, 0, 1) || !bounds(maxSamples, 1, 2048, true) ||
          !bounds(motionThreshold, 0, 10) || color !== undefined &&
          (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)))
        throw new RangeError('Invalid afterimage attachment, timing, color or sample budget');
      const tint = color && [1, 3, 5].reduce((rgb, at, c) => rgb + parseInt(color.slice(at, at + 2), 16) * 256 ** c, 0);
      return { select, attach, at: at?.slice(), project, lift, duration, interval, copies, opacity, tint, maxSamples, motionThreshold };
    });
  }

  function history() {
    let identity, topology, signature, sampledAt = -Infinity, states = [];
    function clear() {
      identity = topology = signature = undefined;
      sampledAt = -Infinity;
      states = [];
    }

    function frame(world, time, rules, { source = world, layout = world.splatIds, poseTime = time, bornAt = 0, withdrawal = world.sampleWithdrawal ?? 0 } = {}) {
      if (!Number.isFinite(time) || !Number.isFinite(poseTime)) throw new RangeError('Afterimages need a finite time');
      withdrawal = SampleCoverage.amount(withdrawal);
      const key = JSON.stringify(rules);
      if (identity !== source || topology !== layout || signature !== key ||
          time < sampledAt || states[0]?.count !== world.count) {
        clear();
        identity = source;
        topology = layout;
        signature = key;
        states = rules.map(() => ({ count: world.count, frames: [], anchor: undefined }));
      }
      sampledAt = time;
      if (!rules.length) return new Float32Array();
      const { data } = world, targets = TargetSelectors.index(world), sample = splatFrames.create(world, poseTime, M), poseCache = new Map();
      const hidden = new Set(world.back ?? []);
      const visible = i => {
        const q = i * stride, packed = data[q + 11] | 0;
        return !hidden.has(i) && !(packed & 64) && data[q + 3] > 0 && data[q + 1] >= -30 &&
          SampleCoverage.visible(packed, withdrawal) && (!(packed & 512) || birthProgress(q, data, world.grow, poseTime, bornAt) > 0);
      };
      function pose(i) {
        if (!poseCache.has(i)) {
          const point = sample(i);
          poseCache.set(i, { ...point.basis(), position: point.position(), normal: point.normal, rest: point.rest });
        }
        return poseCache.get(i);
      }

      const rows = [];
      for (const [r, rule] of rules.entries()) {
        if (!rule.opacity) continue;
        const state = states[r], sourceIds = [];
        let anchorId = -1, nearest = Infinity;
        for (let i = 0; i < world.count; i++) {
          if (!visible(i)) continue;
          const target = targets.row(i);
          if (TargetSelectors.matches(rule.select, target)) sourceIds.push(i);
          if (rule.attach && TargetSelectors.matches(rule.attach, target)) {
            if (!rule.at) {
              if (anchorId < 0) anchorId = i;
            } else {
              const distance = V.dist(pose(i).rest, rule.at);
              if (distance < nearest) { nearest = distance; anchorId = i; }
            }
          }
        }
        const id = world.splatIds?.[anchorId] ?? anchorId;
        if (id !== state.anchor) {
          state.frames.length = 0;
          state.anchor = id;
        }
        const guide = anchorId < 0 ? null : pose(anchorId);
        if (rule.attach && !guide || rule.project && !guide?.normal || guide && Math.abs(M.det(guide.anchor)) <= 1e-8) {
          state.frames.length = 0;
          continue;
        }
        const inverse = guide && M.inv(guide.anchor), inverseTranspose = inverse && M.tr(inverse);
        const transpose = guide && M.tr(guide.anchor);
        const count = Math.min(sourceIds.length, rule.maxSamples), current = new Map();
        for (let i = 0; i < count; i++) {
          const index = sourceIds[Math.floor(i * sourceIds.length / count)], q = index * stride, point = pose(index);
          const { alpha, scale } = appearance(q, data, world.grow, poseTime, bornAt);
          if (alpha <= 0) continue;
          const footprint = point.covariance ? splatFrames.covariance(data, q, point.covariance, M) :
            covarianceSlots.map(k => data[q + k]);
          let position = point.position, shape = point.covariance ? footprint : [
            footprint[0], footprint[1], footprint[2], footprint[1], footprint[3], footprint[4], footprint[2], footprint[4], footprint[5]];
          if (scale !== 1) shape = shape.map(value => value * scale * scale);
          if (guide) {
            position = V.sub(position, guide.position);
            if (rule.project) {
              const n = guide.normal;
              position = V.mad(position, n, rule.lift - V.dot(position, n));
              const flat = M.id().map((a, k) => a - n[k / 3 | 0] * n[k % 3]);
              shape = M.mul(M.mul(flat, shape), flat).map((a, k) => a + .000001 * n[k / 3 | 0] * n[k % 3]);
            }
            position = M.app(inverse, position);
            shape = M.mul(M.mul(inverse, shape), inverseTranspose);
          }
          current.set(world.splatIds?.[index] ?? index, { position, shape, alpha: Math.min(1, alpha),
            color: rule.tint ?? data[q + 7] });
        }
        state.frames = state.frames.filter(prior => time - prior.time < rule.duration);
        for (const prior of state.frames.filter(prior => prior.time < time).slice(-rule.copies)) {
          const fade = rule.opacity * (1 - (time - prior.time) / rule.duration);
          for (const [id, dab] of prior.dabs) {
            if (fade * dab.alpha < transparentCutoff) continue;
            const now = current.get(id);
            if (now && V.dist(now.position, dab.position) <= rule.motionThreshold &&
                matrixSlots.every(k => Math.abs(now.shape[k] - dab.shape[k]) <= rule.motionThreshold ** 2)) continue;
            const position = guide ? V.add(guide.position, M.app(guide.anchor, dab.position)) : dab.position;
            const cov = guide ? M.mul(M.mul(guide.anchor, dab.shape), transpose) : dab.shape;
            rows.push(...position, fade * dab.alpha, cov[0], cov[1], cov[2], dab.color, cov[4], cov[5], cov[8], noDepth, 0, 0, 0, 0);
          }
        }
        const last = state.frames.at(-1);
        if (last?.time === time) state.frames.pop();
        if (!last || last.time === time || time - last.time >= rule.interval - 1e-9) state.frames.push({ time, dabs: current });
        // Keep the current pose alongside the retained poses so a repeated
        // draw at the same time produces the same trail.
        if (state.frames.length > rule.copies + 1) state.frames.shift();
      }
      return Float32Array.from(rows);
    }

    return Object.freeze({ frame, clear });
  }

  function birthProgress(q, data, grow, time, bornAt) {
    let age = (time - bornAt) * (grow?.rate ?? 1);
    if (grow?.loop > 0) age -= Math.floor(age / grow.loop) * grow.loop;
    return K.clamp((age - data[q + 15]) / (grow?.fade ?? .5), 0, 1);
  }

  function smooth(lo, hi, value) {
    const t = K.clamp((value - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function appearance(q, data, grow, time, bornAt) {
    const packed = data[q + 11] | 0, kind = packed & 15;
    const phase = data[q + 12], speed = data[q + 13], range = data[q + 14], extra = data[q + 15];
    let alpha = data[q + 3], scale = 1;
    if (kind === 1) alpha *= .62 + .38 * Math.sin(time * speed + phase);
    else if (kind === 7 && extra !== LightSchedule.emissionMarker) alpha *= .82 + .18 * Math.sin(time * speed + phase);
    if (range && (kind === 2 || kind === 3 || kind === 15)) {
      const tick = time * speed / range + phase, step = tick - Math.floor(tick);
      if (kind === 2) { alpha *= 1 - step * step; scale *= 1 + step * extra; }
      else if (kind === 3) { alpha *= (1 - step) * smooth(0, .1, step); scale *= .6 + step * extra; }
      else alpha *= smooth(0, .05, step) * (1 - smooth(.92, 1, step));
    }
    if (packed & 512) {
      const growth = birthProgress(q, data, grow, time, bornAt);
      scale *= growth * (2 - growth);
      if (growth <= 0) alpha = 0;
    }
    return { alpha, scale };
  }

  function append(world, rows) {
    if (!rows.length) return world;
    const count = world.count + rows.length / stride;
    const data = new Float32Array(count * stride);
    data.set(world.data.subarray(0, world.count * stride));
    data.set(rows, world.count * stride);
    const result = { ...world, count, data };
    // These fixed-stride tables are uploaded for the whole draw stream.
    for (const [key, width] of [['pix', 8], ['fine', 12], ['opticalSplats', 12], ['materialPixelStyles', 4]]) {
      if (!world[key]) continue;
      result[key] = new Float32Array(count * width);
      result[key].set(world[key].subarray(0, world.count * width));
    }
    return result;
  }

  K.afterimages = Object.freeze({ prepare, history, append });
})(KIT);
