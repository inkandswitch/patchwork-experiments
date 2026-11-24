module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'rolling-curve-gallery',
  name: 'Rolling Curves',
  seed: 17,
  build(seed) {
    const B = makeBuilder(seed, [
      0x111b29, 0x233247, 0x3c5061, 0x587783, 0x8ba7a8,
      0x235255, 0x368681, 0x6dd1ba, 0xc9f6d4,
      0x69403c, 0xa15d4e, 0xe89560, 0xffcf87,
      0x4b4265, 0x746c99, 0xc1a7d2
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .43, sky: .23, sun: K.V.norm([-.62, .65, .60]), sunK: .75 });
    const axis = [0, 0, 1], palette = [
      { r: [5, 6, 7, 8] }, { r: [9, 10, 11, 12] }, { r: [13, 14, 15] }
    ];
    const frame = { r: [0, 1, 2, 3, 4] }, screw = { r: [9, 10, 11, 12] };
    const ink = { r: [7, 8], em: true };
    const atlas = SpriteSurface.make(448), font = K.inspection.font({});
    const panels = [
      { at: [-4.00, 4.72], w: 3.78, name: 'ARCHIMEDEAN', defs: [{ type: 'archimedeanSpiral', phase: -.35, turns: 2.30 }] },
      { at: [0, 4.72], w: 3.78, name: 'FERMAT', colors: [0, 2], defs: [
        { type: 'fermatSpiral', phase: -.40, turns: 1.55 },
        { type: 'fermatSpiral', phase: Math.PI - .40, turns: 1.55 }
      ] },
      { at: [4.00, 4.72], w: 3.78, name: 'EPITROCHOID', colors: [1],
        defs: [{ type: 'epitrochoid', fixedTeeth: 5, rollingTeeth: 2, pen: .92, phase: Math.PI / 2 }] },
      { at: [-2.00, 1.83], w: 7.78, name: 'CYCLOID', colors: [1],
        defs: [{ type: 'cycloid', turns: 3.0 }] },
      { at: [4.00, 1.83], w: 3.78, name: 'HYPOTROCHOID', colors: [2],
        defs: [{ type: 'hypotrochoid', fixedTeeth: 7, rollingTeeth: 3, pen: .82, phase: Math.PI / 2 }] }
    ];
    const box = (at, half, mat, res = .093, rd = .023) => S.box(at, half, mat, { res, rd });
    const strokeText = (label, x, y, size, mat) => {
      const width = size * .072;
      for (const stroke of K.poly2.text(label, size, { width }).strokes) {
        if (stroke.length < 2) continue;
        S.tube(stroke.map(([u, v]) => [x + u, y + v, .63]), width / 2, width / 2, mat, { res: .027 });
      }
    };
    box([0, 3.44, -.20], [6.14, 3.41, .24], frame, .15, .11);
    box([0, 6.23, .04], [5.84, .40, .19], frame, .10, .05);
    strokeText('ROLLING CURVES', 0, 6.30, .31, ink);
    for (const x of [-5.67, 5.67]) {
      box([x, 6.23, .29], [.12, .019, .035], screw, .050, .009);
      box([x, 6.13, .29], [.12, .019, .035], screw, .05, .009);
    }
    for (const { at: [x, y], w, name, colors = [0], defs } of panels) {
      const h = 2.68, left = x - w / 2, bottom = y - h / 2;
      box([x, y, .05], [w / 2, h / 2, .25], frame, .12, .07);
      const iw = Math.round(w * 36), ih = Math.round(h * 36);
      const letters = [...name].map(letter => font.get(letter));
      const lx = Math.round((iw - name.length * 6 + 1) / 2), ly = ih - 13;
      atlas.face([left + .063, bottom + .063, .40], [w - .126, 0, 0], [0, h - .126, 0],
        iw, ih, (u, v) => {
          const edge = Math.min(u, v, iw - u - 1, ih - v - 1), bx = Math.round(iw * .5);
          if (edge === 1) return 0x47606d;
          if (v > ih - 19) {
            const s = u - lx, row = v - ly, letter = s >= 0 ? letters[Math.floor(s / 6)] : null;
            return row >= 0 && row < 7 && letter?.[row * 6 + s % 6] ? 0x9bddcb : 0x192735;
          }
          if (v === ih - 19) return 0x45606a;
          if (u === bx || v === 39) return 0x253e4c;
          return (u % 12 === 4 && v % 12 === 3) ? 0x325161 : 0x162531;
        });
      for (const dx of [-1, 1]) for (const dy of [-1, 1])
        S.ball([x + dx * (w * .5 - .14), y + dy * (h * .5 - .14), .45], .026, screw, { res: .037 });

      const points = defs.flatMap(def => K.curve.create({ axis, ...def }).points);
      const bounds = [0, 1].map(i => [Math.min(...points.map(p => p[i])), Math.max(...points.map(p => p[i]))]);
      const scale = Math.min((w - .55) / (bounds[0][1] - bounds[0][0]), 1.76 / (bounds[1][1] - bounds[1][0]));
      const origin = [x, y + .23].map((v, i) => v - scale * (bounds[i][0] + bounds[i][1]) / 2).concat(.56);
      for (const [i, def] of defs.entries()) {
        const path = K.curve.create({ ...def, axis, origin, scale });
        const color = palette[colors[i]];
        K.sweep(S, path.points, { shape: 'rect', w: .057, h: .031, round: .54 }, color, { res: .045 });
        if (def.type === 'cycloid') {
          for (const t of path.breaks) {
            const p = path.evaluate(t);
            S.ball([p[0], p[1], .585], .059, screw, { res: .036 });
          }
          const rail = K.curve.path(path.points, { up: [-1, 0, 0] });
          const text = K.curve.text(rail, 'ONE TURN', { size: .18, lift: .25 });
          for (const stroke of text.strokes)
            if (stroke.length > 1) S.tube(stroke, .012, .012, ink, { res: .025 });
        }
      }
    }
    S.bake();
    return B.finish({
      cam: { target: [0, 3.44, .25], dist: 14.7, fov: .56, yaw: -.014, pitch: .025 },
      detail: 27, radius: 8, dither: .13, spriteSurfaces: atlas.finish(),
      look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
  }
});
