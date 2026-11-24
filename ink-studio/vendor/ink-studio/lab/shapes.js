// joins, folds and a regular solid with artwork on its faces: a quick look at k3-shapes and k4-art
module.exports = kit => ({
  id: 'lab-shapes',
  name: 'Lab shapes',
  seed: 1,
  build(seed) {
    const K = kit.KIT,
      B = kit.makeBuilder(
        seed,
        [0x07080b, 0x1c2026, 0x3a4048, 0x666c70, 0x9aa09c, 0x24542a, 0x66a640, 0xa83a30, 0xf2ecd0, 0xffd24a]
      ),
      S = K.sculpt(kit.makeSculpt(B)),
      ST = { r: [1, 2, 3, 4] },
      H = { hold: true };
    S.ground({ r: [1, 1, 2] }, { rad: 9, res: 0.14 });
    // a flight of steps where a block meets the floor, a fluted drum, a ring of posts, an engraved slab
    S.join('stairs', S.box([-4, 1, 0], [1, 1, 1.4], ST, H), S.box([-4, -0.5, 0], [3, 0.5, 2.2], ST, H), {
      r: 1.2,
      n: 5,
      res: 0.07
    });
    S.join('cutColumns', S.lathe([0, 0, -3.5], 3, 0.9, ST, H), S.lathe([0, 0.4, -3.5], 2.2, 1.05, ST, H), {
      r: 0.22,
      n: 3,
      res: 0.06
    });
    S.fold(S.lathe([2.2, 0, 2.6], 1.6, [0.22, 0.14], ST, H), { polar: 7, c: [0, 0, 2.6] }, { res: 0.07 });
    S.join(
      'engrave',
      S.box([4.6, 1.2, -1], [0.25, 1.2, 1.2], ST, H),
      S.torus([4.35, 1.2, -1], 0.7, 0.05, ST, {
        hold: true,
        ax: [
          [0, 1, 0],
          [1, 0, 0],
          [0, 0, 1]
        ]
      }),
      { r: 0.12, res: 0.05 }
    );
    const die = S.regular('d6', [0, 2.2, 0.6], 1.1, { r: [5, 5, 6, 6] }, { rd: 0.18, res: 0.06, tag: 'die' }),
      d20 = S.regular('d20', [4.2, 1.3, 3.2], 1.0, { r: [7, 7, 7, 8] }, { rd: 0.08, res: 0.06 });
    S.bake();
    const W = B.finish({
        cam: { target: [0, 1.6, 0], dist: 24, pitch: 0.28, yaw: 0.5, sway: 0.3 },
        detail: 13,
        palName: 'Lab',
        dither: 0.25,
        radius: 10
      }),
      st = K.stage(W);
    const eye = K.art({
      shapes: [
        { ellipse: [50, 50, 44, 30], fill: 8 },
        { circle: [50, 50, 17], fill: 0, key: t => ({ tx: 14 * Math.sin(t * 1.3), ty: 5 * Math.sin(t * 0.9) }) },
        { circle: [50, 50, 7], fill: 9, key: t => ({ tx: 14 * Math.sin(t * 1.3), ty: 5 * Math.sin(t * 0.9) }) },
        {
          rect: [0, 0, 100, 100],
          fill: 5,
          key: t => ({ sy: Math.max(0, 1 - 8 * Math.abs((t % 3) - 2.8)) * 0.5, px: 50, py: 0 })
        },
        {
          rect: [0, 0, 100, 100],
          fill: 5,
          key: t => ({ sy: Math.max(0, 1 - 8 * Math.abs((t % 3) - 2.8)) * 0.5, px: 50, py: 100 })
        }
      ]
    });
    const five = K.art({
      shapes: [
        {
          d: 'M30 15 H72 V28 H44 V42 C70 36 78 52 76 64 C74 80 56 88 28 80 L32 68 C50 74 60 70 62 62 C63 52 50 50 30 56 Z',
          fill: 8
        }
      ]
    });
    const front = die.faces.find(f => f.n[2] > 0.9),
      side = die.faces.find(f => f.n[0] > 0.9);
    st.add(
      K.art.faces(st, [
        { face: front, art: eye, size: 0.9 },
        { face: side, art: five, size: 0.8 }
      ])
    );
    return W;
  }
});
