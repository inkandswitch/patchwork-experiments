// An orthographic depth map and hemisphere lighting for the posed splats.
const ColorSpace = require('../src/color-space.js');
const ShadowArt = require('../src/shadow-art.js');
const linear = ColorSpace.prepare('srgb', 'srgb-linear');
const srgb = ColorSpace.prepare('srgb-linear', 'srgb');
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(n => n / length);
};
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const defaultDirection = [-.52, .64, .57];
const bounceColors = Object.freeze({
  'clear-sky': '#7aaeff', overcast: '#c6d6e3', sand: '#ffbd77', snow: '#edf5ff', water: '#54bdc9'
});

function bounceSettings(value, time) {
  const sample = typeof value === 'function' ? value(time) : value;
  if (sample === false || sample === 'off') return null;
  if (sample === undefined) return;
  if (typeof sample === 'string') return { color: sample };
  if (!sample || Object.getPrototypeOf(sample) !== Object.prototype ||
      Object.keys(sample).some(key => key !== 'color' && key !== 'intensity'))
    throw new TypeError('Bounce needs a color, preset name, settings object or off');
  return sample;
}

function bounce(authored, override, fallback, time) {
  const chosen = bounceSettings(override, time);
  if (chosen === null) return null;
  const previous = bounceSettings(authored, time);
  if (!chosen && !previous) return null;
  const { color = fallback, intensity = .4 } = { ...previous, ...chosen };
  const value = typeof color === 'string' && Object.hasOwn(bounceColors, color) ? bounceColors[color] : color;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw new TypeError('Bounce color needs #rrggbb or one of ' + Object.keys(bounceColors).join(', '));
  if (!range(intensity, 0, 4)) throw new RangeError('Bounce intensity needs a number from 0 to 4');
  const rgb = linear([1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
  return intensity && rgb.some(Boolean) ? rgb.map(c => c * intensity) : null;
}

function prepare(authored, override, time, celestialSun) {
  const enabled = override ?? authored;
  if (enabled === undefined || enabled === false) return null;
  const settings = value => {
    if (value === true || value === undefined || value === false) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('liveSun needs a settings object or boolean');
    return value;
  };
  const base = settings(authored), selected = settings(override ?? undefined);
  const { direction = defaultDirection, ambient = .32, intensity = .88,
    shadows = true, mapSize = 512, bias = .02, filter = 1 } = { ...base, ...selected };
  const sky = bounce(base.skyBounce, selected.skyBounce, 'clear-sky', time);
  const ground = bounce(base.groundBounce, selected.groundBounce, 'sand', time);
  const directionAt = celestialSun?.direction ?? (typeof direction === 'function' ? direction(time) : direction);
  if (!Array.isArray(directionAt) || directionAt.length !== 3 || !Array.from(directionAt).every(Number.isFinite) ||
      !Number.isFinite(Math.hypot(...directionAt)) || Math.hypot(...directionAt) === 0)
    throw new TypeError('Live sun direction needs a finite nonzero XYZ vector');
  if (!range(ambient, 0, 4) || !range(intensity, 0, 4) || !range(bias, 0, 10) || !range(mapSize, 32, 2048) ||
      !Number.isInteger(mapSize) || !Number.isInteger(filter) || !range(filter, 0, 2) || typeof shadows !== 'boolean')
    throw new RangeError('Invalid live sun lighting or shadow map settings');
  return { direction: unit(directionAt), ambient, intensity: intensity * (celestialSun?.gain ?? 1), shadows, mapSize, bias, filter, sky, ground };
}

function covariance(data, i, a, b) {
  return a[0] * (data[i+4]*b[0] + data[i+5]*b[1] + data[i+6]*b[2]) +
    a[1] * (data[i+5]*b[0] + data[i+8]*b[1] + data[i+9]*b[2]) +
    a[2] * (data[i+6]*b[0] + data[i+9]*b[1] + data[i+10]*b[2]);
}

function shadowMap(sun, data, { x, y, z, alpha, scale }, normalAt, casts) {
  if (!sun.shadows || !sun.intensity) return null;
  const light = sun.direction;
  const right = unit(cross(Math.abs(light[1]) > .94 ? [0,0,1] : [0,1,0], light));
  const up = cross(light, right);
  const casters = [];
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    const q = i * 16;
    // Opaque surface samples cast. Glass, backdrop art and outline-free particles are excluded.
    if (!Number.isFinite(alpha[i]) || alpha[i] < 1 || y[i] < -30 || (Math.round(data[q + 11]) & (16 | 64 | 256)) ||
        casts && !casts(i)) continue;
    const point = [x[i], y[i], z[i]], u = dot(right, point), v = dot(up, point), depth = dot(light, point);
    const s2 = scale[i] ** 2;
    const a = s2 * covariance(data, q, right, right), b = s2 * covariance(data, q, right, up),
      c = s2 * covariance(data, q, up, up);
    if (![u,v,depth,a,b,c].every(Number.isFinite) || a < 0 || c < 0) continue;
    const extent = 2 * Math.log(alpha[i] / .5);
    const du = Math.sqrt(a * extent), dv = Math.sqrt(c * extent);
    minU = Math.min(minU, u - du);
    maxU = Math.max(maxU, u + du);
    minV = Math.min(minV, v - dv);
    maxV = Math.max(maxV, v + dv);
    casters.push({ i, u, v, depth, a, b, c, extent, reach: 2*Math.sqrt(Math.max(0, s2 * covariance(data, q, light, light))) });
  }
  if (!casters.length) return null;
  const guard = sun.filter + 2;
  const texel = Math.max(maxU - minU, maxV - minV, 1e-6) / (sun.mapSize - 2 * guard - 1);
  const width = Math.ceil((maxU - minU) / texel) + 2 * guard;
  const height = Math.ceil((maxV - minV) / texel) + 2 * guard;
  minU -= guard * texel;
  minV -= guard * texel;
  const map = new Float64Array(width * height).fill(-Infinity);
  const minimumVariance = .15 * texel ** 2;

  for (const { i, u, v, depth, a, b, c, extent, reach } of casters) {
    const A = a + minimumVariance, C = c + minimumVariance;
    const det = A * C - b * b;
    if (!(det > 0)) continue;
    const radiusU = Math.sqrt(A * extent), radiusV = Math.sqrt(C * extent);
    const x0 = Math.max(0, Math.ceil((u - radiusU - minU) / texel - .5)),
      x1 = Math.min(width - 1, Math.floor((u + radiusU - minU) / texel - .5)),
      y0 = Math.max(0, Math.ceil((v - radiusV - minV) / texel - .5)),
      y1 = Math.min(height - 1, Math.floor((v + radiusV - minV) / texel - .5));
    const normal = normalAt(i), facing = normal && dot(normal, light);
    const slopeU = Math.abs(facing) >= .09 ? -dot(normal, right) / facing : 0;
    const slopeV = Math.abs(facing) >= .09 ? -dot(normal, up) / facing : 0;
    for (let j = y0; j <= y1; j++) {
      const dv = minV + (j + .5) * texel - v;
      for (let k = x0; k <= x1; k++) {
        const du = minU + (k + .5) * texel - u;
        if ((C*du*du - 2*b*du*dv + A*dv*dv) / det > extent) continue;
        const offset = Math.max(-reach, Math.min(reach, slopeU * du + slopeV * dv));
        const index = j * width + k;
        map[index] = Math.max(map[index], depth + offset);
      }
    }
  }

  return (x, y, z, normal, facing) => {
    const u = (x*right[0] + y*right[1] + z*right[2] - minU) / texel;
    const v = (x*up[0] + y*up[1] + z*up[2] - minV) / texel;
    const depth = x*light[0] + y*light[1] + z*light[2];
    const i = Math.floor(u), j = Math.floor(v), denominator = Math.max(.10, facing);
    const slopeU = -dot(normal, right) * texel / denominator;
    const slopeV = -dot(normal, up) * texel / denominator;
    const bias = sun.bias + texel * .25;
    let clear = 0, count = 0;
    for (let dy = -sun.filter; dy <= sun.filter; dy++) {
      const row = j + dy;
      for (let dx = -sun.filter; dx <= sun.filter; dx++) {
        const col = i + dx;
        const expected = depth + (col + .5 - u)*slopeU + (row + .5 - v)*slopeV;
        if (row < 0 || row >= height || col < 0 || col >= width || map[row*width+col] <= expected + bias) clear++;
        count++;
      }
    }
    return clear / count;
  };
}

function create(sun, world, pose, normalAt, cloudShadow, exposure, { shadowArt, footprint, probes } = {}) {
  // Albedo exists on opted-in sculpt bakes and explicitly described builder rows.
  // Older pixel-material bakes still carry the original material ramps.
  const fill = new Int32Array(pose.alpha.length).fill(-1);
  const normals = [];
  for (let i = 0; i < fill.length; i++) {
    if (!pose.alpha[i] || (Math.round(world.data[i*16+11]) & (32 | 64 | 256))) continue;
    const reference = world.materialAlbedo?.[i], palette = world.pix?.[i*8];
    const rgb = reference ? reference - 1 : palette ? world.pal[world.ramps?.[palette - 1]?.at(-1)] : undefined;
    if (rgb === undefined) continue;
    const normal = normalAt(i);
    if (!normal) continue;
    normals[i] = normal;
    fill[i] = rgb;
  }
  const art = ShadowArt.prepare(shadowArt ?? world.look?.shadowArt);
  const receives = ShadowArt.bind(art, world, 'receive');
  const coarse = ShadowArt.small(art, footprint);
  const shadow = shadowMap(sun, world.data, pose, normalAt, ShadowArt.bind(art, world, 'cast'));
  const facing = new Float32Array(fill.length);
  const indirect = (sun.sky || sun.ground) && new Float32Array(fill.length * 3);
  for (let i = 0; i < normals.length; i++) {
    const normal = normals[i];
    if (!normal) continue;
    facing[i] = Math.max(0, dot(normal, sun.direction));
    if (indirect) {
      // A cosine-weighted hemisphere sends half its light to a vertical surface.
      const upper = (1 + normal[1]) * .5;
      for (let c = 0; c < 3; c++)
        indirect[3*i+c] = upper * (sun.sky?.[c] ?? 0) + (1 - upper) * (sun.ground?.[c] ?? 0);
    }
  }
  const visibility = (i, x, y, z) => {
    if (!normals[i]) return undefined;
    const geometry = shadow && facing[i] > 0 && (!receives || receives(i)) ?
      ShadowArt.transfer(art, shadow(x, y, z, normals[i], facing[i]), coarse) : 1;
    return geometry && geometry * (cloudShadow?.(x,y,z) ?? 1) * (exposure?.(x,y,z) ?? 1);
  };
  function transmissionVisibility(i, point, normal, bias) {
    const cosine = dot(normal, sun.direction);
    const toward = cosine < 0 ? normal.map(value => -value) : normal;
    const geometry = shadow && (!receives || receives(i)) ? ShadowArt.transfer(art, shadow(
      ...point.map((value, axis) => value + sun.direction[axis] * bias), toward, Math.abs(cosine)
    ), coarse) : 1;
    const [x, y, z] = point;
    return geometry * (cloudShadow?.(x, y, z) ?? 1) * (exposure?.(x, y, z) ?? 1);
  }
  const level = (i, x, y, z) => sun.ambient + sun.intensity * facing[i] * visibility(i, x, y, z);
  const indirectScratch = [0,0,0];
  function indirectAt(i,x,y,z,out = [0,0,0]) {
    const offset = i * 3;
    const local = probes?.(i,x,y,z,normals[i]);
    if (!local && (!indirect || !(indirect[offset] || indirect[offset+1] || indirect[offset+2]))) return null;
    const mix = local?.mix ?? 0, openness = exposure?.(x,y,z) ?? 1;
    for (let c=0;c<3;c++) out[c] = (indirect?.[offset+c] ?? 0) * openness * (1-mix) + (local?.rgb[c] ?? 0) * mix;
    return out;
  }
  function gains(i, x, y, z, rgb) {
    rgb.fill(level(i, x, y, z));
    const bounce = indirectAt(i,x,y,z,indirectScratch);
    if (!bounce) return rgb;
    // Blend the local irradiance into the hemisphere fill in linear light.
    linear(rgb, rgb);
    for (let c = 0; c < 3; c++) rgb[c] += bounce[c];
    return srgb(rgb, rgb);
  }
  function rampLevel(i, x, y, z, tint) {
    gains(i, x, y, z, tint);
    const brightness = luminance(tint);
    if (brightness > 0) for (let c = 0; c < 3; c++) tint[c] /= brightness;
    else tint.fill(1);
    return brightness;
  }
  const albedo = i => {
    const n = fill[i];
    return n >= 0 ? [(n >> 16)/255, (n >> 8 & 255)/255, (n & 255)/255] : null;
  };
  return { albedo, normal: i => normals[i], level, gains, rampLevel, visibility, transmissionVisibility,
    indirectAt, hasBounce: Boolean(indirect || probes) };
}

module.exports = { prepare, create };
