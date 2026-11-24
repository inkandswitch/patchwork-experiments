module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'rooms-and-caves',
  name: 'Rooms above and caverns below',
  seed: 0,
  build(seed) {
    const B = makeBuilder(35, [
      0x17252e, 0x443a3a, 0x6d5246, 0xa27960, 0xc29b70, 0xdec092,
      0x2e4149, 0x497077, 0x698f8b, 0x9eb1a0, 0x37544c, 0x5d7f5d, 0x92a879,
      0x744539, 0xc17652, 0xf5c37a, 0xffe2a0
    ]);
    const S = K.sculpt(makeSculpt(B)),
      { layouts, grammar } = K.procedural,
      cavern = Boolean(seed % 2),
      setup = { width: 34, height: 23, seed: 19 },
      map = cavern ? layouts.cave({ ...setup, steps: 4, openChance: 0.51, minArea: 5,
        open: [[3, 4], [30, 18]], corridorWidth: 2
      }) : layouts.bsp({ ...setup, minRoom: 4, corridorWidth: 2 });
    const open = Array.from({ length: map.height }, (_, z) =>
      Array.from({ length: map.width }, (_, x) => map.cells[z * map.width + x] ? 'f' : 'w').join(''));
    const decorated = grammar.rewriteGrid(open, [
      { id: 'mark-wall', find: ['wff'], replace: ['=r='], weight: 1 },
      { id: 'mark-upper', find: ['w', 'f', 'f'], replace: ['=', 'r', '='], weight: 0.7 }
    ], { steps: 22, seed: 50 });
    const floor = decorated.rows.map(row => row.join('')),
      wall = open.map(row => row.replaceAll('f', '.')),
      base = open.map(row => 'b'.repeat(row.length)),
      cell = 0.244;
    S.vox({
      cell: [cell, 0.16, cell], hard: true, key: {
        b: [1, 2, 3],
        w: cavern ? [6, 7, 8, 9] : [1, 2, 3, 4],
        f: cavern ? [10, 11, 12] : [2, 3, 4, 5],
        r: [13, 14, 15]
      }, layers: [base, floor, [wall, cavern ? 2 : 3]]
    }, { res: 0.085, round: 0.13 });
    for (const [z, row] of decorated.rows.entries()) for (const [x, key] of row.entries()) {
      if (key !== 'r') continue;
      const p = [(x + 0.5 - map.width / 2) * cell, 0.37, (z + 0.5 - map.height / 2) * cell];
      S.ball(p, [0.053, 0.064, 0.047], { r: [14, 15, 16] }, { res: 0.044 });
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.24, 0], dist: 13, pitch: 1.03, yaw: 0.15 }, detail: 20, dither: 0.22, radius: 5.1 });
  }
});
