const palette = [
  0x121b27, 0x233345, 0x3a5060, 0x58717b, 0x859798, 0xacb5a5,
  0x183c3c, 0x26605b, 0x408d7e, 0x79c0a3, 0xc0e3bb,
  0x532b39, 0x895052, 0xb87561, 0xedab7a, 0xffdda3,
  0x3b3355, 0x5b5079, 0x7d739a, 0xad9cbb
];

module.exports = ({ KIT: K, TexturedSurface, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'surface-phyllotaxis',
  name: 'Spiral specimens',
  seed: 63,
  build(seed, { controls } = {}) {
    const form = controls?.form ?? 'sphere';
    if (!['sphere', 'shell'].includes(form)) throw new RangeError('Use sphere or shell');
    const shell = form === 'shell', V = K.V, tau = Math.PI * 2;
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .42, sky: .24, sun: V.norm([-.66, .72, .64]), sunK: .84 });
    const { sphere, surface } = K.procedural.sampling.phyllotaxis;
    const steel = { r: [0, 1, 2, 3] }, bronze = { r: [11, 12, 13, 14] };
    const gold = { r: [13, 14, 15], em: true };
    const jade = { r: [6, 7, 8, 9, 10] }, silver = { r: [16, 17, 18, 19, 5] };
    const plate = (body, ridge) => S.template(T => {
      T.ball([0, .11, -.06], [.33, .16, .49], body, { res: .11 });
      T.ball([0, .13, .29], [.19, .13, .24], body, { res: .11 });
      T.tube([[0, .22, -.34], [0, .275, -.12], [0, .265, .13], [0, .225, .39]], .043, .027, ridge, { res: .083 });
    });
    const plates = [plate(jade, { r: [8, 9, 10] }), plate(bronze, gold), plate(silver, { r: [18, 19, 5] })];

    S.lathe([0, -.13, 0], .28, [2.17, 2.07], steel, { res: .13 });
    S.lathe([0, .011, 0], .075, [2.10, 2.08], bronze, { res: .10 });
    S.lathe([0, .095, 0], .13, [1.91, 1.82], steel, { res: .11 });
    S.torus([0, .16, 0], 1.67, .018, bronze, { res: .095 });
    for (let i = 0; i < 28; i++) {
      const a = tau * i / 28;
      S.ball([1.77 * Math.sin(a), .17, 1.77 * Math.cos(a)], [.035, .021, .035],
        i % 7 ? bronze : gold, { res: .05 });
    }

    let layout, sprites;
    if (shell) {
      function section(v) {
        const turn = tau * 1.80, angle = .20 + turn * (v - 1);
        const r = 1.72 * Math.exp(.185 * (angle - .20)), c = Math.cos(angle), s = Math.sin(angle);
        const point = [r * c, 1.94 + r * s, -.24 + .63 * v ** 5];
        const tangent = V.norm([r * turn * (.185 * c - s), r * turn * (.185 * s + c), 3.15 * v ** 4]);
        const right = V.norm(V.cross(tangent, [0, 0, 1])), up = V.cross(tangent, right);
        return { point, tangent, right, up, radius: r * .47 };
      }
      function skin(u, v) {
        const { point, right, up, radius } = section(v), angle = u * tau;
        return V.mad(V.mad(point, right, radius * Math.cos(angle)), up, radius * Math.sin(angle));
      }
      const chart = TexturedSurface.grid({ segments: [64, 120], point: skin });
      layout = surface(chart, { capacity: 440, wrapU: true, phase: .45, resolution: [64, 120],
        density: ({ uv: [u, v] }) => .18 + 3.6 * (.5 - .5 * Math.sin(u * tau)) ** 4 * (.72 + .28 * Math.sin(v * Math.PI)) });
      const atlas = SpriteSurface.make(256, 320);
      const skinColors = [0x302939, 0x473549, 0x583e50, 0x6d4b57, 0x865e62, 0xa4746a, 0xb9907f];
      atlas.mesh(chart, 160, 272, (x, y) => {
        const a = x / 159 * tau, v = y / 271;
        const ridge = Math.sin(v * 28 * tau + Math.cos(a) * .63);
        const light = .49 - .30 * Math.sin(a) + .095 * Math.cos(a) + .07 * ridge;
        return skinColors[Math.max(0, Math.min(6, Math.round(light * 6)))];
      });
      const { point, tangent, right, up, radius } = section(1);
      const interior = V.mad(point, tangent, -.055);
      atlas.face(V.mad(V.mad(interior, right, -radius), up, -radius), V.mul(right, 2 * radius), V.mul(up, 2 * radius),
        64, 64, (x, y) => {
          const ring = Math.hypot(x - 31.5, y - 31.5);
          if (ring < 22) return 0x1d1a26;
          if (ring <= 30) return ring < 26 ? 0x3e2c3c : 0x60404c;
        });
      S.torus(point, radius, .055, bronze, { ax: [right, tangent, V.cross(right, tangent)], res: .067 });
      S.torus(V.mad(point, tangent, .055), radius * .94, .028, gold,
        { ax: [right, tangent, V.cross(right, tangent)], res: .067 });
      sprites = atlas.finish();
    } else {
      const center = [0, 1.85, 0], radius = 1.55;
      S.ball(center, radius, { r: [0, 6, 7, 1, 2] }, { res: .089 });
      layout = sphere({ center, radius, capacity: 320, axis: [-.24, .91, .33], phase: .73,
        density: ({ uv: [, v] }) => .69 + 1.25 * Math.sin(Math.PI * v) ** 2 });
    }
    for (const item of layout.points()) {
      const { id, uv: [, v], point, normal, tangent, bitangent, spacing } = item;
      const forward = V.norm(V.mad(V.mul(tangent, .68), bitangent, .74));
      const across = V.cross(normal, forward);
      const color = shell ? (id % 11 === 0 || v > .86 ? 1 : id % 5 === 0 ? 0 : 2)
        : id % 17 === 0 || v < .11 ? 1 : id % 9 === 0 ? 2 : 0;
      const scale = shell ? Math.min(spacing * .97, .116 + .091 * v) : Math.min(.39, spacing * 1.04);
      S.place(plates[color], V.mad(point, normal, shell ? .021 : .044), { solid: false,
        R: [...across, ...normal, ...forward], scale, born: shell ? undefined : .25 + id / layout.capacity * 3.55 });
    }
    S.bake();
    return B.finish({
      cam: shell ? { target: [.40, 1.27, .02], dist: 8.65, yaw: -.18, pitch: .24, fov: .61 }
        : { target: [0, 1.42, 0], dist: 8.0, yaw: -.06, pitch: .16, fov: .62 },
      radius: 5.2, detail: 27, dither: .15, spriteSurfaces: sprites,
      look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
  }
});
