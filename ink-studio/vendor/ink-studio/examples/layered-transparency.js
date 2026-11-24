module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  let carrier;
  return {
    id: 'layered-transparency',
    name: 'The tide gauge',
    seed: 37,
    animate(world) {
      const { first, count } = carrier;
      const rest = world.data.slice(first * 16, (first + count) * 16);
      world.anim = { update(dt, time) {
        const phase = .5 - .5 * Math.cos(Math.PI * time);
        for (let i = 0; i < count; i++) {
          const j = (first + i) * 16, k = i * 16;
          world.data[j] = rest[k] + (phase - .5) * .65;
          world.data[j + 1] = rest[k + 1] - phase * .64;
          world.data[j + 2] = rest[k + 2] - phase * 2.3;
        }
      } };
    },
    build(seed) {
      const B = makeBuilder(seed, [
        0x273447, 0x1a293a, 0x30445a, 0x44596b, 0x566d7b, 0x77909a, 0x91a6a8, 0xadc3bd,
        0x4d4346, 0x735a47, 0x9e7150, 0xc59566, 0xe6b67b, 0xffdb9c, 0xffedbe,
        0x0f527b, 0x206e97, 0x298cbd, 0x55b9df, 0x80d7ed, 0xaeddeb,
        0x265462, 0x386975, 0x50868c
      ]);
      const S = K.sculpt(makeSculpt(B));
      Object.assign(S, { sun: K.V.norm([-.45, .69, .55]), sky: .16, sunK: .6, amb: .35 });
      const stone = { r: [1,2,3,4,5] }, brass = { r: [8,9,10,11,12] }, lamp = { r: [12,13,14], em: true };
      const box = (at, half, mat, res = .15) => S.box(at, half, mat, { res, rd: .045 });
      box([0,-.98,-.05],[3.12,.28,2.02],stone);
      for (const x of [-2.84,2.84]) box([x,-.38,-.05],[.31,.37,2.03],stone);
      for (const z of [-1.98,1.98]) box([0,-.505,z],[2.64,.21,.17],stone);
      box([0,.19,-1.82],[2.81,.62,.17],stone);
      for (const x of [-2.17,-.72,.72,2.17]) {
        box([x,.68,-1.78],[.11,.72,.17],stone,.095);
        box([x,.69,-1.55],[.15,.22,.077],lamp,.08);
        box([x,1,-1.58],[.21,.07,.14],brass,.08);
      }
      for (const x of [-2.62,2.62]) {
        box([x,1.08,-.7],[.09,1.07,.095],brass,.09);
        box([x,.19,-.70],[.20,.14,.22],stone,.094);
      }
      box([0,2.06,-.70],[2.68,.075,.12],brass);
      S.bake();
      const fixed = B.count();
      for (const y of [-.07,1.25]) box([.32,y,1.05],[.92,.045,.055],brass,.073);
      for (const x of [-.6,1.24]) box([x,.59,1.05],[.043,.635,.056],brass,.072);
      box([.32,1.42,1.05],[.042,.16,.043],brass,.066);
      S.bake();
      const pane = B.count();
      for (let y = 0; y < 11; y++) for (let x = 0; x < 16; x++) {
        const u = -.55 + 1.74 * x / 15, v = .01 + 1.16 * y / 10;
        const highlight = Math.abs(v - .28 - .48 * u) < .09;
        B.disc(u,v,1.05,[0,0,1],.087,.012,B.P[highlight ? 19 : 17],highlight ? .32 : .27,
          { gl: true, nd: true });
      }
      B.describeSplats(pane, B.count(), { object: 'tide-gauge-pane' });
      carrier = { first: fixed, count: B.count() - fixed };
      K.weather.fall(B,{kind:'rain',worldSpace:true,n:175,seed,top:2.44,ground:()=>-.32,
        box:[-3,3,-1.65,2.25],cols:[5,6,7,20],len:.082,size:.009,speed:3.3});
      const water = K.procedural.waterBodies.scene([K.procedural.waterBodies.create({
        id: 'gauge-basin', bounds: { min: [-2.52,-1.80], max:[2.52,1.79] }, sample: () => ({ bed: -.68, surface: -.31 }),
        optics: { optical: { reflection: .24, reflectionColor: '#769da9', scatteringColor: '#3c7784',
          absorption: .9, scattering: .37 } }
      })]);
      return B.finish({
        cam: { target:[0,.46,0], dist:10.8, yaw:.16, pitch:.30, sway:0 },
        atmosphere: [
          K.atmosphere.box({ min:[-2.61,-.30,-1.70], max:[2.61,1.02,.41], density:.58, color:'#86999f' }),
          K.atmosphere.box({ min:[-2.45,.42,-1.60], max:[2.45,1.80,-.86], density:.22, color:'#afaba0' })
        ],
        water, refract:2.3, radius:6, dither:0,
        look: { stableTransparency: { mode: 'blend', depthTolerance: .10 }, splatCoverage:'continuous', coverageAware:true }
      });
    }
  };
};
