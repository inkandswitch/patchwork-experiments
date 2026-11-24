const ContributionRules = require('../src/contribution-rules.js');
const OpticalMaterials = require('../src/optical-materials.js');
const ShadowArt = require('../src/shadow-art.js');
const { surfacePoint } = require('./scene-optics.js');

const opaqueFlags = 16 | 32 | 64 | 128 | 256 | 2048 | 32768;
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = t => t*t*(3 - 2*t);
// One normal ray and two offset rings cover the near hemisphere. Weight the
// more upward ring more strongly, as in cosine-weighted ambient lighting.
const ring = (y, phase, weight) => Array.from({ length: 6 }, (_, i) => {
  const angle = (i + phase) * Math.PI / 3, radius = Math.sqrt(1 - y*y);
  return [Math.cos(angle)*radius, y, Math.sin(angle)*radius, weight];
});
const hemisphere = [[0, 1, 0, .12], ...ring(.78, 0, .09), ...ring(.35, .5, .34/6)];

function basis(n) {
  // A continuous orthonormal basis on each hemisphere. Its poles are along Y.
  const sign = n[1] < 0 ? -1 : 1, a = -1/(sign + n[1]), b = n[0]*n[2]*a;
  return [[1 + sign*n[0]*n[0]*a, -sign*n[0], sign*b], [b, -n[2], sign + n[2]*n[2]*a]];
}

function tensor(data, q, a, b) {
  return a[0]*(data[q+4]*b[0] + data[q+5]*b[1] + data[q+6]*b[2]) +
    a[1]*(data[q+5]*b[0] + data[q+8]*b[1] + data[q+9]*b[2]) +
    a[2]*(data[q+6]*b[0] + data[q+9]*b[1] + data[q+10]*b[2]);
}

function caster(data, row, continuous, edge, reach) {
  const { i, point, normal, density, scale } = row;
  const [u, v] = basis(normal), q = i*16;
  const uu = tensor(data, q, u, u)*scale, uv = tensor(data, q, u, v)*scale, vv = tensor(data, q, v, v)*scale;
  const det = uu*vv - uv*uv;
  if (!(det > 0)) return null;
  const margin = u.map((n,k) => {
    const m = v[k];
    return 3*Math.sqrt(Math.max(0, uu*n*n + 2*uv*n*m + vv*m*m)) + reach;
  });
  const bounds = { min: point.map((n,k) => n - margin[k]), max: point.map((n,k) => n + margin[k]) };
  if (![...bounds.min, ...bounds.max].every(Number.isFinite)) return null;
  return { i, point, normal, u, v, k0: vv/det, k1: -uv/det, k2: uu/det, bounds, density, continuous, edge };
}

function create(settings, world, data, { x, y, z, alpha, scale }, frameAt, coverageMode, rayAt, reveals) {
  const casts = ShadowArt.bind(settings, world, 'cast'), receives = ShadowArt.bind(settings, world, 'receive');
  const { reach, strength } = settings;
  const back = new Set(world.back ?? []), rows = [], blockers = [];
  for (let i = 0; i < world.count; i++) {
    const q = i*16, flags = Math.round(data[q+11]), style = world.materialPixelStyles?.[i*4] ?? 0;
    const mode = ContributionRules.materialCoverage(style, coverageMode);
    if (!(alpha[i] >= 1) || !Number.isFinite(alpha[i]) || y[i] < -30 || flags & opaqueFlags || back.has(i) ||
        mode === ContributionRules.softCoverage || reveals?.(i) || world.opticalSplats?.[i*OpticalMaterials.STRIDE+3] ||
        world.effectParticles?.some(({ first, count }) => i >= first && i < first+count)) continue;
    const canCast = !casts || casts(i), canReceive = !receives || receives(i);
    if (!canCast && !canReceive) continue;
    const { normal } = frameAt(i);
    if (!normal) continue;
    const row = { i, point: [x[i], y[i], z[i]], normal, density: alpha[i], scale: scale[i]**2 };
    if (!row.point.every(Number.isFinite)) continue;
    if (canReceive) {
      row.support = 3*Math.sqrt(Math.max(0, (data[q+4] + data[q+8] + data[q+10])*row.scale));
      rows[i] = row;
    }
    if (canCast) {
      const shape = caster(data, row, mode === ContributionRules.continuousCoverage, ContributionRules.materialEdge(style), reach);
      if (shape) {
        row.casts = true;
        blockers.push(shape);
      }
    }
  }
  if (!blockers.length || !rows.length) return null;
  const { pointIndex } = require('../index.js').load().KIT.procedural.spatial;
  const nearby = pointIndex(blockers);
  const bias = reach*.025, cache = [];

  function directions(normal) {
    const [u,v] = basis(normal);
    return hemisphere.map(([x,y,z]) => normal.map((n,k) => n*y + u[k]*x + v[k]*z));
  }

  function gain(row, point, normal = row.normal) {
    const origin = point.map((x,k) => x + normal[k]*bias);
    let covered, rays;
    nearby(point, shape => {
      if (shape.i === row.i) return;
      const delta = shape.point.map((x,k) => x - origin[k]);
      const offset = dot(shape.normal, delta);
      if (Math.abs(offset) >= reach || offset <= 0 && dot(shape.normal, normal) > .95) return;
      const u0 = dot(delta, shape.u), v0 = dot(delta, shape.v);
      rays ??= normal === row.normal ? (row.rays ??= directions(normal)) : directions(normal);
      covered ??= new Float64Array(rays.length);
      for (let i = 0; i < rays.length; i++) {
        const dir = rays[i], facing = dot(shape.normal, dir);
        if (Math.abs(facing) < .025) continue;
        const depth = offset/facing;
        if (!(depth > bias && depth < reach)) continue;
        const falloff = 1 - smooth(depth/reach);
        if (falloff <= covered[i]) continue;
        const s = dot(dir, shape.u)*depth - u0, t = dot(dir, shape.v)*depth - v0;
        const power = -.5*(shape.k0*s*s + 2*shape.k1*s*t + shape.k2*t*t);
        covered[i] = Math.max(covered[i], falloff * ContributionRules.alpha(power, shape.density, true, shape.edge, shape.continuous));
      }
    });
    if (!covered) return 1;
    let blocked = 0;
    for (let i = 0; i < covered.length; i++) blocked += covered[i]*hemisphere[i][3];
    return 1 - strength*clamp(blocked);
  }

  function sample(row, pixel, point, normal = row.normal) {
    // Overlapping splats on one plane usually describe the same point.
    const previous = cache[pixel];
    if (previous && (previous.row === row || !previous.row.casts && !row.casts) && point.every((n,k) => Math.abs(n - previous.point[k]) <= 1e-6*reach) &&
        normal.every((n,k) => Math.abs(n - previous.normal[k]) <= 1e-6)) return previous.value;
    const value = gain(row, point, normal);
    cache[pixel] = { row, point, normal, value };
    return value;
  }

  return {
    at(i) { return rows[i]; },
    sample,
    pixel(row, pixel, x, y, depth, exact) {
      if (exact) return sample(row, pixel, exact.position, exact.normal);
      return sample(row, pixel, surfacePoint(rayAt(x, y), row.normal, ...row.point, depth, row.support));
    }
  };
}

module.exports = { create };
