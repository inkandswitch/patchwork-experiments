// twist, bend, taper, shell, swell, rough, extrude, revolve: one of each, to look at
module.exports = kit => ({
  id: 'lab-warps',
  name: 'Lab warps',
  seed: 1,
  build(seed) {
    const K = kit.KIT,
      B = kit.makeBuilder(
        seed,
        [
          0x07080b, 0x1c2026, 0x3a4048, 0x666c70, 0x9aa09c, 0x7a4296, 0xb070c4, 0xd9a441, 0xf2ecd0, 0x3c7a34, 0x66a640,
          0xa83a30
        ]
      ),
      S = K.sculpt(kit.makeSculpt(B)),
      ST = { r: [1, 2, 3, 4] },
      PU = { r: [1, 5, 5, 6] },
      GO = { r: [2, 7, 7, 8] },
      GR = { r: [1, 9, 9, 10] },
      H = { hold: true };
    S.ground({ r: [1, 1, 2] }, { rad: 10, res: 0.14 });
    S.warp(S.box([-6, 2.2, -2], [0.5, 2.2, 0.5], PU, H), { twist: 0.9 }, { res: 0.06 });
    S.warp(
      S.join(
        'cut',
        S.lathe([-3.4, 0, -2.4], 4.4, 0.6, ST, H),
        S.fold(S.lathe([-3.4 + 0.6, 0.2, -2.4], 4, 0.16, ST, H), { polar: 7, c: [-3.4, 0, -2.4] }, H),
        H
      ),
      { twist: 0.7, c: [-3.4, 0, -2.4] },
      { res: 0.06 }
    );
    S.warp(S.box([0, 0.5, -3.4], [2.6, 0.3, 0.4], GO, H), { bend: 0.5, thick: 0.4 }, { res: 0.06 });
    S.warp(S.box([4.4, 2, -2.6], [0.9, 2, 0.9], ST, H), { taper: [1, 0.25], y0: 0, y1: 4 }, { res: 0.07 });
    S.join('cut', S.shell(S.ball([-5, 1.3, 2.4], 1.2, GR, H), 0.14, H), S.box([-5, 2.6, 2.4], [1.6, 0.9, 1.6], GR, H), {
      res: 0.06
    });
    S.rough(
      S.ball([-1.8, 1.2, 2.6], 1.1, PU, H),
      (x, y, z) => 0.07 * Math.sin(x * 9) * Math.sin(y * 9) * Math.sin(z * 9),
      0.07,
      { res: 0.055 }
    );
    S.extrude(K.poly2.star(5, 1.2, 0.5, Math.PI / 2), [1.4, 1.4, 2.4], 0.5, GO, { res: 0.055, rd: 0.05 });
    S.extrude(K.poly2.with(K.poly2.gear(10, 1.0, 0.22), K.poly2.ngon(12, 0.4)), [4.4, 1.5, 3.0], 0.45, ST, {
      res: 0.055
    });
    S.extrude(
      K.poly2.svg(
        'M10 80 C10 20 40 10 50 40 C60 10 90 20 90 80 L70 80 L70 50 C70 40 60 40 60 50 L60 80 L40 80 L40 50 C40 40 30 40 30 50 L30 80 Z',
        2.2
      ),
      [7.2, 1.3, 0.6],
      0.5,
      { r: [1, 11, 11, 8] },
      {
        res: 0.055,
        ax: [
          [0.8, 0, -0.6],
          [0, 1, 0],
          [0.6, 0, 0.8]
        ]
      }
    );
    S.revolve(
      [
        [
          [0.25, 0],
          [0.9, 0],
          [0.5, 0.5],
          [0.3, 1.6],
          [0.7, 2.2],
          [0.6, 2.4],
          [0.2, 1.8],
          [0.15, 0.6]
        ]
      ],
      [1.2, 0, -0.2],
      GR,
      { res: 0.055 }
    );
    S.swell(S.box([7.4, 0.6, -2.6], [0.5, 0.3, 0.5], PU, H), 0.3, { res: 0.07 });
    S.bubbles(S.box([-7.6, 0.25, 0.4], [1.1, 0.25, 1.4], { r: [1, 3, 4, 8] }, H), {
      cell: 0.42,
      h: 0.15,
      flat: 'y',
      res: 0.045
    });
    S.bubbles(S.ball([7.6, 3.2, -2.6], 0.9, GR, H), { cell: 0.45, h: 0.12, res: 0.05 });
    S.puff(
      K.poly2.svg('M50 88 C10 60 5 30 28 18 C40 12 50 22 50 30 C50 22 60 12 72 18 C95 30 90 60 50 88 Z', 2.4),
      [-2.2, 4.3, -1.4],
      1.3,
      { r: [1, 11, 11, 8] },
      { res: 0.055 }
    );
    S.puff(K.poly2.star(5, 1.1, 0.55, Math.PI / 2), [3.2, 4.4, -1.6], 0.8, GO, { res: 0.055, back: 0 });
    S.bake();
    return B.finish({
      cam: { target: [0.5, 1.8, 0], dist: 24, pitch: 0.3, yaw: 0.25, sway: 0.3 },
      detail: 13,
      palName: 'Lab',
      dither: 0.25,
      radius: 11
    });
  }
});
