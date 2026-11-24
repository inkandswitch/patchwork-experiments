const palette = [
  0x121925, 0x233142, 0x354652, 0x52636b, 0x7f8b8a,
  0x36252d, 0x58373a, 0x895747, 0xac7652, 0xd9a76e, 0xf2d296,
  0x232536, 0x4c3a58, 0x725675, 0xa47791, 0xcf9ead, 0xf6d5c2,
  0x1c293a, 0x2d4c62, 0x3a6c78, 0x4b9192, 0x7fbab0, 0xb3d7bd,
  0x302a3b, 0x684137, 0x9a5a3f, 0xc17d4c, 0xe6ab67, 0xffdbac
];
const headings = [
  ['QUATERNION JULIA', '01 / 4D SLICE'],
  ['MANDELBULB', '02 / POWER 8'],
  ['MENGER FOLD', '03 / DEPTH 3']
];
const sampling = { coarse: 1.38, fine: .59, curvature: .085, views: [[.18, .24, 1]], silhouetteBand: .23 };

function label(font, sprite, at, width, text, ink) {
  const glyphs = [...text].map(ch => font.get(ch)), w = text.length * 6 + 4;
  sprite.face(at, [width, 0, 0], [0, width * 10 / w, 0], w, 10, (u, v) => {
    const x = u - 2, y = v - 1;
    if (x >= 0 && y >= 0 && y < 7 && glyphs[Math.floor(x / 6)]?.[y * 6 + x % 6]) return ink;
  });
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'fractal-form-studies',
  name: 'Lithic Array and Sectioned Bulb',
  seed: 49,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'array';
    if (!['array', 'section'].includes(study)) throw new RangeError('Use array or section');
    const gallery = study === 'array', B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    const { fractal } = K.procedural.forms;
    Object.assign(S, {
      pixel: true, amb: .33, sky: .21, sun: K.V.norm([-.54, .72, .72]), sunK: .76, aoK: .86, aoR: .079,
      adaptiveSampling: controls?.adaptiveSampling ?? sampling
    });
    const steel = { r: [1, 2, 3, 4] }, bronze = { r: [5, 6, 7, 8, 9, 10] }, dark = { r: [0, 1, 2, 3] };
    const amethyst = { r: [11, 12, 13, 14, 15, 16], fat: .37, b: .09,
      mod: (x, y, z) => .16 * Math.sin(14 * y + 7 * z + 4 * Math.sin(x * 7)) };
    const copper = { r: [23, 24, 25, 26, 27, 28], fat: .38, b: .055,
      mod: (x, y, z) => .13 * Math.sin(17 * y + 7 * z + 1.5 * Math.cos(x * 9 - z * 4)) };
    const malachite = { r: [17, 18, 19, 20, 21, 22], fat: .34,
      mod: (x, y, z) => .076 * Math.sin(15 * y + 4 * x + 1.1 * Math.sin(z * 4)) };
    const box = (at, half, mat, rd, res = .085) => S.box(at, half, mat, { rd, res });
    const font = K.inspection.font({}), sprite = SpriteSurface.make(512);

    function plinth(cx, half, [title, details]) {
      box([cx, .07, 0], [half, .17, half * .77], steel, .09);
      box([cx, .257, 0], [half * .89, .062, half * .69], bronze, .045);
      box([cx, .318, 0], [half * .82, .034, half * .625], dark, .021);
      const z = half * .77 + .03, plaque = Math.min(half * 1.72, 2.92);
      box([cx, .073, z - .015], [plaque / 2, .109, .065], dark, .017, .052);
      label(font, sprite, [cx - (title.length * .122 + .1) / 2, .075, z + .075], title.length * .122 + .1, title, 0xf2d296);
      label(font, sprite, [cx - (details.length * .089 + .1) / 2, -.024, z + .075], details.length * .089 + .1, details, 0xb0b7a6);
      for (const side of [-1, 1]) S.ball([cx + side * (plaque / 2 - .06), .074, z + .054], .027, bronze, { res: .032 });
    }

    if (gallery) {
      const stations = [-2.92, 0, 2.92];
      stations.forEach((x, i) => plinth(x, 1.34, headings[i]));
      S.implicitForm(fractal({ family: 'quaternionJulia', constant: [-.2, .8, .06, -.09], slice: .025, iterations: 18,
        pose: { position: [stations[0], 1.42, 0], scale: 1.22, rotation: [.13, .27, -.60] }
      }), amethyst, { res: .055, cell: .05, maxWork: 65000000, objectId: 'quaternion-julia' });
      S.implicitForm(fractal({ family: 'mandelbulb', power: 8, iterations: 16,
        pose: { position: [0, 1.48, 0], scale: 1.13, rotation: [.43, -.12, -.18] }
      }), copper, { res: .052, cell: .036, maxWork: 65000000, objectId: 'mandelbulb' });
      S.implicitForm(fractal({ family: 'menger', iterations: 3, gap: .324,
        pose: { position: [stations[2], 1.39, 0], scale: 1.015, rotation: [0, .15, -.026] }
      }), malachite, { res: .046, cell: .029, objectId: 'menger-fold' });
    } else {
      const cut = .18;
      plinth(0, 2.10, ['SECTIONED MANDELBULB', 'LOCAL Z = 0.18']);
      const bands = { r: [17, 18, 19, 20, 21, 22], fat: .37,
        mod: (x, y) => .16 * Math.sin(Math.hypot(x, (y - 2.0) * .92) * 43 + 1.35 * Math.sin(x * 8)) };
      S.implicitForm(fractal({ family: 'mandelbulb', power: 8, iterations: 20,
        bounds: { min: [-1.35, -1.35, -1.35], max: [1.35, 1.35, cut] },
        pose: { position: [0, 2.19, 0], scale: 1.76 }
      }), { ...copper, materialAt: (_x, _y, z, _nx, _ny, nz) => z >= cut * 1.76 - .025 && nz > .82 ? bands : copper },
      { res: .051, cell: .036, maxWork: 80000000, objectId: 'sectioned-bulb' });

      const front = cut * 1.76 + .045, blue = { r: [18, 19, 20, 21], em: true };
      for (const sign of [-1, 1]) {
        const x = sign * 2.12;
        S.tube([[x, .44, front], [x, 3.91, front]], .016, .016, steel, { res: .028 });
        for (let i = 0; i < 23; i++) {
          const y = .48 + i * .151, width = i % 5 === 0 ? .15 : .075;
          S.tube([[x, y, front + .008], [x - sign * width, y, front + .008]], .013, .013,
            i % 5 === 0 ? blue : steel, { res: .029 });
        }
      }
    }
    S.bake();
    return B.finish({
      spriteSurfaces: sprite.finish(),
      cam: { target: gallery ? [0, 1.29, .08] : [0, 2.04, -.06], dist: gallery ? 8.85 : 10.62,
        yaw: gallery ? .11 : .34, pitch: gallery ? .27 : .15, fov: .56 },
      radius: gallery ? 6 : 5, detail: 25, dither: .15, look: { pixel: true, pixelSize: 1, splatCoverage: 'continuous' }
    });
  }
});
