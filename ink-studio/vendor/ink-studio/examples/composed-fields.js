module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'composed-fields',
  name: 'Mineral terraces',
  seed: 1,
  build(seed) {
    const pal = [
      0x1b2931, 0x352c32, 0x694446, 0xa46751, 0xd39667, 0xecbd87,
      0x3e4c4e, 0x526b64, 0x718c78, 0x97a98a, 0xc3c098,
      0x382f3b, 0x684952, 0x9b6470, 0xc88b86
    ];
    const B = makeBuilder(44, pal),
      S = K.sculpt(makeSculpt(B)),
      F = K.procedural.fields,
      finished = Boolean(seed % 2),
      cliff = { type: 'ridge', octaves: 2, source: { type: 'simplex', axes: ['x', 'z'], scale: [2.1, 1, 1.95], seed: 33 } },
      valley = { type: 'distance', axes: 'xz', paths: [
        [[-5, 0, 0.35], [-2.2, 0, 0.35], [0, 0, -0.45], [2.5, 0, -0.7], [5, 0, -0.4]]
      ] };
    const crests = finished ? { type: 'warp', scale: [1.6, 2.5, 1.6], strength: 0.29, iterations: 3, source: cliff, seed: 41 } : cliff,
      raw = { type: 'add', inputs: [0.12, { type: 'multiply', inputs: [0.48, valley] }, { type: 'multiply', inputs: [0.31, crests] }] },
      elevation = F.compile(finished ? { type: 'terrace', step: 0.32, transition: 0.44, source: raw } : raw),
      paletteField = F.compile({ type: 'periodic', period: [4.5, null, 3.0], scale: [0.7, 2.1, 0.6], seed: 9 });
    const height = K.tab2((x, z) => {
      const fade = Math.max(0, 1 - Math.max(0, Math.hypot(x / 4.95, z / 3.15) - 0.78) * 4);
      return 0.04 + elevation(x, 0, z) * fade;
    }, [-5.2, 5.2, -3.3, 3.3], 0.075);
    const stone = {
      r: [1, 2, 3, 4, 5],
      mod: (x, y, z) => 0.21 * paletteField(x, y, z),
      tex(x, y, z, ny, t) {
        if (!finished) return;
        const layer = ((y + 0.01 * paletteField(x, y, z)) % 0.32 + 0.32) % 0.32;
        if (layer < 0.047 && ny < 0.78) return S.pick([1, 2, 3], t);
        if (ny > 0.79 && Math.abs(z) > 1.2 && y > 0.72) return S.pick([6, 7, 8, 9, 10], t);
      }
    };
    S.ground(stone, { h: height, rad: 4.95, zs: 1.52, edge: 0.045, res: 0.083 });
    const bump = { type: 'add', inputs: [0.39, { type: 'multiply', inputs: [0.55, {
      type: 'warp', strength: 0.1, iterations: 2, scale: 0.48, seed: 33,
      source: { type: 'ridge', scale: [0.56, 1.35, 0.4], octaves: 2, seed: 14 }
    }] }] };
    for (const [x, z, w, h] of [[-1.72, -1.23, 0.46, 0.71], [2.43, 0.65, 0.42, 0.6], [2.93, 0.92, 0.32, 0.37]]) {
      const mat = { r: [11, 12, 13, 14] },
        point = [x, height(x, z) + h * 0.42, z],
        options = { res: 0.064 };
      if (finished) {
        const source = S.ball(point, [w, h, w * 0.79], mat, { ...options, hold: true });
        S.displace(source, bump, 0.095, options);
      } else S.ball(point, [w, h, w * 0.79], mat, options);
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.62, 0], dist: 13, pitch: 0.71, yaw: 0.27 }, detail: 19, dither: 0.26, radius: 5.15 });
  }
});
