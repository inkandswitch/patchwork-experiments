module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'vegetation-growth',
  name: 'Seedling and leaf studies',
  seed: 4,
  build(seed) {
    const B = makeBuilder(24, [
      0x202a2e, 0x30382e, 0x4a5045, 0x646451, 0x83765c, 0xad9670,
      0x534136, 0x81573e, 0x9d6a43, 0xc08a53, 0xebbd78,
      0x293f40, 0x406156, 0x527d63, 0x71926e, 0x9bb07a, 0xc1cb83,
      0x728785, 0x9ca99b, 0xb8bca5, 0x324e56, 0x4a6570, 0x7198a0
    ]), S = K.sculpt(makeSculpt(B)), { growth } = K.procedural,
      leaf = { r: [12, 13, 14, 15, 16] },
      bark = { r: [7, 8, 9, 10] }, ochre = { r: [8, 9, 10, 11] };
    S.box([-1.47, -0.6, -0.1], [1.37, 0.67, 0.49], { r: [1, 2, 3, 4, 5] }, { rd: 0.11, res: 0.06 });
    S.box([-1.47, 0.035, -0.1], [1.37, 0.078, 0.49], { r: [2, 12, 13, 14] }, { rd: 0.055, res: 0.055 });
    const run = (length, radius) => ({ symbol: 'F', args: [length, radius] }),
      bud = (length, radius) => ({ symbol: 'B', args: [length, radius] }),
      scaled = (arg, scale) => ({ arg, scale }),
      fork = (sign, turn, len, taper) => ['[', { symbol: sign, args: [turn] },
        { symbol: '!', args: [scaled(1, taper)] },
        bud(scaled(0, len), scaled(1, taper)), ']'],
      shoot = (turn, spread) => [
        run(scaled(0, 0.61), scaled(1, 0.79)),
        ...fork('+', turn, spread, 0.55),
        ...fork('-', turn * 0.82, spread * 0.92, 0.57),
        bud(scaled(0, 0.73), scaled(1, 0.7))
      ],
      frame = { origin: [-1.5, 0.08, 0.14], radius: 0.112, up: [0, 0, 1] },
      tree = growth.lsystem([run(0.51, 0.083), bud(0.97, 0.083)], [
        { from: 'B', when: (_, c) => c.generation < 3 && c.environment > 0, to: shoot(0.69, 0.79), weight: 2 },
        { from: 'B', when: (_, c) => c.generation < 3 && c.environment > 0, to: shoot(1.07, 0.73) },
        { from: 'B', to: [run(scaled(0, 0.37), scaled(1, 0.45)), 'L'], weight: (_, c) =>
          c.generation === 3 || c.environment <= 0 ? 1 : 0 }
      ], { generations: 4, seed, frame, environment: (_, { frame }) => 1.04 - Math.abs(frame.p[0] + 1.5) });
    const branches = growth.turtle(tree.tokens, frame);
    K.grow.limbs(S, branches, bark, { res: 0.035, melt: 0.016 });
    for (const [i, { p, direction }] of branches.marks.entries()) {
      const at = K.V.mad(p, direction, 0.08), size = 0.11 + 0.05 * K.hash(i, seed, 5);
      S.ball(at, [size * 1.11, size * 0.65, size * 0.4], leaf, { res: 0.052 });
    }
    const rock = [-1.54, -0.57, 0.44], obstacles = (x, y, z) => K.V.len(K.V.sub([x, y, z], rock)) - 0.25,
      roots = growth.roots([[-1.48, 0.06, 0.43], [-1.53, 0.06, 0.44]], {
        obstacle: obstacles, gravity: [0, -1, 0], gravityBias: 0.72,
        moisture: (x, y) => Math.exp(-((x + 2.05) ** 2)) * 0.16 - y * 0.04,
        allowed: (x, y, z) => x > -2.65 && x < -0.29 && y > -1.21 && z > 0.35 && z < 0.59,
        waterBias: 0.62, step: 0.084, length: 1.59, tipRadius: 0.017, jitter: 0.15,
        branchChance: 0.24, clearance: 0.038, seed
      });
    S.ball(rock, [0.24, 0.235, 0.19], { r: [17, 18, 19] }, { res: 0.052 });
    K.grow.limbs(S, roots, ochre, { res: 0.028, melt: 0.014 });

    const outline = [[-0.04,-1.35],[-0.45,-0.91],[-0.79,-0.23],[-0.82,0.32],[-0.68,0.81],
      [-0.31,1.3],[0.2,1.54],[0.51,1.13],[0.81,0.58],[0.86,-0.04],[0.68,-0.53],[0.32,-0.99]],
      veins = growth.venation(outline, { root: [-0.04,-1.35], toward: [0.19,1.12], step: 0.09,
        trunk: 0.4, sourceSpacing: 0.21, influence: 0.72, kill: 0.095, tipRadius: 0.014, seed }),
      x = 1.58, y = 0.46;
    S.extrude([outline], [x,y,0.02], 0.17, leaf, { res: 0.045 });
    K.grow.limbs(S, { limbs: veins.limbs.map(limb => ({ ...limb,
      pts: limb.pts.map(([a,b]) => [a+x,b+y,0.14])
    })) }, { r: [4, 9, 11, 16] }, { res: 0.028, melt: 0.009 });
    S.tube([[x - 0.23, y - 1.63, 0.05], [x - 0.04, y - 1.35, 0.16]], 0.049, 0.029, ochre, { res: 0.031 });
    S.bake();
    return B.finish({ cam: { target: [0, 0.45, 0], dist: 7.4, pitch: 0.14, yaw: 0.15 },
      detail: 18, dither: 0.19, radius: 3.55 });
  }
});
