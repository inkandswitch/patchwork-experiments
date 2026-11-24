module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'fracture-studies',
  name: 'Glaze breaks and stress paths',
  seed: 25,
  build(seed) {
    const B = makeBuilder(23, [
      0x202d33, 0x364144, 0x515958, 0x6e7160, 0x92927c,
      0x253943, 0x3c5964, 0x527e86, 0x79aaa8, 0xb6c8ba,
      0x653e37, 0x8e5949, 0xb57a5a, 0xdd9f72, 0xe9be90,
      0x4d3936, 0x84614b, 0xa9805d, 0xcfab7e, 0xe7c49a,
      0x463636, 0x6a4840, 0x95684e, 0xb18d5e
    ]), S = K.sculpt(makeSculpt(B)), { fracture, forms, fields } = K.procedural,
      stone = { r: [1,2,3,4] }, slab = forms.superquadric({ radii: [0.94,0.95,0.14], exponents: [4.6,4.1] });
    for (const x of [-1.62, 1.55]) S.box([x,-0.08,0], [1.43,0.13,0.65], stone, { rd: 0.055, res: 0.062 });
    const seeds = [[-0.57,-0.58],[-0.67,0.03],[-0.46,0.59],[-0.05,0.34],[-0.05,-0.6],
      [0.26,-0.23],[0.5,0.53],[0.58,0.15],[0.55,-0.57],[0.12,0.77]]
      .map(([x,y], i) => ({ id: 'fragment-' + i, point: [x,y,0.024 * Math.cos(i)], weight: 0.04 * Math.sin(i * 1.36) }));
    const broken = fracture.power({ host: slab, seeds, stretch: [1.28,0.79,1.0], rotation: [0,0,0.31],
      cell: 0.052, gap: 0.018
    }), state = fracture.separate(broken, {
      loads: Object.fromEntries(broken.bonds.filter(edge => edge.point[1] > -0.7).map(edge => [edge.id, edge.capacity]))
    });
    const groups = new Map(), lookup = new Map(broken.cells.map(c => [c.id, c]));
    for (const [i, cluster] of state.components.entries()) {
      const center = cluster.reduce((v, id) => K.V.mad(v, lookup.get(id).center, 1 / cluster.length), [0,0,0]),
        delta = [-1.62 + 0.34 * center[0], 1.22 + 0.2 * center[1], 0.11 * Math.sin(i * 2.32)];
      for (const id of cluster) groups.set(id, delta);
    }
    for (const { id, form } of broken.cells) {
      const delta = groups.get(id),
        enlarged = { min: K.V.add(form.bounds.min, delta), max: K.V.add(form.bounds.max, delta) };
      S.implicitForm({ bounds: enlarged, cost: form.cost, sd: (x,y,z) => form.sd(...K.V.sub([x,y,z], delta)) }, {
        r: [5,6,7,8,9],
        rf(x,y,z) {
          const q = K.V.sub([x,y,z], delta);
          if (slab.sd(...q) < -0.02) return [10,11,12,13,14];
          if (Math.abs(q[1] - 0.22 + Math.sin(q[0] * 4.2) * 0.12) < 0.135) return [10,11,12,13,14];
          return null;
        }
      }, { res: 0.045 });
    }

    const carrier = forms.superquadric({
      radii: [1.22,0.86,0.142], exponents: [9,7], pose: { position: [1.55,0.99,0.012] }
    }), width = 64, height = 46,
      lineY = x => 17 + 0.18 * x + 4.8 * Math.sin(x * 0.14),
      stress = fracture.crack({ width, height, starts: [{ at: [2,19], angle: 0.38, energy: 1.15 }],
        seed, branching: 0.04, maxBranches: 3, maxNodes: 245, steer: 0.73, gain: 0.36, alignment: 0.19,
        stress(x,z) {
          return { load: Math.max(0.25, 1.04 - Math.abs(z - lineY(x)) * 0.063), direction: [1,0.18 + 0.672 * Math.cos(x * 0.14)] };
        },
        toughness: (x,z) => 0.12 + 0.019 * Math.abs(z - lineY(x)),
        mask: (x,z) => x < width - 2 && z > 2 && z < height - 2
      }), paths = stress.chains.filter(path => path.length > 1).map(path => path.map(i => {
        const { x, z } = stress.nodes[i];
        return [1.55 + (x / (width - 1) - 0.5) * 2.43, 0.99 + (z / (height - 1) - 0.5) * 1.70, 0.143];
      })), distance = fields.compile({ type: 'distance', paths }),
      sd = (x,y,z) => Math.max(carrier.sd(x,y,z), -Math.max(distance(x,y,0.143) - 0.024, 0.069 - z));
    S.implicitForm({ ...carrier, sd, cost: stress.edges.length }, {
      r: [15,16,17,18,19],
      mod: (x,y,z) => 0.18 * B.n3(x * 8, y * 8, z * 2),
      rf: (x,y,z) => z > 0.068 && distance(x,y,0.143) < 0.044 ? [20,21,22,23] : null
    }, { res: 0.046, cell: 0.038, maxWork: 70000000 });
    S.bake();
    return B.finish({ cam: { target: [0,0.98,0], dist: 8.1, pitch: 0.27, yaw: 0.13 },
      detail: 19, dither: 0.19, radius: 3.6 });
  }
});
