/* A transferable lantern: geometry, pixel sigil, light and inspection share one parent. */
function lanternExchange(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    { sceneGraph: G, Q, M, V } = K;
  const palette = [
    0x081b25, 0x153746, 0x28566a, 0x3c8390, 0x79bbbc, 0xb5d9c6, 0x6b4e35, 0xb17a43, 0xe9af65, 0xffdca0, 0xf4edc8,
    0x345548, 0x608967
  ];
  const graph = G.create({
    nodes: {
      terrace: { label: 'Terrace' },
      west: {
        parent: 'terrace',
        kind: 'geometry',
        label: 'West crane',
        transform: { position: [-2.6, 0, 0] },
        sockets: { shoulder: { position: [0, 2.85, 0] } }
      },
      east: {
        parent: 'terrace',
        kind: 'geometry',
        label: 'East crane',
        transform: { position: [2.6, 0, 0] },
        sockets: { shoulder: { position: [0, 2.85, 0] } }
      },
      'west.arm': {
        parent: { node: 'west', socket: 'shoulder' },
        kind: 'geometry',
        label: 'West arm',
        transform: { rotation: Q.fromAxisAngle([0, 0, 1], -0.15) },
        sockets: { grip: { position: [1.8, 0, 0] } }
      },
      'east.arm': {
        parent: { node: 'east', socket: 'shoulder' },
        kind: 'geometry',
        label: 'East arm',
        transform: { rotation: Q.fromAxisAngle([0, 0, 1], Math.PI + 0.15) },
        sockets: { grip: { position: [1.8, 0, 0] } }
      },
      lantern: {
        parent: { node: 'west.arm', socket: 'grip' },
        kind: 'geometry',
        label: 'Relay lantern',
        transform: { position: [0.13, -0.86, 0], rotation: Q.fromAxisAngle([0, 0, 1], 0.15) }
      },
      sigil: { parent: 'lantern', kind: 'sprite', label: 'Pixel sigil' },
      bulb: { parent: 'lantern', kind: 'light', label: 'Warm point lamp', transform: { position: [0, -0.1, 0] } },
      target: {
        parent: 'lantern',
        kind: 'inspection',
        label: 'Inspection target',
        transform: { position: [0, 0.1, 0.48] }
      }
    }
  });
  const B = makeBuilder(44, palette),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    cap = K.light.capture(B, S);
  S.pixel = true;
  S.pixelSize(34);
  const stone = K.pixel.masonry({ r: [1, 2, 3], stone: [7, 5], joint: 1, seed: 44 }),
    metal = { r: [1, 2, 3, 4, 5] },
    brass = { r: [6, 7, 8, 9] },
    paper = { r: [6, 7, 8, 9, 10] },
    leaf = { r: [11, 12, 4] };
  S.box([0, -0.24, 0], [4.1, 0.3, 2.65], stone, { res: 0.14, rd: 0.17 });
  for (let i = 0; i < 3; i++)
    S.box([0, -0.1 + i * 0.06, 2.7 - i * 0.18], [0.9, 0.08, 0.18], stone, { res: 0.1, rd: 0.035 });
  function axes(node) {
    const a = graph.frame(node).matrix;
    return [
      [a[0], a[3], a[6]],
      [a[1], a[4], a[7]],
      [a[2], a[5], a[8]]
    ];
  }
  function box(node, p, half, mat, rd = 0.025, res = 0.06) {
    S.box(graph.toWorld(node, p), half, mat, { tag: node, ax: axes(node), rd, res });
  }
  function tube(node, points, a, b, mat, res = 0.05) {
    S.tube(
      points.map(p => graph.toWorld(node, p)),
      a,
      b,
      mat,
      { tag: node, res }
    );
  }
  for (const side of ['west', 'east']) {
    box(side, [0, 0.18, 0], [0.58, 0.18, 0.58], stone, 0.06, 0.09);
    box(side, [0, 1.5, 0], [0.16, 1.25, 0.18], metal, 0.035, 0.08);
    box(side, [0, 2.85, 0], [0.32, 0.28, 0.25], brass, 0.08, 0.065);
    for (const d of [-1, 1])
      tube(
        side,
        [
          [d * 0.4, 0.3, 0],
          [d * 0.19, 1.0, 0]
        ],
        0.055,
        0.045,
        brass,
        0.065
      );
    box(side, [0, 1.65, 0.195], [0.1, 0.75, 0.015], brass, 0.01, 0.055);
    for (let y = 0.6; y < 2.7; y += 0.35) box(side, [0, y, 0.23], [0.035, 0.035, 0.025], { r: [5, 9] }, 0.01, 0.045);
    const arm = side + '.arm';
    box(arm, [0.9, 0, 0], [0.95, 0.095, 0.13], metal, 0.03, 0.065);
    for (let x = 0.2; x < 1.9; x += 0.27) box(arm, [x, 0, 0.15], [0.025, 0.08, 0.015], brass, 0.005, 0.045);
    tube(
      arm,
      [
        [0, -0.1, 0],
        [0.8, -0.37, 0],
        [1.8, -0.1, 0]
      ],
      0.027,
      0.027,
      brass
    );
  }
  const center = graph.frame('lantern').position;
  S.ball(center, [0.48, 0.59, 0.38], paper, { tag: 'lantern', ax: axes('lantern'), res: 0.045 });
  for (let j = 0; j < 12; j++) {
    const a = (j * Math.PI) / 6,
      points = [];
    for (let i = 0; i <= 16; i++) {
      const b = -1.1 + (i / 16) * 2.2;
      points.push([Math.cos(a) * 0.485 * Math.cos(b), 0.65 * Math.sin(b), Math.sin(a) * 0.39 * Math.cos(b)]);
    }
    tube('lantern', points, 0.012, 0.012, brass, 0.038);
  }
  for (const y of [-0.6, 0.6]) box('lantern', [0, y, 0], [0.36, 0.055, 0.28], metal, 0.035, 0.045);
  tube(
    'lantern',
    [
      [0, -0.65, 0],
      [0.03, -0.89, 0],
      [-0.02, -1.04, 0]
    ],
    0.022,
    0.014,
    brass,
    0.038
  );
  for (let i = 0; i < 5; i++)
    tube(
      'lantern',
      [
        [0, -0.9, 0],
        [(i - 2) * 0.04, -1.09 - Math.abs(i - 2) * 0.02, 0.01]
      ],
      0.012,
      0.008,
      paper,
      0.035
    );
  for (const [x, z] of [
    [-3.5, 1.5],
    [3.45, -1.7],
    [-1.5, -1.8],
    [1.5, 1.8]
  ]) {
    S.ball([x, 0.08, z], [0.45, 0.16, 0.3], stone, { res: 0.085 });
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      S.ball([x + Math.cos(a) * 0.28, 0.23 + (i % 3) * 0.09, z + Math.sin(a) * 0.22], [0.12, 0.055, 0.085], leaf, {
        res: 0.05,
        ax: B.frame(0, 0, a)
      });
    }
  }
  S.bake();
  const atlas = SpriteSurface.make(256);
  atlas.mesh(
    TexturedSurface.heightfield({ bounds: [-3.9, 3.9, -2.45, 2.45], segments: [1, 1], height: () => 0.07 }),
    224,
    144,
    (x, y) => palette[x % 16 === 0 || y % 16 === 0 ? 2 : (x * 17 + y * 31) % 97 === 0 ? 3 : 1]
  );
  const tuft = atlas.reserve(13, 17, (x, y) => {
    const stem = Math.abs(x - 6) <= Math.max(0, Math.floor((16 - y) / 7)) && y > 2,
      blade = (Math.abs(x - (6 + (y - 12) * 0.35)) < 1 && y > 5) || (Math.abs(x - (6 - (y - 12) * 0.4)) < 1 && y > 3);
    return stem || blade ? palette[(x + y) % 3 === 0 ? 4 : 12] : null;
  });
  for (let i = 0; i < 34; i++) {
    const x = Math.sin(i * 19.1) * 3.7,
      z = Math.cos(i * 7.7) * 2.1;
    if (Math.abs(x) < 0.8 && z > 1.6) continue;
    atlas.faceRegion([x - 0.1, 0.07, z], [0.2, 0, 0], [0, 0.27, 0], tuft);
  }
  const first = atlas.finish().vertices.length / 5,
    art = [
      '.....#.....',
      '..#..#..#..',
      '.###.#.###.',
      '#####.#####',
      '.####.####.',
      '..#######..',
      '...#####...',
      '....###....',
      '.....#.....',
      '....#.#....',
      '...#...#...'
    ];
  atlas.face(
    graph.toWorld('sigil', [-0.27, -0.27, 0.395]),
    graph.direction('sigil', [0.54, 0, 0]),
    graph.direction('sigil', [0, 0.54, 0]),
    44,
    44,
    (x, y) => {
      const u = Math.floor(x / 4),
        v = Math.floor(y / 4);
      return art[v]?.[u] === '#' ? palette[(u + v) % 4 === 0 ? 4 : 0] : null;
    }
  );
  const tether = K.frameSplats(B, 1, draw => {
    const parent = graph.node('lantern').parent;
    if (parent && graph.frame('lantern').visible && graph.frame(parent).visible)
      draw.streak(graph.toWorld('lantern', [0, 0.66, 0]), graph.frame(parent).position, {
        width: 0.018,
        color: 7,
        depth: true,
        emissive: false
      });
  });
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 1.5, 0], dist: 13.6, yaw: 0.22, pitch: 0.34 };
  world.radius = 8;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const stage = K.stage(world);
  rig.bind(stage);
  const controls = { playing: true, inspection: true, gizmos: true, selected: 'lantern' },
    lamp = { p: graph.frame('bulb').position.slice(), r: 3.6, s: 0.8, off: false };
  let time = 0,
    lit,
    lastJump = 0;
  stage.add({
    update(dt, t) {
      graph.setLocal('west.arm', { rotation: Q.fromAxisAngle([0, 0, 1], -0.15 + Math.sin(t * 0.7) * 0.13) });
      graph.setLocal('east.arm', {
        rotation: Q.fromAxisAngle([0, 0, 1], Math.PI + 0.15 + Math.sin(t * 0.6 + 1) * 0.1)
      });
    }
  });
  const binding = G.attach(world, graph, {
    geometry: ['west', 'east', 'west.arm', 'east.arm', 'lantern'].map(id => ({ node: id, part: id })),
    sprites: [{ node: 'sigil', first, count: 6 }],
    lights: [{ node: 'bulb', light: lamp, touch: () => lit?.touch() }],
    sockets: [{ node: 'bulb', name: 'relay.light' }]
  });
  lit = stage.add(K.light.system(stage, cap, [lamp]));
  stage.add(tether);
  // Small relationship gizmos are frame-local; changing parents never rebakes the sculpture.
  const inspection = {
    maxTargets: 3,
    style: { color: '#ffdc9b', corner: 6, padding: 5 },
    targets: [
      {
        id: 'relay',
        at: { node: 'target' },
        label: 'RELAY 07',
        halfSize: [0.45, 0.5, 0.15],
        occlusion: 'none',
        ripple: { period: 5, radius: 48, speed: 30, width: 9, cell: 7, chars: '01:+*' }
      }
    ]
  };
  return {
    world,
    graph,
    controls,
    lamp,
    binding,
    inspection,
    get time() {
      return time;
    },
    get lastJump() {
      return lastJump;
    },
    get parent() {
      return graph.node('lantern').parent;
    },
    reparent(parent) {
      const before = graph.frame('lantern');
      graph.reparent('lantern', parent === 'world' ? null : { node: parent + '.arm', socket: 'grip' });
      lastJump = V.dist(before.position, graph.frame('lantern').position);
      binding.apply();
      return lastJump;
    },
    dock() {
      const parent = graph.node('lantern').parent;
      if (parent) {
        const p = graph.frame(parent).position;
        graph.setWorld('lantern', { position: V.add(p, [0, -0.91, 0]) });
        binding.apply();
      }
    },
    reset() {
      graph.reset();
      time = 0;
      lastJump = 0;
      binding.apply();
    },
    update(dt) {
      if (controls.playing) time += dt;
      stage.update(controls.playing ? dt : 0, time);
      return world;
    }
  };
}
if (typeof module !== 'undefined') module.exports = lanternExchange;
