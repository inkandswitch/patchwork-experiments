/* View-weighted paint on retained world-space surface samples. */
const PaintCorrections = (() => {
  const colors = typeof ColorSpace === 'undefined' ? require('./color-space.js') : ColorSpace;
  const linear = colors.prepare('srgb', 'srgb-linear'), display = colors.prepare('srgb-linear', 'srgb');
  const marker = -1618033; // Reserved range slot on stationary correction splats.
  const rad = Math.PI / 180;
  const idOK = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const vec = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const clamp = x => Math.max(0, Math.min(1, x));
  const ease = x => (x = clamp(x), x * x * (3 - 2 * x));
  function normal(value) {
    const len = Math.hypot(...value);
    return len && Number.isFinite(len) ? value.map(x => x / len) : null;
  }
  const ray = (view, at) => (view.eye && normal(sub(view.eye, at))) || view.direction;

  function view(raw) {
    if (!record(raw) || !vec(raw.direction) || (raw.eye !== undefined && !vec(raw.eye)))
      throw new TypeError('A paint capture needs a direction toward the camera and an optional perspective eye');
    const direction = normal(raw.direction);
    if (!direction) throw new RangeError('A paint capture needs a nonzero direction');
    return { direction, ...(raw.eye && { eye: raw.eye.slice() }) };
  }
  function sameView(a, b) {
    const close = (left, right) => left && right ?
      Math.hypot(...sub(left, right)) < 1e-8 : left === right;
    return close(a.direction, b.direction) && close(a.eye, b.eye);
  }

  function region(raw) {
    if (raw == null) return undefined;
    if (!record(raw) || !vec(raw.min) || !vec(raw.max) || raw.min.some((x, i) => x > raw.max[i]))
      throw new TypeError('A paint region needs ordered world-space min and max coordinates');
    const { feather = 0 } = raw;
    if (!Number.isFinite(feather) || feather < 0) throw new RangeError('Paint region feather must be nonnegative');
    return { min: raw.min.slice(), max: raw.max.slice(), feather };
  }

  function layer(raw) {
    if (!record(raw) || !idOK(raw.id)) throw new TypeError('A paint layer needs a lowercase ID');
    const { id, time, angle = 65, feather = Math.min(35, angle), opacity = 1, decals = [] } = raw;
    if (time !== undefined && !Number.isFinite(time)) throw new RangeError('Paint capture time must be finite');
    if (!Number.isFinite(angle) || angle <= 0 || angle > 180 ||
        !Number.isFinite(feather) || feather < 0 || feather > angle)
      throw new RangeError('Paint angle must be in (0, 180] and feather between zero and the angle');
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new RangeError('Paint opacity must be between zero and one');
    if (!Array.isArray(decals) || !Array.from(decals).every(row =>
      Array.isArray(row) && (row.length === 7 || row.length === 8) && Array.from(row).every(Number.isFinite) &&
      Math.hypot(row[3], row[4], row[5]) > 0 && Number.isSafeInteger(row[6]) && row[6] >= 0 &&
      (row.length === 7 || row[7] >= 0 && row[7] <= 1)))
      throw new TypeError('A correction sample needs XYZ, a nonzero normal, a palette index and optional opacity');
    const box = region(raw.region);
    return { id, view: view(raw.view), ...(time !== undefined && { time }), angle, feather, opacity,
      ...(box && { region: box }), decals };
  }

  function layers(raw) {
    const list = raw?.layers ?? [];
    if (!Array.isArray(list)) throw new TypeError('Paint layers must be an array');
    const names = new Set();
    return Array.from(list, entry => {
      const result = layer(entry);
      if (names.has(result.id)) throw new Error('Duplicate paint layer ' + result.id);
      names.add(result.id);
      return result;
    });
  }

  function regionWeight(box, p) {
    if (!box) return 1;
    let d = Infinity;
    for (let i = 0; i < 3; i++) d = Math.min(d, p[i] - box.min[i], box.max[i] - p[i]);
    return d < 0 ? 0 : box.feather ? ease(d / box.feather) : 1;
  }

  function groups(raw, spacing) {
    if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError('Paint needs positive surface spacing');
    const descriptions = layers(raw), reach = spacing * .65;
    const cells = new Map(), result = [];
    for (const entry of descriptions) {
      const inner = Math.cos((entry.angle - entry.feather) * rad), outer = Math.cos(entry.angle * rad);
      for (const [x, y, z, nx, ny, nz, color, mask = 1] of entry.decals) {
        const at = [x, y, z], n = normal([nx, ny, nz]);
        const opacity = mask * entry.opacity * regionWeight(entry.region, at);
        if (!opacity || !n) continue;
        const [a, b, c] = at.map(v => Math.floor(v / reach));
        let best, near = reach ** 2;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
          const cell = cells.get([a + i, b + j, c + k].join('/'));
          if (!cell) continue;
          for (const g of cell) {
            const delta = sub(at, g.at), d = dot(delta, delta);
            if (d >= near || dot(n, g.n) < .85 || Math.abs(dot(delta, g.n)) > spacing * .25 ||
                g.samples.some(sample => sample.layer === entry.id)) continue;
            near = d;
            best = g;
          }
        }
        if (!best) {
          best = { at, n, samples: [] };
          const key = [a, b, c].join('/');
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(best);
          result.push(best);
        }
        best.samples.push({ layer: entry.id, toward: ray(entry.view, at), opacity, inner, outer, color });
      }
    }
    return result;
  }

  function bind(rows) {
    if (!rows.length) return undefined;
    return {
      marker, rows,
      dirtyRows: [...new Set(rows.map(row => Math.floor(row.index / 512)))],
      paint(data, palette, camera) {
        if (!camera) return false;
        const paletteRGB = Array.from(palette, hex =>
          linear([(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]));
        const rgb = [0, 0, 0], mixed = [0, 0, 0];
        let visible = false;
        for (const { at, n, samples, index } of rows) {
          const offset = index * 16;
          if (data[offset + 14] !== marker) continue;
          data[offset + 3] = 0;
          const direction = ray(camera, at), facing = dot(direction, n);
          if (facing <= 0) continue;
          let total = 0;
          rgb.fill(0);
          for (const sample of samples) {
            const shade = paletteRGB[sample.color], d = dot(direction, sample.toward);
            if (!shade || d < sample.outer) continue;
            const weight = sample.opacity * (d >= sample.inner ? 1 : ease((d - sample.outer) / (sample.inner - sample.outer)));
            total += weight;
            for (let i = 0; i < 3; i++) rgb[i] += shade[i] * weight;
          }
          if (!total) continue;
          const coverage = clamp(total) * ease(facing / .12);
          for (let i = 0; i < 3; i++) rgb[i] /= total;
          display(rgb, mixed);
          data[offset + 3] = .99 * coverage;
          data[offset + 7] = Math.round(mixed[0] * 255) + 256 * Math.round(mixed[1] * 255) + 65536 * Math.round(mixed[2] * 255);
          visible = true;
        }
        return visible;
      }
    };
  }
  return Object.freeze({ idOK, view, sameView, layer, layers, groups, bind, marker });
})();
if (typeof module !== 'undefined') module.exports = PaintCorrections;
