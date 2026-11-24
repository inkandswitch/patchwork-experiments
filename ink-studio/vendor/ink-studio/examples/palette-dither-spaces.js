/* Pan past a printed sign, a rigged cloak and a stone relief to compare palette anchors. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'print-and-cloth', name: 'Print and cloth workshop', seed: 31,
  build(seed) {
    const B = makeBuilder(seed, [
      0x172029, 0x24303c, 0x364651, 0x4c5d62, 0x74827b, 0x9aa398,
      0x32262e, 0x57404a, 0x7a555a, 0xa36d69, 0xca9476, 0xf3c589,
      0x302934, 0x544053, 0x7a5867, 0xa77577, 0xd5a283,
      0x98755e, 0x6b4569, 0x4a6571, 0xfce5ad
    ]);
    const S = K.sculpt(makeSculpt(B)), C = K.sculpt(makeSculpt(B)), rig = K.rig(B, C);
    S.sun = K.V.norm([-.54, .73, .52]); S.amb = .34; S.sky = .18; S.sunK = .63;
    C.sun = S.sun; C.amb = S.amb; C.sky = S.sky; C.sunK = S.sunK;
    const wood = { r: [6, 7, 8, 9] }, brass = { r: [8, 9, 10, 11, 20] };
    const wall = { r: [1, 2, 3, 4] }, floor = { r: [0, 1, 2, 3, 4] }, trim = { r: [12, 13, 14, 15] };
    const print = { r: [17], materialId: 'paper' }, cloth = { r: [18], materialId: 'cloth' };
    const chisel = { r: [19], materialId: 'relief' }, foil = { r: [11, 20], em: true };
    const box = (p, h, m, res = .065) => S.box(p, h, m, { rd: res * .42, res });
    const tube = (sculpt, points, r, material, options = {}) =>
      sculpt.tube(points, r, r, material, { res: Math.max(.025, r * .63), ...options });

    box([0, -.14, -.13], [4.45, .19, 1.23], floor, .126);
    box([0, -.006, 1.106], [4.50, .066, .075], trim, .094);
    box([0, 1.55, -.79], [4.37, 1.54, .20], wall, .135);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 14; i++) {
      const x = (i - 6.5) * .592 + (j % 2 ? .109 : -.094);
      box([x, .37 + .739 * j, -.586], [.28, .345, .022], (i + 3 * j) % 8 ? wall : floor, .110);
    }
    box([0, 3.085, -.464], [4.44, .076, .194], trim, .105);
    box([0, 3.149, -.464], [4.48, .017, .201], brass, .081);
    for (const x of [-4.20, -1.48, 1.48, 4.20]) {
      box([x, 1.50, -.45], [.059, 1.45, .14], trim, .087);
      box([x, .11, -.43], [.134, .11, .19], trim, .065);
    }

    const px = -2.85, cy = 1.69;
    box([px, cy, -.461], [1.13, 1.09, .131], wood);
    box([px, cy, -.304], [1.00, .965, .035], print, .044);
    const star = [[0,.54],[.13,.14],[.49,0],[.13,-.14],[0,-.49],[-.13,-.14],[-.49,0],[-.13,.14],[0,.54]];
    tube(S, star.map(([x,y]) => [px+x, cy+y+.10, -.246]), .028, foil);
    for (const y of [-.61, -.73]) box([px, cy+y, -.249], [y < -.7 ? .29 : .59, .015, .012], wood, .028);
    for (const x of [-1.055, 1.055]) for (const y of [-1.01, 1.01])
      S.ball([px+x,cy+y,-.314], .044,brass,{res:.028});

    const rx = 2.85;
    box([rx, 1.63, -.48], [1.07, 1.08, .122], floor);
    box([rx, 1.63, -.307], [1.01, 1.01, .071], chisel, .044);
    for (let i = 0; i < 3; i++) {
      const points = Array.from({ length: 29 }, (_, k) => {
        const x = (k / 28 - .5) * 1.51;
        return [rx+x, 1.41 + .218 * i + .12 * Math.sin(k * .29 + i * .96), -.212];
      });
      tube(S, points, .033, i === 2 ? brass : wall);
    }
    S.ball([rx+.51, 2.28, -.209], [.115, .114, .028], brass, { res: .028 });
    for (const x of [-.97,.97]) for (const y of [.68,2.57])
      S.ball([rx+x,y,-.224], .034,wood,{res:.024});

    for (const x of [px, 0, rx]) {
      box([x, .214, .43], [1.095, .111, .40], wood);
      box([x, .336, .44], [1.125, .041, .424], trim);
      box([x, .15, .857], [.22, .048, .015], brass, .036);
    }
    tube(S, [[-.88, 2.76, -.20], [.88, 2.76, -.20]], .039, brass);
    for (const x of [-.79,.79]) S.ball([x,2.76,-.183],.071,brass,{res:.028});
    S.bake();

    const hang = { tag: 'cloak' }, width = y => .60 - .19 * y;
    const fold = (x, y) => .10 * Math.cos(10 * x + 1.1 * y) - .041 * y + .038 * (x / width(y)) ** 2;
    const bottom = x => -.94 + .13 * (x / .78) ** 2;
    const cape = (x,y,z) => Math.max(Math.abs(x)-width(y), y-.94, bottom(x)-y, Math.abs(z-fold(x,y))-.023);
    C.solid([0,1.77,.06],1.35,cape,(res,emit)=>{
      const n = Math.ceil(1.88 / res), m = Math.ceil(1.60 / res);
      for (let j=0;j<=n;j++) for (let i=0;i<=m;i++) {
        const y = -.94 + 1.88*j/n, x = width(y) * (2*i/m-1), z = fold(x,y);
        if (y < bottom(x)) continue;
        emit(x,y,z-.023);
        emit(x,y,z+.023);
      }
    },cloth,{ ...hang, res:.042, reach:.09 });
    const seam = (x,y) => [x, 1.77+y, .088+fold(x,y)];
    for (const side of [-1,1]) {
      const points = Array.from({length:28},(_,i)=>{
        const y = .92 - 1.72*i/27;
        return seam(side*(width(y)-.037), y);
      });
      tube(C,points,.026,brass,hang);
    }
    tube(C,Array.from({length:29},(_,i)=>{
      const x = .74*(2*i/28-1);
      return seam(x,bottom(x)+.044);
    }),.025,brass,hang);
    C.ball(seam(0,.63),[.13,.099,.026],foil,{ ...hang, res:.025 });
    C.bake();

    const policy = (material, space, palette, pattern, spacing, origin) => ({ material, palette,
      dither: { space, pattern, strength: 1, pairs: [{ colors: palette }],
        ...(spacing && { spacing, origin }), ...(pattern === 'blue-noise' && { seed }) } });
    const world = B.finish({
      cam: { target: [0,1.47,-.05], dist: 8.9, pitch: .19, yaw: .04, sway: 0 },
      radius: 10, dither: 0, detail: 27,
      skyEnvironment: { defaults: { zenith: '#243443', horizon: '#566868', ground: '#314750', sunStrength: 0 } },
      look: { splatCoverage: 'continuous', paletteConstraints: { targets: [
        policy('paper','screen',['#654c49','#cfaa7f'],'bayer'),
        policy('cloth','object',['#492f58','#9b648e'],'bayer',.078,[.017,.034,0]),
        policy('relief','world',['#274651','#71838d'],'blue-noise',.093,[.028,-.015,.012])
      ] } }
    });
    const stage = K.stage(world);
    rig.bind(stage);
    stage.add({ update(_dt,t) {
      const wave = Math.PI * .5 * t;
      const pivot = [0,2.73,.06];
      rig.set('cloak', K.M.rot(K.V.norm([.08,.52,1]), .19*Math.sin(wave)), pivot, [.02*Math.sin(2*wave),2.73,.06]);
      rig.apply();
    } });
    return world;
  }
});
