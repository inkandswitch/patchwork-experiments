module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'contact-masks',
  name: 'Rain on sandstone',
  seed: 1,
  build(seed) {
    const palette = [
      0x1d2a30, 0x463a38, 0x705348, 0xa17859, 0xc89a71, 0xf0c28c,
      0x273a39, 0x45634d, 0x70824e, 0x99a667,
      0x3b3535, 0x62514b, 0x85705b, 0xaf8d65,
      0x4e3333, 0x804237, 0xb25b3a, 0xe08250
    ];
    const B = makeBuilder(14, palette),
      S = K.sculpt(makeSculpt(B)),
      P = K.procedural,
      detailed = seed % 2 === 1;
    const wallZ = 0.22,
      ground = (x, z) => 0.03 + 0.08 * Math.cos(x * 0.8 + z * 0.6),
      wall = P.surface.plane({ id: 'sandstone', origin: [-3.1, -0.13, wallZ], u: [6.2, 0, 0], v: [0, 2.93, 0] }),
      roofStone = { r: [10, 11, 12, 13] },
      floor = { r: [1, 2, 3, 4], mod: (x, y, z) => (B.n3(x * 2, y * 2, z * 2) - 0.5) * 0.25 },
      rockSpecs = [[-1.47, 2.15, 0.11, 1.05, 0.27, 0.58], [0.9, 2.29, 0.1, 1.2, 0.29, 0.64]];
    const ledges = rockSpecs.map(([x, y, z, a, b, c]) => S.ball([x, y, z], [a, b, c], roofStone, { res: 0.071 })),
      ledge = (x, y, z) => Math.min(...ledges.map(solid => S.psd(solid, x, y, z))),
      upper = P.contacts.traceSdf(wall, ledge, { id: 'overhang', cell: 0.014 }),
      foot = P.contacts.traceSdf(wall, (x, y, z) => y - ground(x, z), { id: 'wall-foot', cell: 0.014 }),
      trails = P.contacts.runoff(upper, ([x, y]) => {
        if (y < ground(x, wallZ) + 0.02 || Math.abs(x) > 3.08) return null;
        return { p: [x, y, wallZ], n: [0, 0, 1] };
      }, { spacing: 0.2, step: 0.06, distance: 1.4 });
    const flecks = K.tex.noise(13, 2),
      rain = P.contacts.field(trails).mask({
        inner: 0.008, outer: 0.062,
        weight: (hit, p) => (1 - hit.t) * (0.4 + 0.6 * flecks(p[0] * 0.6, p[1] * 0.1, p[2]))
      }),
      seam = P.contacts.field(upper).mask({ inner: 0.04, outer: 0.15 }),
      damp = P.contacts.field(foot).mask({
        inner: 0.07, outer: 0.61,
        weight: (hit, p) => {
          const noise = flecks(p[0] * 0.38, p[1] * 0.56, p[2]);
          return (p[2] < wallZ + 0.32 ? 1 : 0.6) * Math.min(1, 0.25 + noise * 1.1);
        }
      });
    const sandstone = {
      r: [1, 2, 3, 4, 5],
      mod: (x, y, z) => (B.n3(x * 1.3, y * 7, z * 2) - 0.5) * 0.24,
      tex(x, y, z, ny, intensity, nx, nz) {
        if (!detailed || nz < 0.45) return;
        if (damp(x, y, z) > 0.39) return S.pick([6, 7, 8, 9], intensity);
        const mark = rain(x, y, z);
        if (mark > 0.28) return S.pick([14, 15, 16, 17], intensity * 0.87);
        if (seam(x, y, z) > 0.25) return S.pick([10, 11, 12], intensity);
      }
    };
    const finish = detailed ? K.surface.material(sandstone, { layers: {
      damp: { type: 'sheen', strength: 0.22, power: 2, color: '#789781', mask: damp }
    } }) : sandstone;
    S.box([0, 1.21, wallZ - 0.53], [3.2, 1.35, 0.53], finish, { rd: 0.065, res: 0.065 });
    S.ground(floor, { h: ground, rad: 4.04, cx: 0.19, cz: 0.13, zs: 1.38, edge: 0.02, res: 0.09 });
    for (const [x, z, r] of [[-2.8, 1.1, 0.31], [-1.5, 1.7, 0.26], [1.45, 1.38, 0.28], [2.79, 1.09, 0.39]]) {
      S.rock([x, ground(x, z) + r * 0.4, z], r, roofStone, { res: 0.07 });
    }
    if (detailed) {
      const moss = { r: [6, 7, 8, 9] };
      for (let i = 0; i < 90; i++) {
        const x = -2.95 + B.R() * 5.9,
          z = wallZ + 0.39 * B.R(),
          y = ground(x, z),
          r = 0.035 + 0.048 * B.R();
        if (damp(x, y, z) > 0.42) S.ball([x, y + r * 0.3, z], [r, r * 0.7, r], moss, { res: 0.052 });
      }
    }
    S.bake();
    return B.finish({ cam: { target: [0, 1.2, 0], dist: 9.6, pitch: 0.28, yaw: 0.25 }, detail: 22, dither: 0.28, radius: 4.4 });
  }
});
