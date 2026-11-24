module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'material-masks',
  name: 'Wrapped glazes and distance ink',
  seed: 2,
  build(seed) {
    const { materials, forms } = K.procedural,
      clay = materials.ramp([0x53343e,0xcf865e,0xf3c885], { steps: 7, space: 'lch' }).hex,
      copper = materials.ramp([0x233b42,0x4d7d75,0xbbcda4], { steps: 7 }).hex,
      paper = materials.ramp([0x453f42,0x7f6c56,0xe9cc91], { steps: 7 }).hex,
      palette = [0x17282e,0x3f494a,0x586160,0x6d7270,0x8b8b73,0xac9f78,...clay,...copper,...paper,0xe9d0a2,0x9cd6ba,0x523b32],
      B = makeBuilder(18, palette), S = K.sculpt(makeSculpt(B)),
      range = start => Array.from({ length: 7 }, (_, i) => start + i),
      stone = { r: [1,2,3,4,5] }, ochre = range(6), jade = range(13), sand = range(20);
    S.pixel = true;
    for (const x of [-2.06,0,2.03]) S.box([x,-0.01,0], [0.94,0.12,0.87], stone, { rd: 0.063, res: 0.068 });
    const glaze = K.surface.material({
      r: ochre,
      wear: { from: 0.95, to: 3.2, t: 0.28 },
      grime: { from: 0.37, to: 0.8, t: -0.15 }
    }, {
      layers: { coating: { type: 'directionalColor', color: '#ffe2a0', crossColor: '#ffe2a0', strength: 0.76,
        mask: materials.threshold(materials.triplanar((u,v) =>
          Math.cos(Math.PI * 2 * (v + 0.46 * Math.sin(u * 3.4) + 0.1 * Math.cos(u * 7.6))), {
          scale: [0.36,0.39,0.38], sharpness: 3, origin: [-2.06,0.91,0]
        }), { level: 0.78, feather: 0.20, samples: 4, seed }) }
      }
    });
    S.implicitForm(forms.superquadric({
      radii: [0.75,0.73,0.67], exponents: [4.1,4.8], pose: { position: [-2.06,0.84,0], rotation: [0.02,0.14,-0.085] }
    }), glaze, { res: 0.054 });
    const grain = materials.tangent((u,v) => Math.cos(2 * Math.PI * (v + 0.19 * Math.cos(u * 3.8))), {
      scale: [0.84,0.14], origin: [0,0.92,0]
    });
    const directional = K.surface.material({ r: jade }, {
      direction: { type: 'circular', axis: 'y' },
      layers: { mark: { type: 'directionalColor', color: '#9cd6ba', crossColor: '#9cd6ba', strength: 0.58,
        mask: materials.threshold(grain, { level: 0.46, feather: 0.14, samples: 4, seed }) },
        shine: { type: 'specular', color: '#e9d0a2', roughness: [0.09,0.36], strength: 0.44 }
      }
    });
    S.ball([0,0.78,0], [0.71,0.69,0.66], directional, { res: 0.054 });
    const n = 35, cell = 0.044, imprint = Uint8Array.from({ length: n * n }, (_,i) => {
      const x = i % n - 17, z = Math.floor(i / n) - 17, r = Math.hypot(x,z), a = Math.atan2(z,x);
      return Number(r < 8.8 + 3.8 * Math.cos(4 * a + 0.5) && r > 2.2);
    }), mark = materials.outline(imprint, { size: [n,n], outer: 2.1, inner: 1.15 }),
      rows = Array.from({ length: n }, (_,z) => Array.from({ length: n }, (_,x) => {
        if (Math.hypot(x - 17,z - 17) > 16.7) return '.';
        const i = z * n + x;
        return mark.outside[i] ? 'a' : mark.inside[i] ? 'b' : imprint[i] ? 'c' : 'd';
      }).join(''));
    const base = rows.map(row => row.replace(/[^.]/g, 'd'));
    S.vox({ cell: [cell,0.071,cell], hard: true, key: { a: [6,7,8,9], b: [22,23,24,27], c: jade, d: sand },
      layers: [[base,2],rows]
    }, { at: [2.03,0.1,0], res: 0.035, round: 0.25 });
    S.bake();
    return B.finish({ cam: { target: [0,0.53,0], dist: 8.7, pitch: 0.73, yaw: seed % 2 ? -0.26 : 0.18 },
      radius: 3.48, detail: 23, look: { pixel: true }, dither: 0.15 });
  }
});
