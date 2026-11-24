/* Target inspection is a frame layer: no geometry mutation or camera takeover. */
const TargetInspection = (() => {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const value = (v, context) => (typeof v === 'function' ? v(context) : v);
  const point = v =>
    (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const rect = v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0;
  const finite = (v, fallback, lo, hi) => {
    v ??= fallback;
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError('Invalid inspection numeric setting');
    return v;
  };
  const cache = new WeakMap();
  const defaultGlyphs = Object.freeze({});
  function prepare(definition) {
    if (definition == null || definition === false) return null;
    if (cache.has(definition)) return cache.get(definition);
    if (!definition || !Array.isArray(definition.targets) || definition.targets.length > 256)
      throw new TypeError('Inspection needs at most 256 named targets');
    const ids = new Set();
    const style = item => {
      const s = { ...definition.style, ...item.style };
      const color = s.color ?? '#79ecdd';
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError('Inspection color must be #rrggbb');
      return Object.freeze({
        color,
        rgb: [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255),
        scale: finite(s.scale, 1, 1, 4),
        corner: finite(s.corner, 8, 1, 40),
        width: finite(s.width, 1, 0.5, 8),
        padding: finite(s.padding, 4, 0, 40)
      });
    };
    const targets = definition.targets.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id))
        throw new TypeError('Inspection target ids must be unique nonempty strings');
      ids.add(item.id);
      if (!(point(item.at) || typeof item.at === 'function' || (item.at && typeof item.at === 'object')))
        throw new TypeError('Inspection target needs a world anchor');
      if (item.halfSize && (!point(item.halfSize) || item.halfSize.some(v => v < 0)))
        throw new RangeError('Inspection halfSize needs three nonnegative values');
      if (
        item.probes != null &&
        typeof item.probes !== 'function' &&
        (!Array.isArray(item.probes) || !item.probes.length || item.probes.length > 5 || !item.probes.every(point))
      )
        throw new TypeError('Inspection probes need 1–5 world points');
      if (item.normal && !point(item.normal)) throw new TypeError('Invalid inspection facing normal');
      if (item.occlusion != null && !['depth', 'none'].includes(item.occlusion))
        throw new TypeError('Invalid inspection occlusion');
      const magnify = item.magnify === true ? {} : item.magnify;
      if (magnify && (typeof magnify !== 'object' || (magnify.rect && !rect(magnify.rect)) ||
          magnify.enabled !== undefined && typeof magnify.enabled !== 'boolean'))
        throw new TypeError('Invalid inspection magnifier');
      const ripple =
        item.ripple === false
          ? null
          : { period: 3.5, speed: 65, radius: 85, width: 15, cell: 8, chars: '0123456789:+*', ...item.ripple };
      if (ripple) {
        for (const key of ['period', 'speed', 'radius', 'width', 'cell']) finite(ripple[key], null, 0.01, 4096);
        if (typeof ripple.chars !== 'string' || !ripple.chars.length || [...ripple.chars].length > 64)
          throw new TypeError('Inspection ripple needs 1–64 glyphs');
      }
      return Object.freeze({
        ...item,
        style: style(item),
        ripple: ripple && Object.freeze(ripple),
        magnify: magnify && Object.freeze({ ...magnify, zoom: finite(magnify.zoom, 2.5, 1, 32) }),
        depthBias: finite(item.depthBias, 0.08, 0, 100),
        priority: finite(item.priority, 0, -1e6, 1e6)
      });
    });
    const settings = Object.freeze({
      targets: Object.freeze(targets),
      maxTargets: finite(definition.maxTargets, 12, 1, 32),
      glyphs: definition.glyphs ?? defaultGlyphs,
      maxMagnifiers: finite(definition.maxMagnifiers, 1, 0, 4)
    });
    if (targets.some(t => !Number.isInteger(t.style.scale)))
      throw new RangeError('Inspection font scale must be an integer');
    if (!Number.isInteger(settings.maxTargets) || !Number.isInteger(settings.maxMagnifiers))
      throw new RangeError('Inspection budgets must be integers');
    cache.set(definition, settings);
    return settings;
  }
  function projector(camera) {
    const { view: v, tangent, aspect, ortho, clipNear = 0.4, clipFar = 400, depthRange } = camera;
    if (
      !v ||
      !Number.isFinite(tangent) ||
      tangent <= 0 ||
      !Number.isFinite(aspect) ||
      aspect <= 0 ||
      !depthRange ||
      !(depthRange[1] > depthRange[0])
    )
      throw new TypeError('Inspection projector needs a renderer camera');
    return p => {
      if (!point(p)) throw new TypeError('Inspection anchor must resolve to a finite world point');
      const x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12],
        y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
      const z = -(v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14]);
      if (z < clipNear || z > clipFar) return null;
      const f = ortho ? tangent : tangent * z;
      return [0.5 + x / (2 * f * aspect), 0.5 - y / (2 * f), (z - depthRange[0]) / (depthRange[1] - depthRange[0]), z];
    };
  }
  function plan(settings, context) {
    if (!settings) return { targets: [], diagnostics: [] };
    const { world, time = 0, width, height, camera, focus, resolve } = context;
    if (![width, height].every(v => Number.isSafeInteger(v) && v > 0))
      throw new RangeError('Inspection needs a positive frame size');
    const project = context.project ?? projector(camera),
      targets = [],
      diagnostics = [];
    const ctx = { ...context, time, project };
    const ordered = [...settings.targets].sort(
      (a, b) => Number(b.id === focus) - Number(a.id === focus) || b.priority - a.priority
    );
    let magnifiers = 0;
    for (const target of ordered) {
      const reject = reason => diagnostics.push({ id: target.id, reason });
      const active = value(target.active ?? true, ctx);
      if (typeof active !== 'boolean') throw new TypeError('Inspection active must resolve to a boolean');
      if (!active) {
        reject('inactive');
        continue;
      }
      const coverage = finite(value(target.coverage, ctx), 1, 0, 1);
      if (!coverage) {
        reject('hidden');
        continue;
      }
      const at = value(target.at, ctx),
        resolved = point(at) ? { at } : resolve?.(at, ctx);
      if (!resolved) {
        reject('unresolved');
        continue;
      }
      const p = project(resolved.at);
      if (!p) {
        reject('clipped');
        continue;
      }
      const half = target.halfSize ?? resolved.halfSize ?? [0.12, 0.12, 0.12];
      const normal = target.normal ?? resolved.normal;
      if (normal && camera) {
        const toward = camera.ortho
          ? [camera.view[2], camera.view[6], camera.view[10]]
          : camera.eye.map((v, i) => v - resolved.at[i]);
        if (normal.reduce((sum, v, i) => sum + v * toward[i], 0) <= 0) {
          reject('back-facing');
          continue;
        }
      }
      const corners = [];
      for (let i = 0; i < 8; i++) {
        const q = project(resolved.at.map((v, k) => v + half[k] * ((i >> k) & 1 ? 1 : -1)));
        if (q) corners.push(q);
      }
      if (corners.length !== 8) {
        reject('clipped');
        continue;
      }
      const lo = [0, 1].map(k => Math.min(...corners.map(v => v[k]))),
        hi = [0, 1].map(k => Math.max(...corners.map(v => v[k])));
      if (hi[0] < 0 || lo[0] > 1 || hi[1] < 0 || lo[1] > 1 || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) {
        reject('offscreen');
        continue;
      }
      if (targets.length >= settings.maxTargets) {
        reject('budget');
        continue;
      }
      const st = target.style,
        pad = st.padding;
      const box = [
        clamp(lo[0]) * width - pad,
        clamp(lo[1]) * height - pad,
        (clamp(hi[0]) - clamp(lo[0])) * width + pad * 2,
        (clamp(hi[1]) - clamp(lo[1])) * height + pad * 2
      ];
      box[2] = Math.max(box[2], 12);
      box[3] = Math.max(box[3], 12);
      const anchor = [p[0] * width, p[1] * height];
      // Front of the bound avoids treating the inspected object's own surface as an occluder.
      const depth = Math.min(...corners.map(q => q[2])),
        range = camera?.depthRange;
      const bias = range ? target.depthBias / (range[1] - range[0]) : target.depthBias;
      const uv = [
        [p[0], p[1]],
        ...[
          [0.3, 0.3],
          [0.7, 0.3],
          [0.3, 0.7],
          [0.7, 0.7]
        ].map(([x, y]) => [lo[0] + (hi[0] - lo[0]) * x, lo[1] + (hi[1] - lo[1]) * y])
      ];
      let probes = uv.map(q => [clamp(q[0]), clamp(q[1]), depth, bias]);
      if (target.probes) {
        const supplied = value(target.probes, ctx);
        if (!Array.isArray(supplied) || !supplied.length || supplied.length > 5 || !supplied.every(point))
          throw new TypeError('Inspection probes need 1–5 world points');
        probes = supplied
          .map(project)
          .filter(q => q && q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1)
          .map(q => [q[0], q[1], q[2], bias]);
        if (!probes.length) {
          reject('clipped');
          continue;
        }
      }
      const text = [value(target.label ?? target.id, ctx), value(target.detail ?? '', ctx)].map(v =>
        [...String(v ?? '')].slice(0, 80).join('')
      );
      const labelSize = [
        Math.min(80, Math.max(...text.map(v => [...v].length))) * 6 * st.scale + 8,
        text.filter(Boolean).length * 9 * st.scale + 6
      ];
      labelSize[0] = Math.min(width, labelSize[0]);
      labelSize[1] = Math.min(height, labelSize[1]);
      const label = [
        clamp(box[0] + box[2] + 14, 2, Math.max(2, width - labelSize[0] - 2)),
        clamp(box[1] - 4, 2, Math.max(2, height - labelSize[1] - 2)),
        ...labelSize
      ];
      if (label[0] < box[0] + box[2] + 8) label[0] = Math.max(2, box[0] - label[2] - 14);
      const item = {
        id: target.id,
        target,
        at: resolved.at,
        anchor,
        rect: box,
        probes,
        coverage,
        style: st,
        text,
        label,
        ripple: target.ripple,
        phase: time,
        occlusion: target.occlusion !== 'none'
      };
      if (target.magnify && target.magnify.enabled !== false && magnifiers < settings.maxMagnifiers) {
        const m = target.magnify,
          r = m.rect ?? [0.72, 0.08, 0.24, 0.24];
        const pane = [r[0] * width, r[1] * height, r[2] * width, r[3] * height];
        if (pane[0] < 0 || pane[1] < 0 || pane[0] + pane[2] > width || pane[1] + pane[3] > height)
          throw new RangeError('Inspection magnifier must fit the frame');
        const crop = [pane[2] / m.zoom, pane[3] / m.zoom];
        item.lens = {
          rect: pane,
          crop: [
            clamp(anchor[0] - crop[0] / 2, 0, Math.max(0, width - crop[0])),
            clamp(anchor[1] - crop[1] / 2, 0, Math.max(0, height - crop[1])),
            ...crop
          ]
        };
        magnifiers++;
      }
      targets.push(item);
      diagnostics.push({ id: target.id, reason: 'candidate' });
    }
    return { width, height, time, targets, diagnostics };
  }
  function visibility(item, depthAt) {
    if (!item.occlusion || !depthAt) return item.coverage;
    let visible = 0;
    for (const [u, v, z, bias] of item.probes) if (depthAt(u, v) + bias >= z) visible++;
    return (visible / item.probes.length) * item.coverage;
  }
  function font(atlas, custom = {}) {
    const glyphs = new Map();
    atlas.chars.forEach((ch, i) => {
      if (glyphs.has(ch)) return;
      const rows = new Uint8Array(48),
        x = (i % atlas.per) * 6,
        y = Math.floor(i / atlas.per) * 8;
      for (let v = 0; v < 8; v++)
        for (let u = 0; u < 6; u++) rows[v * 6 + u] = atlas.font.data[(y + v) * atlas.font.w + x + u];
      glyphs.set(ch, rows);
    });
    for (const [ch, rows] of Object.entries(custom)) {
      if (
        [...ch].length !== 1 ||
        !Array.isArray(rows) ||
        rows.length > 8 ||
        rows.some(row => typeof row !== 'string' || row.length > 6)
      )
        throw new TypeError('Custom inspection glyphs need up to eight rows of six pixels');
      const data = new Uint8Array(48);
      rows.forEach((row, y) =>
        [...row].forEach((v, x) => {
          data[y * 6 + x] = v === '#' ? 255 : 0;
        })
      );
      glyphs.set(ch, data);
    }
    return glyphs;
  }
  function labels(item, glyphs) {
    const w = Math.ceil(item.label[2]),
      h = Math.ceil(item.label[3]),
      data = new Uint8Array(w * h * 4),
      s = item.style.scale;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        data.set([8, 17, 24, 215], p);
      }
    item.text.filter(Boolean).forEach((line, row) =>
      [...line].forEach((ch, col) => {
        const bits = glyphs.get(ch) ?? glyphs.get('?');
        for (let y = 0; y < 8 * s; y++)
          for (let x = 0; x < 6 * s; x++)
            if (bits?.[Math.floor(y / s) * 6 + Math.floor(x / s)]) {
              const xx = 4 + col * 6 * s + x,
                yy = 3 + row * 9 * s + y;
              if (xx < w && yy < h)
                data.set(item.style.rgb.map(v => Math.round(v * 255)).concat(255), (yy * w + xx) * 4);
            }
      })
    );
    return { w, h, data };
  }
  const segment = (p, a, b) => {
    const x = b[0] - a[0],
      y = b[1] - a[1],
      t = clamp(((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y || 1));
    return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
  };
  function ink(p, item) {
    const [x, y, w, h] = item.rect,
      c = item.style.corner,
      d = item.style.width / 2;
    let line = false;
    for (const a of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1]
    ])
      line ||=
        segment(p, a, [a[0] + a[2] * Math.min(c, w / 2), a[1]]) <= d ||
        segment(p, a, [a[0], a[1] + a[3] * Math.min(c, h / 2)]) <= d;
    const a = item.anchor;
    line ||=
      (Math.abs(p[1] - a[1]) <= d && Math.abs(p[0] - a[0]) >= 3 && Math.abs(p[0] - a[0]) <= 7) ||
      (Math.abs(p[0] - a[0]) <= d && Math.abs(p[1] - a[1]) >= 3 && Math.abs(p[1] - a[1]) <= 7);
    line ||= segment(p, [x + w, y], item.label) <= d;
    if (item.lens) {
      const r = item.lens.rect;
      line ||=
        (Math.min(Math.abs(p[0] - r[0]), Math.abs(p[0] - r[0] - r[2])) <= d && p[1] >= r[1] && p[1] <= r[1] + r[3]) ||
        (Math.min(Math.abs(p[1] - r[1]), Math.abs(p[1] - r[1] - r[3])) <= d && p[0] >= r[0] && p[0] <= r[0] + r[2]);
    }
    return line;
  }
  const inside = (x, y, r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
  function compose(frame, plan, glyphs, depthAt) {
    const rgb = frame.rgb.slice(),
      alpha = frame.alpha?.slice(),
      source = frame.rgb,
      w = frame.w,
      h = frame.h,
      states = [];
    const blend = (x, y, color, a) => {
      const p = y * w + x,
        q = p * 3,
        below = alpha ? alpha[p] / 255 : 1,
        total = a + below * (1 - a);
      if (total)
        for (let k = 0; k < 3; k++) rgb[q + k] = Math.round((rgb[q + k] * below * (1 - a) + color[k] * a) / total);
      if (alpha) alpha[p] = Math.round(total * 255);
    };
    for (const item of plan.targets) {
      const amount = visibility(item, depthAt);
      states.push({ id: item.id, visibility: amount });
      if (amount <= 0) continue;
      const label = labels(item, glyphs),
        color = item.style.rgb.map(v => v * 255),
        rip = item.ripple;
      const radius = rip ? Math.min(rip.radius, (plan.time % rip.period) * rip.speed) : 0;
      // CPU path favors clarity and parity; native renders the bounded regions on the GPU.
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = [x + 0.5, y + 0.5];
          if (item.lens && inside(...p, item.lens.rect)) {
            const r = item.lens.rect,
              c = item.lens.crop,
              sx = clamp(Math.floor(c[0] + ((p[0] - r[0]) / r[2]) * c[2]), 0, w - 1),
              sy = clamp(Math.floor(c[1] + ((p[1] - r[1]) / r[3]) * c[3]), 0, h - 1),
              q = (sy * w + sx) * 3;
            blend(x, y, source.subarray(q, q + 3), amount * (frame.alpha ? frame.alpha[sy * w + sx] / 255 : 1));
          }
          if (rip) {
            const cx = Math.floor(x / rip.cell),
              cy = Math.floor(y / rip.cell),
              dist = Math.hypot((cx + 0.5) * rip.cell - item.anchor[0], (cy + 0.5) * rip.cell - item.anchor[1]);
            const wave = Math.max(0, 1 - Math.abs(dist - radius) / rip.width) * (1 - radius / rip.radius);
            const chars = [...rip.chars],
              index = (((cx * 13 + cy * 7 + Math.floor(plan.time * 7)) % chars.length) + chars.length) % chars.length,
              bits = glyphs.get(chars[index]);
            const u = Math.floor(((x % rip.cell) / rip.cell) * 6),
              v = Math.floor(((y % rip.cell) / rip.cell) * 8);
            if (wave > 0 && bits?.[v * 6 + u]) blend(x, y, color, wave * amount * 0.65);
          }
          if (ink(p, item)) blend(x, y, color, amount);
          if (inside(...p, item.label)) {
            const q = (Math.floor(p[1] - item.label[1]) * label.w + Math.floor(p[0] - item.label[0])) * 4;
            blend(x, y, label.data.subarray(q, q + 3), (label.data[q + 3] / 255) * amount);
          }
        }
    }
    return { ...frame, rgb, ...(alpha && { alpha }), inspection: { targets: states, diagnostics: plan.diagnostics } };
  }
  return Object.freeze({ prepare, projector, plan, visibility, font, labels, compose });
})();
if (typeof module !== 'undefined') module.exports = TargetInspection;
