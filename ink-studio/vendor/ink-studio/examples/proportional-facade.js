const emit = role => ({ op: 'emit', role });

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'proportional-facade',
  name: 'Phi Exchange',
  seed: 31,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101c25, 0x192b35, 0x304953, 0x45636b, 0x66868b, 0x8baba9,
      0x302223, 0x55362c, 0x784e37, 0xb27849, 0xd8a767, 0xf8cd87,
      0x223735, 0x3e6057, 0x6c9b81, 0xa8c4a0
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .42, sky: .25, sun: K.V.norm([-.66, .67, .42]), sunK: .78 });
    const steel = { r: [0, 1, 2, 3, 4, 5] }, frame = { r: [6, 7, 8, 9, 10, 11] };
    const glass = { r: [0, 12, 13, 14] }, lamp = { r: [9, 10, 11], em: true };
    const box = (at, half, mat, res = .08, rd = .027) => S.box(at, half, mat, { res, rd });
    box([0, 2.65, -.34], [4.38, 2.57, .42], steel, .13, .12);
    box([0, 5.23, -.12], [4.54, .13, .64], frame, .11, .07);
    box([0, 5.36, -.17], [4.31, .078, .51], steel, .11, .04);
    box([0, .12, .19], [4.50, .15, .73], steel, .11, .06);
    box([0, -.043, .32], [4.69, .09, .94], frame, .12, .06);
    box([0, -.18, .42], [4.92, .085, 1.10], steel, .13, .06);
    for (const x of [-4.29, 4.29]) {
      box([x, 2.66, .22], [.12, 2.4, .31], frame, .10, .05);
      for (const y of [.53, 4.83]) S.ball([x, y, .533], [.049, .049, .027], lamp, { res: .035 });
    }

    const { grammar, proportions } = K.procedural;
    const height = 4.72, halfWidth = height * proportions.phi / 2;
    const layout = grammar.expand({
      id: 'exchange', symbol: 'front',
      bounds: { min: [-halfWidth, .31, .02], max: [halfWidth, .31 + height, .46] }
    }, {
      front: { op: 'proportion', depth: 3, majorAt: 'turn', gap: .084,
        major: emit('panel'), minor: emit('panel'), seam: emit('trim') }
    });
    const surfaces = SpriteSurface.make(512);
    const font = K.inspection.font({});
    const palette = {
      gold: 0xf5c986, bright: 0xfce0a8, teal: 0x83c6ad,
      dark: 0x15282c, darkLine: 0x254044, bronze: 0x885e40
    };
    function panel(part, paint) {
      const { min, max } = part.bounds;
      const margin = .10, w = max[0] - min[0] - 2 * margin, h = max[1] - min[1] - 2 * margin;
      const nx = Math.round(w * 38), ny = Math.round(h * 38);
      const surface = new Uint32Array(nx * ny);
      function pixel(x, y, color) {
        if (x >= 0 && x < nx && y >= 0 && y < ny) surface[y * nx + x] = color;
      }
      function type(text, y, scale, color) {
        const x = Math.round((nx - (text.length * 6 - 1) * scale) / 2);
        for (const [i, letter] of [...text].entries()) {
          const bits = font.get(letter);
          for (let v = 0; v < 7 * scale; v++) for (let u = 0; u < 5 * scale; u++)
            if (bits[Math.floor(v / scale) * 6 + Math.floor(u / scale)])
              pixel(x + i * 6 * scale + u, Math.round(y) + v, color);
        }
      }
      function line(y, margin, color) {
        for (let x = margin; x < nx - margin; x++) pixel(x, Math.round(y), color);
      }
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const edge = Math.min(x, y, nx - x - 1, ny - y - 1), u = x - (nx - 1) / 2;
        surface[y * nx + x] = edge === 2 ? palette.bronze : paint(x, y, nx, ny, u);
      }
      function mount() {
        surfaces.face([min[0] + margin, min[1] + margin, .742], [w, 0, 0], [0, h, 0], nx, ny,
          (x, y) => surface[y * nx + x]);
      }
      return { mount, type, line, ny };
    }
    for (const part of layout.parts) {
      const { center: [x, y], half: [a, b], role, path } = part;
      if (role === 'trim') {
        box([x, y, .29], [a, b, .30], frame, .068, .012);
        box([x, y, .595], [Math.min(a, .012), Math.min(b, .012), .014], lamp, .04, .006);
        continue;
      }
      box([x, y, .27], [a - .018, b - .018, .275], frame, .088, .044);
      box([x, y, .49], [a - .067, b - .067, .079], glass, .071, .023);
      let ink;
      if (path.length === 2) {
        ink = panel(part, (x, y, nx, ny, u) => {
          const v = y - ny * .33, r = Math.hypot(u, v);
          if (Math.abs(r - 29) < .9 || Math.abs(r - 34) < .7 && u > -27 && v < 30) return palette.bronze;
          if (Math.abs(r - 17) < 1.4 || Math.abs(u) <= 1 && Math.abs(v) < 27) return palette.gold;
          if (r < 3.1 || Math.hypot(u - 30, v + 16) < 2.9) return palette.bright;
          return (x + y * 3) % 37 === 0 ? 0x1d3437 : palette.dark;
        });
        ink.line(ink.ny * .60, 23, palette.bronze);
        ink.type('PHI EXCHANGE', ink.ny * .66, 2, palette.bright);
        ink.type('NORTH QUAY', ink.ny * .81, 1, palette.teal);
      } else if (path.length === 3) {
        ink = panel(part, (x, y, nx, ny) => y > ny * .43 && x > 6 && x < nx - 7 && y < ny - 8
          ? [0x1a3135, 0x203c3e, 0x426565, 0x537574, 0x15292d][y % 5]
          : palette.dark);
        ink.type('01', ink.ny * .09, 2, palette.gold);
        ink.type('INTAKE', ink.ny * .30, 1, palette.teal);
      } else if (path.at(-1) === 'major') {
        ink = panel(part, (x, y, nx, ny) => y > ny * .44 && x % 9 < 2 ? palette.darkLine : palette.dark);
        ink.type('02', ink.ny * .15, 2, palette.gold);
        ink.type('SERVICE', ink.ny * .55, 1, palette.teal);
      } else {
        ink = panel(part, (x, y, nx, ny) => x > 5 && x < nx - 6 && y > ny * .36 && y < ny - 8 &&
          (x * 3 + y * 7) % 13 < 4 ? palette.teal : palette.darkLine);
        ink.type('03', ink.ny * .12, 1, palette.gold);
      }
      ink.mount();
    }
    S.bake();
    return B.finish({
      cam: { target: [0, 2.60, .08], dist: 13.35, yaw: -.055, pitch: .090, fov: .57 },
      radius: 6, detail: 26, dither: .18, spriteSurfaces: surfaces.finish(),
      look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
  }
});
