const palette = [
  0x100f20, 0x1d1a32, 0x292740, 0x3a3a55, 0x55576f, 0x6c7183,
  0x3a253a, 0x614354, 0x946655, 0xb48867, 0xd4a97b, 0xffdb9d,
  0x122522, 0x174136, 0x23554a, 0x307359, 0x4d9365, 0x79b879, 0xa4cc87,
  0xceecaa, 0xf1edbd,
  0x211a43, 0x302758, 0x46316f, 0x64448d, 0x795ca8, 0x9276be, 0xb79cd9,
  0x4c273f, 0x74394d, 0x9c4d65, 0xca697e, 0xe18888, 0xffa18e,
  0x542e2c, 0x864735, 0xb76546, 0xd68855, 0xf2b76f, 0xffd396, 0xffebc2,
  0x243653, 0x304b74, 0x456596, 0x5e84b9, 0x83aed6, 0xb6d9e8, 0xe2fbf1
];

function text(font, atlas, center, y, z, width, title, color) {
  const glyphs = [...title].map(char => font.get(char)), n = title.length * 6 + 4;
  atlas.face([center - width / 2, y, z], [width, 0, 0], [0, width * 10 / n, 0], n, 10, (u, v) => {
    const x = u - 2, row = v - 1;
    if (x >= 0 && row >= 0 && row < 7 && glyphs[Math.floor(x / 6)]?.[row * 6 + x % 6]) return color;
  });
}

function fernPlate(IFS, atlas, seed) {
  const resolution = [252, 384], width = 2.61, height = 3.83, [w, h] = resolution;
  const fern = IFS.preset('barnsley').density({ seed, count: 700000, resolution, exposure: .72,
    bounds: { min: [-2.90, -.23], max: [2.95, 10.38] }
  });
  atlas.face([-1.93 - width / 2, .67, -.34], [width, 0, 0], [0, height, 0], w, h, (i, j) => {
    const { density, color } = fern.bin(i, h - j - 1), rim = Math.min(i, j, w - 1 - i, h - 1 - j);
    if (rim === 3) return 0x4d9365;
    if (density) {
      const ink = Math.min(8, Math.floor((density ** .56 * .83 + color * .17) * 9));
      return palette[12 + ink];
    }
    return (i % 18 === 10 && j % 18 === 10) ? 0x23554a : 0x122522;
  });
}

function tetrahedron(K, B, seed) {
  const cloud = K.procedural.ifs.preset('tetrahedron').points({ seed, count: 35000 });
  const R = K.M.rot([0, 1, 0], -.23), tones = [23, 24, 25, 43, 44, 45, 46, 47];
  const first = B.count();
  for (let i = 0, j = 0; i < cloud.count; i++, j += 3) {
    const [a, b, c] = K.M.app(R, cloud.positions.subarray(j, j + 3));
    const shade = Math.min(tones.length - 1, Math.floor(tones.length * cloud.colors[i]));
    B.iso(1.99 + a * 1.37, 1.79 + b * 1.52, .02 + c * 1.37, .011 + .005 * cloud.colors[i],
      B.P[tones[shade]], .49, { em: true, nd: true });
  }
  B.describeSplats?.(first, B.count(), { object: 'tetrahedron', material: 'structure-color' });
}

function flame(K, seed) {
  const { M } = K, { ifs, density } = K.procedural;
  const matrix = (scale, x, y, z) => M.mul(M.rot([0, 0, 1], z),
    M.mul(M.rot([0, 1, 0], y), M.rot([1, 0, 0], x))).map(v => v * scale);
  const maps = [
    [.61, [.1, -.43, .35], [.20, .43, .34], 3, .12, 'swirl', .45],
    [.58, [-.63, .45, -.57], [-.48, -.28, .09], 3, .42, 'horseshoe', .36],
    [.65, [.45, .47, 1.20], [.48, -.35, -.32], 4, .91, 'swirl', .29],
    [.47, [.32, -.21, -1.76], [-.11, .09, -.62], 2, .74, 'bubble', .69]
  ];
  const system = ifs.compile({
    dimension: 3,
    transforms: maps.map(([scale, turns, offset, weight, color, type, blend]) => ({
      matrix: matrix(scale, ...turns), offset, weight, color,
      variations: [{ type: 'linear', weight: 1 - blend }, { type, weight: blend }]
    })),
    final: {
      matrix: matrix(1.15, .24, -.22, -.4),
      variations: [{ type: 'swirl', weight: .58 }, { type: 'linear', weight: .42 }],
      post: { matrix: matrix(2.37, 0, -.12, .48), offset: [0, 2.63, 0] }
    }
  });
  const grid = system.density({ seed, count: 1600000, resolution: [116, 108, 116], exposure: .27,
    bounds: { min: [-2.37, .72, -2.37], max: [2.37, 4.68, 2.37] }
  });
  let previous = [], value;
  function probeGrid(x, y, z) {
    if (x !== previous[0] || y !== previous[1] || z !== previous[2]) {
      previous = [x, y, z];
      value = grid.at(x, y, z);
    }
    return value;
  }
  const optics = [
    { color: '#695bfc', emission: '#a19cfc', weight: hue => 1 - hue },
    { color: '#ff866b', emission: '#ffd194', weight: hue => hue }
  ];
  return optics.map(({ color, emission, weight }) => {
    const field = density.bounded({
      bounds: grid.bounds,
      sample(x, y, z) {
        const { density, color: hue } = probeGrid(x, y, z);
        return density ? density ** 1.08 * weight(K.clamp((hue - .22) / .68, 0, 1)) : 0;
      }
    });
    return K.atmosphere.field({ field, color, emissive: emission, emissiveGain: .64, density: 6.7, step: .038, lit: false });
  });
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'iterated-flame-studies',
  name: 'Recursion Cabinet and Ion Bloom',
  seed: 29,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'cabinet';
    if (!['cabinet', 'bloom'].includes(study)) throw new RangeError('Use cabinet or bloom');
    const cabinet = study === 'cabinet', B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .36, sky: .19, sunK: .64, sun: K.V.norm([-.52, .69, .53]) });
    const sprite = SpriteSurface.make(512), font = K.inspection.font({});
    const dark = { r: [0, 1, 2, 3, 4] }, steel = { r: [1, 2, 3, 4, 5] }, bronze = { r: [6, 7, 8, 9, 10, 11] };
    const turquoise = { r: [43, 44, 45, 46], em: true };
    const box = (p, h, mat, res = .086, rd = .048) => S.box(p, h, mat, { res, rd });
    if (cabinet) {
      box([-1.93, 2.60, -.86], [1.51, 2.12, .32], dark, .107, .12);
      box([-1.93, 2.59, -.58], [1.39, 1.99, .19], bronze, .091);
      box([0, .16, -.04], [3.67, .21, 1.70], steel, .117, .10);
      box([0, .38, .06], [3.39, .069, 1.48], bronze, .105);
      box([1.95, .48, 0], [1.49, .075, 1.38], dark, .077);
      for (const x of [-1.93, 1.99]) box([x, .244, 1.677], [1.37, .115, .105], dark, .074);
      text(font, sprite, -1.93, .244, 1.803, 1.94, 'BARNSLEY FERN', 0xffdb9d);
      text(font, sprite, -1.93, .156, 1.803, 1.27, 'DENSITY PRINT', 0x79b879);
      text(font, sprite, 1.99, .244, 1.803, 2.23, 'SIERPINSKI SOLID', 0xffdb9d);
      text(font, sprite, 1.99, .156, 1.803, 1.25, 'POINT CLOUD', 0x83aed6);
      const base = [1.99, .59, 0];
      S.torus(base, 1.15, .023, bronze, { res: .045 });
      for (let i = 0; i < 12; i++) {
        const d = i * Math.PI / 6;
        S.ball([base[0] + 1.21 * Math.cos(d), base[1], 1.21 * Math.sin(d)], .024, turquoise, { res: .027 });
      }
      fernPlate(K.procedural.ifs, sprite, seed);
      tetrahedron(K, B, seed);
    } else {
      box([0, .07, 0], [2.52, .23, 2.36], dark, .124, .12);
      box([0, .30, 0], [2.36, .079, 2.22], steel, .100);
      box([0, .37, 0], [2.17, .058, 2.06], dark, .090);
      S.torus([0, .47, 0], 1.69, .076, dark, { res: .065 });
      S.torus([0, .53, 0], 1.74, .028, bronze, { res: .053 });
      S.torus([0, .55, 0], 1.51, .021, turquoise, { res: .048 });
      for (let i = 0; i < 16; i++) {
        const d = i * Math.PI / 8;
        S.ball([1.87 * Math.cos(d), .49, 1.87 * Math.sin(d)], .032, turquoise, { res: .033 });
      }
      for (const sign of [-1, 1]) {
        const x = sign * 2.21;
        box([x, .64, -.50], [.17, .23, .27], bronze, .079);
        S.tube([[x, .79, -.50], [x, 3.44, -.50], [x * .83, 4.29, -.50]], .038, .038, steel, { res: .047 });
        for (let i = 0; i < 14; i++) {
          const y = .9 + i * .185;
          S.tube([[x, y, -.47], [x - sign * (i % 4 === 0 ? .16 : .09), y, -.47]], .013, .013,
            i % 4 === 0 ? turquoise : bronze, { res: .033 });
        }
      }
      box([0, .137, 2.325], [1.55, .133, .106], dark, .068, .032);
      text(font, sprite, 0, .15, 2.46, 1.65, 'ION BLOOM', 0xffdb9d);
      text(font, sprite, 0, .035, 2.46, 1.98, '3D FRACTAL FLAME', 0x83aed6);
    }
    S.bake();
    return B.finish({
      spriteSurfaces: sprite.finish(),
      ...(cabinet ? {} : { atmosphere: flame(K, seed), volumeQuality: { scale: 2, steps: 110, jitter: 'blue-noise', seed } }),
      cam: cabinet
        ? { target: [0, 2.19, -.05], dist: 10.45, pitch: .12, yaw: -.09, fov: .60 }
        : { target: [0, 2.15, 0], dist: 11.45, pitch: .16, yaw: .15, fov: .61 },
      radius: 6, detail: 26, dither: .1, look: { pixelSize: 1, pixel: true, splatCoverage: 'continuous' }
    });
  }
});
