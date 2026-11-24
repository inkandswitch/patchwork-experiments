module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'cloud-pass',
  name: 'Cloud pass',
  seed: 29,
  build(seed) {
    const B = makeBuilder(seed, [
      0x4d6980, 0x4f5353, 0x777368, 0xa09a84, 0xc4b99c, 0xe7d2a7,
      0x364938, 0x536c49, 0x789465, 0xa8ba7e,
      0x175266, 0x2a6f7d, 0x41939a, 0x75b2af,
      0x5c473e, 0x905345, 0xb7795b, 0xd6a27e, 0xffd178,
      0x475f70, 0x61798a, 0x7d8e96
    ]);
    const direction = [-.32, .87, .26];
    const S = K.sculpt(makeSculpt(B));
    S.captureAlbedo = true;
    S.sun = K.V.norm(direction);
    S.amb = .28;
    S.sunK = .70;
    const rock = { r:[1,2,3,4], materialId:'limestone' };
    const grass = { r:[6,7,8,9], materialId:'grass' };
    const stone = { r:[2,3,4,5], albedo:'#cfbb8f', materialId:'cut-stone' };
    const ceramic = { r:[14,15,16,17], albedo:'#bb7452', materialId:'ceramic' };
    const sea = K.surface.preset('rippling-water', { r:[10,11,12,13], materialId:'sea' }, {
      normal:{ amplitude:.035, scale:.70, speed:1.15 },
      layers:{ sky:{ source:'scene', strength:.62, f0:.46 }, ripples:{ strength:.26 } }
    });

    for (const [x,z,sx,sy,sz] of [
      [-28,-48,14,4.5,6], [-15,-54,8,3.2,5], [7,-57,12,4.1,6], [21,-45,12,5.1,7], [32,-43,10,4.9,8]
    ]) S.rock([x,-1.1,z],[sx,sy,sz],{ r:[19,20,21] },{ res:.48 });
    for (const [x,z,sx,sy,sz] of [
      [-6,-5.8,5.1,1.6,4.8], [-6.3,-2,4.3,1.38,4.6], [-6.8,2.7,4.7,1.95,3.3],
      [-3.85,-4.5,3.1,1.49,2.22], [-3.25,-2,2.62,1.31,1.73], [-4.85,.2,2.31,1.45,2.44],
      [6.7,-15.3,3.9,1.4,2.8], [8.2,-12.7,3.7,1.22,3.37]
    ]) {
      S.rock([x,-.36,z],[sx,sy,sz],rock,{ res:.19 });
      S.rock([x,sy*.66-.34,z],[sx*.83,sy*.38,sz*.84],grass,{ res:.17 });
    }
    for (const [x,z,r] of [[-2.38,2.5,.87],[-1.36,1.7,.35],[-1.1,2.8,.49],[-.86,-2.1,.39],
      [1.82,-6,.60],[3.45,-7,.51],[4.8,-9,1.1], [7.2,-10.1,1.38]]) {
      S.rock([x,-.22,z],[r,r*.80,r*.84],rock,{ res:.119 });
    }

    S.box([-2.9,.93,-1.43],[1.72,.13,1.11],stone,{ res:.12,rd:.12 });
    for (let i=0;i<8;i++) {
      const x=-1.25+i*.27;
      S.box([x,.83-i*.12,-1.07],[.21,.18,.67],stone,{ res:.082,rd:.055 });
    }
    for (const x of [-4.12,-1.87]) {
      for (let j=0;j<7;j++)
        S.box([x,1.12+j*.25,-1.42],[.23-j*.006,.145,.28],j===4 ? ceramic : stone,{ res:.073,rd:.05 });
      S.box([x,2.87,-1.42],[.32,.11,.36],stone,{ res:.072,rd:.052 });
    }
    S.box([-2.995,3.04,-1.42],[1.53,.115,.40],stone,{ res:.080,rd:.07 });
    S.box([-2.995,3.25,-1.42],[1.62,.102,.48],ceramic,{ res:.073,rd:.055 });
    S.lathe([-2.995,3.34,-1.42],.37,[.35,.075],ceramic,{ res:.065 });
    S.ball([-2.995,2.69,-1.42],.105,{ r:[18],em:true },{ res:.047 });
    S.box([1.5,-.08,-15],[24,.045,34],sea,{ res:.50,ghost:true });
    S.bake();

    const clouds = [
      [-7,3,3.9,4.3], [-4,3.9,3.0,3.4], [-5.5,-1.2,2.7,3.2],
      [3.1,-4.5,4.3,3.7], [6.2,-3.5,3.3,2.8], [1.2,-7.3,2.4,1.8],
      [-7,-24,5.2,5.8], [-4.2,-25,3.3,4.9], [6,-30,3.8,5.2], [1,-37,3.5,3.15],
      [4.6,-20.1,2.6,3.6], [-1.2,-14.1,3.7,2.8], [2.8,-14,2.8,2.3]
    ];
    const period = 22;
    const coverage = (x,z) => {
      let value = 0;
      for (const [cx,cz,rx,rz] of clouds) {
        const dx = Math.min(Math.abs(x-cx), period-Math.abs(x-cx));
        value = Math.max(value, 1.25 - Math.hypot(dx/rx, (z-cz)/rz));
      }
      return K.clamp(value * 1.9, 0, 1);
    };
    const bay = K.procedural.waterBodies;
    const water = bay.scene([bay.create({ id:'bay', bounds:{ min:[-12,-22], max:[17,11] },
      sample:() => ({ bed:-2, surface:-.13 }),
      optics:{ tint:[.37,.71,.73], deepTint:[.19,.43,.50], extinction:[.72,.45,.32] } })]);
    return B.finish({
      cam:{ target:[0,1.20,-4.1], dist:14.5, pitch:.16, yaw:.065, sway:0 },
      radius:53, detail:20, dither:0, look:{ pixel:true },
      skyEnvironment:K.skyEnvironment.compile({ defaults:{
        zenith:'#448bc3', horizon:'#bbdfe0', ground:'#537e94',
        sunAltitude:.90, sunAzimuth:-.89, sunStrength:.42
      } }),
      cloudField:K.clouds.compile({ bounds:{ min:[-11,-48], max:[11,18] }, resolution:[56,112],
        height:4.8, velocity:[period/8,0], repeat:true, coverage, color:'#f4f2e6', opacity:.90 }),
      cloudShadows:{ strength:.92, softness:.44 },
      liveSun:{ direction, ambient:.27, intensity:.86, shadows:false,
        skyBounce:{ color:'#8caebf', intensity:.12 } },
      atmosphere:[
        K.atmosphere.fog({ bottom:.035, top:.56, near:7, far:44, density:.029, color:'#b4d3d2' }),
        K.atmosphere.sphere({ at:[4.2,.24,-7.1], radius:2.9, density:.085, color:'#bad6d0' })
      ],
      water
    });
  }
});
