module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'adaptive-lantern',
  name: 'Harbor lantern',
  seed: 19,
  build(seed, { controls } = {}) {
    const B = makeBuilder(seed, [
      0x152738, 0x302b36, 0x583b3c, 0x895847, 0xb77d54, 0xd49d60, 0xf3ca82,
      0x263b44, 0x40575a, 0x58766f, 0x84a290,
      0xc65832, 0xeb8e3d, 0xffc861, 0xffe39c, 0xfff3cb,
      0x728f9c, 0xa6bbc2, 0xc1d7d6
    ]);
    const S = K.sculpt(makeSculpt(B));
    const dist = 7.15, pitch = .085, yaw = .66;
    const sampling = { coarse:1.9, fine:.72, curvature:.20, views:[[.24,.085,.97],[.66,.085,.75]] };
    Object.assign(S, {
      res: .143, amb: .33, sky: .20, sunK: .71,
      sun: K.V.norm([-.64,.67,.42]), adaptiveSampling: controls?.adaptiveSampling ?? sampling
    });
    const cast = { r:[1,2,3,4,5], materialId:'cast bronze' };
    const bright = { r:[2,3,4,5,6], materialId:'polished brass' };
    const dark = { r:[1,2,7,8,9], materialId:'gunmetal' };
    const glass = { r:[16,17,18], a:.14, glass:true, materialId:'tinted glass' };
    const flame = { r:[11,12,13,14,15], em:true };
    const part = objectId => ({ objectId });
    S.box([0,.12,0],[.70,.125,.59],cast,{...part('base'),rd:.078});
    S.box([0,.263,0],[.61,.043,.52],bright,{...part('base'),rd:.034});
    S.box([0,.34,0],[.545,.050,.468],dark,{...part('base'),rd:.034});
    for (const x of [-.48,.48]) for (const z of [-.38,.38]) {
      S.tube([[x,.34,z],[x*.92,1.42,z*.94],[x*.80,1.61,z*.87]],
        .041,.035,bright,part('frame'));
      S.box([x,.39,z],[.073,.064,.064],cast,{...part('frame sockets'),rd:.027});
    }
    for (const z of [-.38,.38])
      S.tube([[-.445,.62,z],[0,.60,z],[.445,.62,z]],.027,.027,dark,part('crossbars'));
    for (const x of [-.44,.44])
      S.box([x,.93,0],[.020,.52,.335],glass,{...part('glass'),rd:.014,ghost:true,res:.113});
    for (const z of [-.365,.365])
      S.box([0,.97,z],[.408,.55,.016],glass,{...part('glass'),rd:.014,ghost:true,res:.115});
    S.lathe([0,.38,0],.19,[.255,.192],dark,{...part('wick'),res:.112});
    S.ball([0,.73,0],[.144,.246,.132],flame,{ghost:true,res:.056});
    S.ball([-.021,.922,.015],[.083,.172,.076],{r:[13,14,15],em:true},{ghost:true,res:.05});
    S.box([0,1.665,0],[.577,.062,.485],bright,{...part('roof rim'),rd:.053});
    S.lathe([0,1.69,0],.39,t=>.59*(1-t)**1.37+.109,cast,part('roof'));
    S.lathe([0,2.055,0],.126,[.155,.112],dark,part('crown'));
    S.torus([0,2.37,0],.330,.036,bright,{...part('handle'),ax:S.AZ});
    if (controls?.plinth) {
      const stone = { r:[1,7,8,9,10], materialId:'slate' };
      S.box([0,-.23,0],[2.34,.23,1.30],stone,{...part('plinth'),rd:.091,res:.098});
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.34,0],dist,pitch,yaw,sway:0},
      radius:2,detail:28,dither:0,look:{splatCoverage:'continuous'}
    });
  }
});
