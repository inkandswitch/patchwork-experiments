const palette = [
  0x0b1421, 0x142133, 0x1c2c41, 0x293e56, 0x3a5667, 0x517383, 0x7596a0, 0xa9bec0,
  0x1a404b, 0x215f65, 0x277f7c, 0x45a592, 0x76c7aa, 0xa7dbc1, 0xd9ebcf,
  0x3b2a42, 0x634054, 0x925361, 0xbb7071, 0xdd8a7b, 0xf2aa83, 0xffcf9e, 0xffebc9
];
const span = 1.16, depth = .59;
const bounds = { min: [-span, -span, -depth], max: [span, span, depth] };
const clamp = x => Math.min(1, Math.max(0, x));
const hex = rgb => rgb.reduce((value, part) => value * 256 + Math.round(clamp(part) * 255), 0);
const vector = color => [color >> 16, color >> 8 & 255, color & 255].map(n => n / 255);
const ramp = { stops: [
  [-.30, '#142133'], [-.01, '#1a404b'], [.27, '#277f7c'], [.47, '#76c7aa'],
  [.57, '#925361'], [.70, '#f2aa83'], [.90, '#ffebc9']
], interpolation: 'smooth' };
const ink = ['#1a404b', '#277f7c', '#76c7aa', '#f2aa83', '#ffebc9'];
const titles = ['PIGMENT', 'RELIEF', 'CONTOURS', 'DENSITY', 'SPLATS', 'GEOMETRY'];

function rosette(K) {
  return K.fieldOutputs.create({ bounds, channels: {
    strength: { range: [0, 1] }, phase: { units: 'rad', range: [-Math.PI, Math.PI] }, species: { type: 'category' }
  }, sample(x, y, z) {
    const r = Math.hypot(x, y), theta = Math.atan2(y, x);
    const phase = 5 * theta + 1.17 * r + 1.15 * z;
    const radius = .61 + .19 * Math.cos(phase) + .026 * Math.cos(2 * phase);
    const rim = 1 - Math.hypot((r - radius) / .185, z / .46);
    const vein = .42 * Math.exp(-((r / .39) ** 2)) + .14 * Math.cos(17 * r - phase) * Math.min(1, r * 9);
    const core = .64 - Math.hypot(r / .53, z / .24);
    return { strength: Math.max(rim, core) + vein * Math.max(0, 1 - Math.abs(z) * 2),
      phase: Math.atan2(Math.sin(phase), Math.cos(phase)), species: Math.cos(phase) > .07 ? 'copper' : 'jade' };
  } });
}

module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'shared-field-outputs', name: 'One Field, Six Outputs', seed: 39,
  build(seed) {
    const B = makeBuilder(seed, palette), sprites = SpriteSurface.make(1024), field = rosette(K);
    const V = K.V, font = K.inspection.font({}), atmosphere = [];
    const axis = { axis: 'z', at: 0 };
    const paint = field.pigment('strength', { ramp });
    const stains = field.pigment('species', { colors: { copper: '#f2aa83', jade: '#45a592' } });
    const strength = field.scalar('strength', { missing: -.5 });
    const height = value => Math.max(0, value) ** 1.25;
    const normal = V.norm([0, -.47, .88]), light = V.norm([-.5, .38, .9]);
    const cards = [[-3.48, 1.55], [0, 1.55], [3.48, 1.55], [-3.48, -1.46], [0, -1.46], [3.48, -1.46]];
    const centers = cards.map(([x, y]) => [x * .927, y + (y > 0 ? -.10 : .14)]);

    function label(text, x, y, scale, color) {
      const glyphs = [...text].map(character => font.get(character)), w = 6 * glyphs.length;
      sprites.face([x, y, -1.01], [w * scale, 0, 0], [0, 7 * scale, 0], w, 7,
        (i, j) => glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6] ? color : null);
    }

    label('ONE FIELD, SIX OUTPUTS', -5.02, 3.32, .046, 0xffebc9);
    for (const [i, [cx, cy]] of cards.entries()) {
      const z = -1.20;
      sprites.face([cx - 1.65, cy - 1.37, z], [3.3, 0, 0], [0, 2.85, 0], 132, 114, (x, y) => {
        if (!x || !y || x === 131 || y === 113) return 0x3a5667;
        if (y === 15) return 0x293e56;
        return x % 7 === 0 && y % 7 === 0 ? 0x1c2c41 : 0x142133;
      });
      label(titles[i], cx - 1.45, cy + 1.11, .034, i < 3 ? 0xa7dbc1 : 0xffcf9e);
    }

    const [px, py] = centers[0], texture = 128;
    const local = (i, j) => [(2 * (i + .5) / texture - 1) * span, (1 - 2 * (j + .5) / texture) * span];
    sprites.face([px - span, py - span - .07, .03], [2 * span, 0, 0], [0, 2 * span, 0], texture, texture, (i, j) => {
      const [x, y] = local(i, j), value = strength(x, y, 0);
      if (value < -.28) return null;
      const base = vector(paint(x, y, 0)), color = vector(stains(x, y, 0));
      return hex(V.lerp(base, color, .24 * clamp(value)));
    });

    const [rx, ry] = centers[1];
    const chart = ([u, v]) => [span * (2 * u - 1), span * (1 - 2 * v), 0];
    const carrier = { sample(uv) {
      const [x, y] = chart(uv);
      return { p: [rx + x, ry + y * .88 - .085, y * .47], n: normal };
    } };
    const relief = field.relief('strength', { carrier, segments: [62, 62], scale: .40, map: height,
      project: ({ uv }) => chart(uv), flip: true });
    sprites.mesh(relief, texture, texture, (i, j) => {
      const [x, y] = local(i, j), value = strength(x, y, 0);
      if (value < -.28) return null;
      const h = .016, dx = (height(strength(x + h, y, 0)) - height(strength(x - h, y, 0))) / (2 * h);
      const dy = (height(strength(x, y + h, 0)) - height(strength(x, y - h, 0))) / (2 * h);
      const n = V.norm([-.40 * dx, -.4 * dy, 1]);
      const shade = .51 + .58 * clamp(V.dot(n, light)), gleam = .32 * clamp(V.dot(n, [.12, -.05, .99])) ** 12;
      const base = V.lerp([.10, .24, .27], [.73, .99, .87], .2 + .38 * clamp(value));
      return hex(V.add(V.mul(base, shade), V.mul([.67, 1, .9], gleam)));
    });

    function placed([cx, cy], zSpan = depth) {
      return { bounds: { min: [cx - span, cy - span - .07, -zSpan], max: [cx + span, cy + span - .07, zSpan] },
        project: ([x, y, z]) => [x - cx, y - cy + .07, z] };
    }
    field.splats(B, 'strength', { kind: 'contours', id: 'rosette-contours', source: placed(centers[2], 0),
      options: { plane: axis, levels: [.08, .28, .48, .68, .88], cell: .026 },
      style: { width: .009, ramp: ink, domain: [.08, .88] } });

    const density = field.density('strength', { ...placed(centers[3]), scale: 5, map: value => Math.max(0, value - .10) ** 1.3 });
    atmosphere.push(K.atmosphere.field({ field: density, color: '#eb8e6f', emissive: '#ffbc8f', emissiveGain: .78, step: .074 }));

    field.splats(B, 'strength', { kind: 'slice', id: 'rosette-splats',
      source: { ...placed(centers[4], 0), map: (value, x, y) => value > .015 &&
        K.hash(Math.floor(x * 150), Math.floor(y * 150), seed) < (.43 + .51 * clamp(value)) ? value : null },
      options: { plane: axis, counts: [39, 39] }, style: { opacity: .81, ramp: ink, domain: [0, .96] } });

    const [gx, gy] = centers[5], skew = .29, c = Math.cos(skew), s = Math.sin(skew);
    const solid = field.view('strength', { kind: 'isosurface',
      source: { bounds: { min: [gx - span, gy - span - .07, -.92], max: [gx + span, gy + span - .07, .92] },
        project([x, y, z]) { const v = y - gy + .07; return [x - gx, c * v - s * z, s * v + c * z]; } },
      options: { level: .42, resolution: .074, edgeRefinements: 3 } });
    K.fieldViews.stamp(B, solid, { id: 'rosette-mesh', style: { color: '#f2aa83', ambient: .46, light: [-.45, .55, .7] } });

    return B.finish({ spriteSurfaces: sprites.finish(), atmosphere,
      cam: { target: [0, .25, 0], dist: 12, fov: .62, yaw: 0, pitch: 0, sway: 0 },
      detail: 28, radius: 7, dither: .027, look: { pixelSize: 1, splatCoverage: 'continuous' } });
  }
});
