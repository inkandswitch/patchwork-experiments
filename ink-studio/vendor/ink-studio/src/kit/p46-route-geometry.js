/* Arc-length routes through planar obstacles and clearance-aware corner splines. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-9,
    point = (p, n) => Array.isArray(p) && p.length === n && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    positive = x => Number.isFinite(x) && x > EPS,
    clamp = t => Math.max(0, Math.min(1, t)),
    interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  function visibility(start, end, obstacles, options) {
    const { points, ...result } = RouteVisibility.find(start, end, obstacles, options);
    return Object.freeze(points ? { ...result, route: P.routes.polyline(points) } : result);
  }

  function spline(route, { radius = 0.5, spacing = 0.1, clearance, minClearance = 0, keepOut, height,
    maxDeviation = Infinity, maxSlope = Infinity, attempts = 8, maxTests = 1500000 } = {}) {
    const input = route?.points;
    if (
      !Array.isArray(input) || input.length < 2 || input.length > 4097 || !input.every(p => point(p, 3)) ||
      !positive(radius) || !positive(spacing) || !Number.isFinite(minClearance) || minClearance < 0 ||
      !(maxDeviation >= 0) || !(maxSlope >= 0) ||
      [clearance, keepOut, height].some(fn => fn !== undefined && typeof fn !== 'function') ||
      !limit(attempts, 1, 32) || !limit(maxTests, 1, 6000000)
    ) throw new Error('Route splines need a polyline, sample and clearance controls, and a work budget');
    const exhausted = Symbol('spline budget'),
      work = { tests: 0, rounded: 0, retained: 0 },
      result = (status, data = {}) => Object.freeze({ status, ...data, work: Object.freeze({ ...work }) }),
      lerp = (a, b, t) => V.mad(a, V.sub(b, a), t);
    function permitted(p) {
      if (work.tests >= maxTests) throw exhausted;
      work.tests++;
      const [x, y, z] = p;
      if (height) {
        const ground = height(x, z);
        if (!Number.isFinite(ground) || Math.abs(y - ground) > maxDeviation) return false;
      }
      return (!clearance || clearance(x, y, z) >= minClearance) && (!keepOut || !keepOut(x, z, y));
    }
    function safe(a, b) {
      const length = V.dist(a, b), run = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (Math.abs(b[1] - a[1]) > (run || EPS) * maxSlope + EPS) return false;
      const steps = Math.max(2, Math.ceil(length / spacing));
      for (let i = 0; i <= steps; i++) if (!permitted(i === steps ? b : lerp(a, b, i / steps))) return false;
      return true;
    }
    function fitted(a, b, c, amount) {
      const u = V.dist(a, b), v = V.dist(b, c);
      if (u <= EPS || v <= EPS) return null;
      const lead = lerp(b, a, Math.min(u * 0.45, amount) / u),
        tail = lerp(b, c, Math.min(v * 0.45, amount) / v),
        count = Math.max(3, Math.ceil((V.dist(lead, b) + V.dist(b, tail)) / spacing));
      if (count > 4096) throw exhausted;
      const points = [];
      for (let i = 0; i <= count; i++) {
        const t = i / count, p = lerp(lerp(lead, b, t), lerp(b, tail, t), t);
        if (i && !safe(points[i - 1], p)) return null;
        points.push(p);
      }
      return { points, controls: [lead, b.slice(), tail] };
    }
    try {
      const output = [input[0]], quadratics = [];
      for (let i = 1; i < input.length; i++) {
        if (!safe(input[i - 1], input[i])) return result('blocked');
      }
      for (let i = 1; i < input.length - 1; i++) {
        const a = input[i - 1], b = input[i], c = input[i + 1],
          directions = [V.norm(V.sub(b, a)), V.norm(V.sub(c, b))];
        let bend = null;
        const turn = V.dot(...directions);
        if (turn > -1 + EPS && turn < 1 - EPS) {
          for (let k = 0, trim = radius; k < attempts && trim > EPS; k++, trim *= 0.5) {
            bend = fitted(a, b, c, trim);
            if (bend) break;
          }
        }
        if (bend) {
          output.push(...bend.points);
          quadratics.push(bend.controls);
          work.rounded++;
        } else {
          output.push(b);
          work.retained++;
        }
        if (output.length >= 4097) return result('budget');
      }
      output.push(input.at(-1));
      if (output.some((p, i) => i > 0 && !safe(output[i - 1], p))) return result('blocked');
      return result('ok', { route: P.routes.polyline(output), quadratics: P.data.freeze(quadratics) });
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  const {convexFootprint,sweep,sweepPath,elevationProfile,guideElevation,guideVisibility,prismVisibility,profileSection,sectionHeightBands,elevationFrame}=RouteVisibility;
  Object.assign(P.routes, {visibility,spline,convexFootprint,sweep,sweepPath,elevationProfile,guideElevation,guideVisibility,prismVisibility,profileSection,sectionHeightBands,elevationFrame});
})(KIT);
