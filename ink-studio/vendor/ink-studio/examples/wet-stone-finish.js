module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'wet-stone-finish',
  name: 'After the rain at Lantern Court',
  seed: 58,
  build(seed) {
    const palette = [
      0x151e31, 0x222b3a, 0x2d3745, 0x414b54, 0x5d6668, 0x7b8078, 0x9c9b87, 0xbdb7a0, 0xd5cdb8,
      0x254353, 0x35596d, 0x49748c, 0x6b9bb4, 0x91bfcd, 0xb9d7dc, 0xcbdde1, 0xf0f4de,
      0x392b33, 0x553937, 0x744d42, 0xa67455, 0xd39861, 0xeebb7f, 0xffdb9d,
      0x2d403a, 0x41594a, 0x5e7661, 0x80907a
    ];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const key = K.V.norm([-.17, .57, -.82]);
    Object.assign(S, { pixel: true, sun: key, amb: 0.33, sunK: 0.51, sky: 0.17, wob: 0.035 });
    const film = { type: 'weather', channel: 'wetness', range: [0.02, 0.25] };
    const absorption = { type: 'tint', blend: 'multiply', color: [0.49, 0.57, 0.64], strength: 0,
      drive: { strength: { signal: 'film', to: 1 } } };
    const stone = K.surface.material({ r: [1, 2, 3, 4, 5, 6, 7], materialId: 'paving' }, {
      signals: { film },
      normal: { type: 'noise', amplitude: 0.21, scale: 0.27 },
      layers: {
        absorption,
        polish: { type: 'specular', color: 15, roughness: [0.54, 0.36], strength: 0.14,
          drive: { roughness: { signal: 'film', to: [0.14, 0.19] }, strength: { signal: 'film', to: 0.66 } } }
      }
    });
    const seam = K.surface.material({ r: [1, 2, 3, 4], materialId: 'seams' }, {
      signals: { film, pool: { type: 'weather', channel: 'standingWater', range: [0.01, 0.095] } },
      layers: {
        absorption,
        reflection: { type: 'reflection', source: 'scene', f0: 0.96, strength: 0, power: 3,
          drive: { strength: { signal: 'pool', to: 0.98 } } }
      }
    });
    const largeStone = { r: [1, 2, 3, 4, 5, 6] };
    const dressedStone = { r: [2, 3, 4, 5, 6, 7] };
    const copper = { r: [17, 18, 19, 20, 21] };
    const moss = { r: [24, 25, 26, 27] };
    const spacing = 0.74;
    const jointDistance = x => Math.abs(x - Math.round(x / spacing) * spacing);
    const channel = (x, z) => Math.max(0, 1 - Math.min(jointDistance(x), jointDistance(z)) / 0.18);
    const lowCourt = (x, z) => Math.max(0, 1 - ((x - 0.65) / 2.35) ** 2 - ((z - 0.85) / 1.8) ** 2);
    const exposed = (x, z) => x > -2.6 || z > -0.25;
    S.box([0, -0.16, 0.36], [3.34, 0.14, 2.76], seam, { res: 0.085, rd: 0.047, objectId: 'recessed-joints' });
    for (let row = -3; row < 4; row++) for (let col = -4; col < 4; col++) {
      const x = (col + 0.5) * spacing, z = (row + 0.5) * spacing;
      const y = -0.035 + 0.023 * Math.sin(col * 1.72 + row * 3.1);
      const half = 0.308 - 0.014 * Math.sin(col * 2.6 + row);
      S.box([x, y, z], [half, 0.10, 0.293], stone, {
        res: 0.061, rd: 0.07, bump: [0.02, 4.3], objectId: 'stone-paving'
      });
    }
    for (const x of [-2.97, 2.97]) {
      S.box([x, .07, -0.1], [0.19, .17, 2.42], dressedStone, { res: 0.086, rd: .065 });
      S.box([x, .39, -2.18], [.36, .40, .35], largeStone, { res: .081, rd: .071 });
      S.box([x, .89, -2.18], [.26, .27, .26], dressedStone, { res: .07, rd: .042 });
    }

    for (let row = 0; row < 5; row++) for (let col = -3; col <= 3; col++) {
      const x = col * .93 + (row % 2) * .29;
      if (Math.abs(x) < 1.23 && row < 4) continue;
      S.box([x, .24 + row * .39, -2.35], [.45, .192, .20], largeStone,
        { res: .087, rd: .055, bump: [.018, 3.7] });
    }
    for (let j = 0; j <= 10; j++) {
      const a = Math.PI * j / 10;
      const x = 1.21 * Math.cos(a), y = .94 + .81 * Math.sin(a);
      S.rock([x, y, -2.15], [.24, .23, .24], dressedStone, { res: .075 });
    }
    S.box([0, -.04, -2.09], [1.19,.097,.29], dressedStone, { res: .072, rd:.048 });
    S.box([0, -.017, -2.55], [1.18,.12,.22], largeStone, { res: .084, rd:.052 });

    for (const x of [-1.88, 1.88]) {
      S.lights.push({ p:[x,.92,-1.66], r:1.35, s:.73, c:[21,22,23] });
      S.box([x, 1.03, -2.055], [.09,.27,.065], copper, { res: .048, rd:.028 });
      S.tube([[x, 1.17, -2.1], [x, 1.17, -1.85], [x, 1.03, -1.75]], .045, .032, copper, { res: .045 });
      S.lathe([x,.79,-1.75], .13, [.185,.16], copper, { res:.046 });
      S.ball([x,.95,-1.64], [.123,.149,.088], { r:[21,22,23], em:true }, { res:.035, ghost:true });
      S.lathe([x,1.03,-1.75], .15, [.19,.072], copper, { res:.042 });
      for (const side of [-1,1])
        S.tube([[x+side*.125,.85,-1.66],[x+side*.084,1.061,-1.68]], .019, .018, copper, { res:.031 });
    }
    for (const [x,z,r] of [[-3.12,-1.21,.19],[3.08,-.81,.255],[-2.95,1.67,.26],[3.22,1.28,.24]]) {
      S.rock([x,.11,z], [r,.10,r*.81], moss, { res:.068 });
    }
    S.bake();

    const skyEnvironment = {
      defaults: { zenith: '#769dc6', horizon: '#c4dce5', ground: '#263b48',
        sunAltitude: 0.36, sunAzimuth: -2.75, sunStrength: 0.16, sunColor: '#e9cc99', sunRadius: 0.055,
        humidity: 0.78, airTemperature: 12, daylight: 0.38 },
      profiles: { shower: { rain: 0.52 }, clear: { rain: 0 } },
      sequences: { weather: { duration: 6, loop: false, keys: [
        { at: 0, profile: 'shower', ease: 'hold' },
        { at: 1.4, profile: 'clear' }
      ] } },
      tracks: [{ id: 'rain', sequence: 'weather' }]
    };
    return B.finish({
      cam: { target: [0, .42, -.14], dist: 7.65, pitch: .49, yaw: .17, sway: 0 },
      detail: 23, radius: 9, dither: 0, skyEnvironment,
      surfaceLight: [[0, ...key]], look: { pixel: true, splatCoverage: 'continuous' },
      weatherBinding: { surface: {
        width: 68, height: 55, cell: .10, origin: [-3.4, -2.5], capacity: .26, step: .1,
        wetDiffusion: .003, heatDiffusion: 0, maxRunoff: 0, evaporation: .18,
        standingWater: { capacity: (x, z) => .29 * channel(x,z) * lowCourt(x,z), drainage: .029 },
        forcing: (x, z) => ({ precipitationExposure: exposed(x,z) ? 1 : .02 })
      } }
    });
  }
});
