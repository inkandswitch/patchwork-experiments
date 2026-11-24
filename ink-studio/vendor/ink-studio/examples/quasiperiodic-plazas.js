const palette = [
  0x111c29, 0x223746, 0x3d5664, 0x657985, 0x94aaa9,
  0x245454, 0x317c73, 0x58a898, 0x94d0b1,
  0x673733, 0x9d5d41, 0xc88a54, 0xffc985, 0xffe6b4,
  0x403c64, 0x625f85, 0x8583a9, 0xb3a9bc
];

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'quasiperiodic-plazas',
  name: 'Quasiperiodic plazas',
  seed: 33,
  build(seed, { controls } = {}) {
    const family = controls?.family ?? 'penrose';
    if (!['penrose', 'ammannBeenker'].includes(family)) throw new RangeError('Use penrose or ammannBeenker');
    const octagonal = family === 'ammannBeenker', sides = octagonal ? 8 : 10;
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), { V, procedural: P } = K;
    Object.assign(S, { pixel: true, amb: .40, sky: .29, sun: V.norm([-.68, .79, .38]), sunK: .74 });
    const slate = { r: [0, 1, 2, 3, 4] };
    const copper = { r: [9, 10, 11, 12] }, amber = { r: [11, 12, 13], em: true };
    const ax = [[1, 0, 0], [0, 0, 1], [0, 1, 0]], tau = 2 * Math.PI;
    const ring = radius => Array.from({ length: sides }, (_, i) => {
      const a = (i + .5) * tau / sides + Math.PI / 2;
      return [Math.cos(a) * radius, Math.sin(a) * radius];
    });
    const boundary = ring(3.62);
    const map = P.tiles.quasiperiodic({ family, depth: octagonal ? 3 : 4, radius: octagonal ? 8.3 : 3.97,
      rotation: Math.PI / 2 + (octagonal ? Math.PI / 8 : 0), boundary });
    function prism(points, y, thickness, material, res, round = 0) {
      const center = points.reduce(([x, z], p) => [x + p[0] / points.length, z + p[1] / points.length], [0, 0]);
      const local = points.map(p => [p[0] - center[0], p[1] - center[1]]);
      return S.extrude([local], [center[0], y, center[1]], thickness, material, { ax, res, rd: round });
    }
    prism(ring(3.99), -.10, .29, slate, .135, .095);
    prism(ring(3.94), .039, .12, copper, .108, .033);
    prism(ring(3.86), .105, .13, slate, .112, .033);
    prism(ring(3.66), .170, .099, { r: [0, 1, 2] }, .106);
    const trim = ring(3.72).map(([x, z]) => [x, .188, z]);
    S.tube([...trim, trim[0]], .018, .019, copper, { res: .07 });

    const atlas = SpriteSurface.make(640);
    function paver(polygon, x, z, color, weather) {
      const n = polygon.length, points = [], uvs = [], triangles = [];
      const ring = (scale, height) => polygon.map(p => [x + (p[0] - x) * scale, height, z + (p[1] - z) * scale]);
      const cap = ring(.88, .313), rim = ring(.94, .276), bottom = ring(.94, .212);
      function face(vertices, uv) {
        const start = points.length / 3;
        for (const p of vertices) {
          points.push(...p);
          uvs.push(...uv(p));
        }
        for (let i = 1; i < vertices.length - 1; i++) triangles.push(start, start + i + 1, start + i);
      }
      const xs = cap.map(p => p[0]), zs = cap.map(p => p[2]), left = Math.min(...xs), top = Math.min(...zs);
      const width = Math.max(...xs) - left, depth = Math.max(...zs) - top;
      face(cap, ([u, , v]) => [(u - left) / width, .48 * (v - top) / depth]);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = cap[j][0] - cap[i][0], dz = cap[j][2] - cap[i][2];
        const light = .5 + .5 * (-.72 * dz - .48 * dx) / Math.hypot(dx, dz);
        face([cap[i], cap[j], rim[j], rim[i]], () => [light, .71]);
        face([rim[i], rim[j], bottom[j], bottom[i]], () => [light, .94]);
      }
      atlas.mesh({ points, uvs, triangles }, 18, 18, (u, v) => {
        const shade = (v < 9 ? 1 + (((u * 31 + v * 17 + weather) & 7) - 3) * .009
          : v < 15 ? .63 + .42 * u / 17 : .42 + .23 * u / 17);
        const [r, g, b] = color.map(c => Math.min(255, Math.round(c * shade)));
        return r * 65536 + g * 256 + b;
      });
    }
    for (const tile of map.tiles) {
      const { polygon, type, addresses, id } = tile;
      const [x, z] = polygon.reduce(([x, z], p) => [x + p[0] / polygon.length, z + p[1] / polygon.length], [0, 0]);
      const area = polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return sum + (p[0] - x) * (q[1] - z) - (q[0] - x) * (p[1] - z);
      }, 0) / 2;
      if (area < .00065) continue;
      const highlight = P.data.hash(addresses[0].slice(1).join('.'), seed) % 11 === 1;
      const central = Math.hypot(x, z) < (octagonal ? .62 : .89);
      const color = octagonal
        ? (type === 'square' ? [101, 116, 156] : central || highlight ? [86, 166, 147] : [198, 136, 79])
        : (type === 'thinRhomb' || central ? [225, 163, 92] : highlight ? [62, 111, 111] : [87, 161, 143]);
      paver(polygon, x, z, color, P.data.hash(id, seed) % 8);
    }

    for (const p of ring(3.78)) {
      if (p[1] > 2.9 && Math.abs(p[0]) < 1.35) continue;
      const [x, z] = p;
      S.ball([x, .213, z], [.102, .038, .102], slate, { res: .057 });
      S.lathe([x, .237, z], .32, [.068, .050], copper, { res: .06 });
      S.ball([x, .55, z], [.046, .053, .046], amber, { res: .037 });
    }
    for (const x of [-1.62, 1.62]) {
      const z = octagonal ? -2.86 : -2.99;
      S.box([x, .257, z], [.44, .096, .19], slate, { res: .078, rd: .04 });
      S.box([x, .399, z], [.43, .046, .17], copper, { res: .065, rd: .033 });
    }
    const title = octagonal ? 'EIGHTFOLD EXCHANGE' : 'PENROSE COURT';
    const markW = 224, markH = 34;
    const font = K.inspection.font({}), letters = [...title].map(letter => font.get(letter));
    const margin = Math.round((markW - 12 * letters.length) / 2);
    const signZ = octagonal ? 3.60 : 3.69, width = 2.83;
    S.box([0, .273, signZ], [width * .51, .092, .216], copper, { res: .065, rd: .038 });
    atlas.face([-width / 2, .423, signZ + .179], [width, 0, 0], [0, 0, -.355], markW, markH, (u, v) => {
      const edge = Math.min(u, v, markW - u - 1, markH - v - 1);
      if (edge === 2) return 0x7c716b;
      const x = Math.floor((u - margin) / 2), y = Math.floor((v - 10) / 2);
      return x >= 0 && y >= 0 && y < 7 && letters[Math.floor(x / 6)]?.[y * 6 + x % 6]
        ? 0xffdfac : 0x23323f;
    });
    S.bake();
    const world = B.finish({ spriteSurfaces: atlas.finish(),
      cam: { target: [0, .16, .35], dist: 12.6, yaw: -.17, pitch: .98, fov: .64 },
      radius: 5.9, detail: 26, dither: .12, look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
    if (!octagonal) return world;
    const duration = 5;
    const survey = { type: 'archimedeanSpiral', phase: -1.98, turns: .125, startRadius: 7.43, endRadius: 7.60,
      height: -.99, origin: [0, 9.12, 0] };
    return K.cameraRig.bind(world, K.cameraRig.compile({
      rails: { survey: { family: survey } },
      shots: { courtyard: { rail: 'survey', target: [0, .19, .3], fov: .72,
        progress: [{ time: 0, value: 0 }, { time: duration / 2, value: 1, ease: 'smooth' },
          { time: duration, value: 0, ease: 'smooth' }] } }, duration
    }));
  }
});
