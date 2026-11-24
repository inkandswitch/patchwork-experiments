/* Camera constraints, framing checks and depth bands on the native art grid. */
const CameraStaging = (() => {
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const lens = typeof CameraLens === 'undefined' ? require('./camera-lens.js') : CameraLens;
  const defaultSensorHeight = lens.defaultSensorHeight, turn = 2 * Math.PI, halfTurn = Math.PI / 2;
  const finite = Number.isFinite;
  const between = (n, low, high) => finite(n) && low <= n && n <= high;
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const check = (ok, message) => { if (!ok) throw new RangeError('Camera staging: ' + message); };
  const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => allowed.includes(key));
  const pair = value => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
  const interval = (value, min, max) => pair(value) && value[0] >= min && value[1] <= max && value[0] <= value[1];
  const flag = value => value === undefined || typeof value === 'boolean';
  const integer = (value, min, max) => Number.isSafeInteger(value) && between(value, min, max);

  const fieldOfView = lens.fieldOfView;

  function orbit(value, minimumDistance = 0) {
    if (value === undefined) return null;
    check(keys(value, ['yaw', 'pitch', 'distance']), 'invalid orbit constraints');
    const { yaw, pitch, distance } = value;
    check(yaw === undefined || interval(yaw, -1e6, 1e6) && yaw[1] - yaw[0] <= turn, 'yaw needs an increasing interval of at most one revolution');
    check(pitch === undefined || interval(pitch, -halfTurn, halfTurn), 'pitch must be within ±π/2');
    check(distance === undefined || interval(distance, minimumDistance, Infinity) && distance[0] > 0,
      'distance needs an increasing positive interval');
    return {
      ...(yaw && { yaw: yaw.slice() }), ...(pitch && { pitch: pitch.slice() }), ...(distance && { distance: distance.slice() })
    };
  }

  function constrain(camera, limits) {
    return lens.constrain(camera, limits);
  }

  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    check(keys(value, ['orbit', 'guides', 'subjects', 'depthOfField']), 'invalid staging profile');
    const { guides = {}, subjects = [], depthOfField = [] } = value;
    check(keys(guides, ['safe', 'thirds', 'center']) && flag(guides.thirds) && flag(guides.center), 'invalid framing guides');
    const safe = Array.isArray(guides.safe) ? guides.safe : [guides.safe ?? .1, guides.safe ?? .1];
    check(pair(safe) && safe.every(n => n >= 0 && n < .5), 'safe margin must be in [0, .5) per axis');
    check(Array.isArray(subjects) && subjects.length <= 32, 'expected up to 32 framing subjects');
    const names = new Set();
    const rows = Array.from(subjects, subject => {
      check(keys(subject, ['id', 'select', 'minPixels', 'minWidth', 'minHeight']), 'invalid framing subject');
      const { id, select, minPixels = 1, minWidth = 1, minHeight = 1 } = subject;
      check(targets.name(id) && !names.has(id) && [minPixels, minWidth, minHeight].every(n => integer(n, 1, 1e8)),
        'subject IDs must be unique and minimum pixel counts positive');
      names.add(id);
      return { id, select: targets.prepare(select), minPixels, minWidth, minHeight };
    });
    check(depthOfField === false || Array.isArray(depthOfField) && depthOfField.length <= 16, 'expected up to 16 focus bands');
    const bands = Array.from(depthOfField || [], band => {
      check(keys(band, ['depth', 'radius', 'feather']), 'invalid focus band');
      const { depth, radius, feather = 0 } = band;
      check(interval(depth, 0, Infinity) && depth[0] < depth[1] && between(radius, 0, 8) &&
        between(feather, 0, (depth[1] - depth[0]) / 2), 'focus band needs a depth interval, radius in [0, 8] and a fitting feather');
      return { depth: depth.slice(), radius, feather };
    }).sort((a,b) => a.depth[0] - b.depth[0]);
    check(bands.every((band, i) => !i || bands[i-1].depth[1] <= band.depth[0]), 'focus bands cannot overlap');
    return { orbit: orbit(value.orbit), guides: { safe: safe.slice(), thirds: guides.thirds ?? true, center: guides.center ?? false },
      subjects: rows, depthOfField: bands };
  }

  function inspect(settings, world, { w, h, splatId }) {
    // Bounds use exclusive right and bottom edges on the actual owner buffer.
    const [sx, sy] = settings.guides.safe;
    const safe = [Math.floor(w * sx), Math.floor(h * sy), w - Math.floor(w * sx), h - Math.floor(h * sy)];
    const rows = settings.subjects.map(({ id }) => ({ id, pixels: 0, bounds: [w, h, 0, 0] }));
    if (rows.length) {
      const index = targets.index(world), matches = new Map(), groups = new Map();
      for (let p = 0; p < w * h; p++) {
        const owner = splatId[p];
        if (!owner || owner > world.count) continue;
        if (!matches.has(owner)) {
          const target = index.row(owner - 1);
          if (!groups.has(target)) groups.set(target, rows.filter((_, i) => targets.matches(settings.subjects[i].select, target)));
          matches.set(owner, groups.get(target));
        }
        const x = p % w, y = Math.floor(p / w);
        for (const row of matches.get(owner)) {
          row.pixels++;
          const b = row.bounds;
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
          b[2] = Math.max(b[2], x + 1); b[3] = Math.max(b[3], y + 1);
        }
      }
    }
    for (const [i, row] of rows.entries()) {
      const [x0,y0,x1,y1] = row.bounds;
      const { minPixels, minWidth, minHeight } = settings.subjects[i];
      row.minimum = { pixels: minPixels, width: minWidth, height: minHeight };
      row.issues = [];
      if (!row.pixels) {
        row.bounds = null;
        row.issues.push('not-visible');
        continue;
      }
      if (x0 === 0 || y0 === 0 || x1 === w || y1 === h) row.issues.push('touches-crop');
      if (x0 < safe[0] || y0 < safe[1] || x1 > safe[2] || y1 > safe[3]) row.issues.push('outside-safe-area');
      if (row.pixels < minPixels || x1 - x0 < minWidth || y1 - y0 < minHeight) row.issues.push('undersized');
    }
    return { width: w, height: h, safe, guides: settings.guides, subjects: rows, ok: rows.every(row => !row.issues.length) };
  }

  function guideCommands(report, w = report.width, h = report.height) {
    const dx = w / report.width, dy = h / report.height;
    const path = (points, color, closed = false) => ({ type: 'path', points, color, closed });
    const bounds = ([x0,y0,x1,y1], color) => {
      x0 = Math.min(w - .5, x0 * dx + .5); y0 = Math.min(h - .5, y0 * dy + .5);
      x1 = Math.max(x0, x1 * dx - .5); y1 = Math.max(y0, y1 * dy - .5);
      return path([[x0,y0],[x1,y0],[x1,y1],[x0,y1]], color, true);
    };
    const draw = [];
    if (report.guides.thirds) for (const u of [1/3, 2/3]) {
      draw.push(path([[w*u,0],[w*u,h]], '#ecf3fc55'), path([[0,h*u],[w,h*u]], '#ecf3fc55'));
    }
    if (report.guides.center) {
      draw.push(path([[Math.max(0,w/2-4),h/2],[Math.min(w,w/2+4),h/2]], '#ecf3fcaa'),
        path([[w/2,Math.max(0,h/2-4)],[w/2,Math.min(h,h/2+4)]], '#ecf3fcaa'));
    }
    draw.push(bounds(report.safe, '#f7e6adbb'));
    for (const row of report.subjects) if (row.bounds) draw.push(bounds(row.bounds, row.issues.length ? '#ff906f' : '#9de8c0'));
    return draw;
  }

  function overlay(frame) {
    if (!frame.cameraStaging) return frame;
    const { w,h } = frame;
    const plan = composite.prepare({ layers: [{ draw: guideCommands(frame.cameraStaging, w, h) }] }, w, h);
    return { ...frame, ...composite.compose(frame, composite.layers(plan), w, h, 'nearest') };
  }

  function focus(frame, depth, bands, setback = 0, paletteResolved = false) {
    if (!bands.some(band => band.radius)) return frame;
    const { w, h, rgb, alpha } = frame, output = rgb.slice(), bandAt = new Uint8Array(w*h);
    for (let p = 0; p < depth.length; p++) {
      const z = depth[p] - setback;
      const band = bands.findIndex(({ depth: [near, far] }) => near <= z && z < far);
      if (band >= 0) bandAt[p] = band + 1;
    }
    let blurredPixels = 0;
    for (let p = 0; p < w*h; p++) {
      const band = bands[bandAt[p] - 1];
      if (!band?.radius || alpha?.[p] === 0) continue;
      const z = depth[p] - setback, [near, far] = band.depth;
      const ramp = band.feather ? clamp(Math.min(z-near, far-z) / band.feather, 0, 1) : 1;
      const radius = band.radius * ramp, limit = Math.ceil(radius);
      const tolerance = Math.max(.12, .06 * z);
      const x = p % w, y = Math.floor(p / w), samples = [];
      let r = 0, g = 0, b = 0, total = 0;
      for (let dy = Math.max(-limit,-y); dy <= Math.min(limit,h-1-y); dy++) {
        for (let dx = Math.max(-limit,-x); dx <= Math.min(limit,w-1-x); dx++) {
          const q = p + dy*w + dx;
          if (bandAt[p] !== bandAt[q] || Math.abs(depth[p] - depth[q]) > tolerance) continue;
          const weight = clamp(radius + 1 - Math.hypot(dx,dy), 0, 1) * ((alpha?.[q] ?? 255) / 255);
          if (!weight) continue;
          const k = q*3;
          r += weight * rgb[k]; g += weight * rgb[k+1]; b += weight * rgb[k+2]; total += weight;
          if (paletteResolved) samples.push(k);
        }
      }
      if (!total) continue;
      r /= total; g /= total; b /= total;
      const k = p*3;
      if (paletteResolved) {
        let best = k, error = Infinity;
        for (const q of samples) {
          const d = (rgb[q]-r)**2 + (rgb[q+1]-g)**2 + (rgb[q+2]-b)**2;
          if (d < error) { best = q; error = d; }
        }
        output.set(rgb.subarray(best,best+3), k);
      } else {
        output[k] = Math.round(r); output[k+1] = Math.round(g); output[k+2] = Math.round(b);
      }
      if (output[k] !== rgb[k] || output[k+1] !== rgb[k+1] || output[k+2] !== rgb[k+2]) blurredPixels++;
    }
    return { ...frame, rgb: output, focusPixels: blurredPixels };
  }

  return Object.freeze({ defaultSensorHeight, fieldOfView, focalLength: lens.focalLength, lens: lens.resolve, view: lens.view, composition: lens.composition, frameTarget: lens.target, orbit, constrain, prepare, inspect, guideCommands, overlay, focus });
})();
if (typeof module !== 'undefined') module.exports = CameraStaging;
