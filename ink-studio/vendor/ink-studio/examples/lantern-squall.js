module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id:'lantern-squall',
  name:'Lanterns in a squall',
  seed:62,
  build(seed) {
    const B = makeBuilder(seed, [
      0x111e34, 0x26343e, 0x3b4d55, 0x54686b, 0x788780,
      0x423a39, 0x64544c, 0x8c7662, 0xb6a080,
      0x4c353a, 0x694448, 0x9d6052, 0xca8a65,
      0x172735, 0x2b3b50, 0x455a70, 0x667c90,
      0x293d3b, 0x435a4b, 0x626e50,
      0x3e607e, 0x5c8299, 0x8dafbd, 0xc0d1ce, 0xf1ead3,
      0xf18a44, 0xffbb73, 0xffdeb0
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.57,.50,.49]);
    S.amb = .34;
    S.sky = .16;
    S.sunK = .52;
    const stone = { r:[1,2,3,4] }, wood = { r:[5,6,7,8] }, tile = { r:[9,10,11,12] };
    const moss = { r:[17,18,19] }, far = { r:[13,14,15,16] }, flame = { r:[25,26,27], em:true };
    for (const [x,z,w,h,d] of [
      [-25,-37,10,9.2,7], [-15,-41,10,12,6], [-5,-49,9,8,7], [6,-49,13,11,9],
      [18,-43,10,8.8,6], [28,-39,10,10,7], [-13,-24,7,5.8,5], [12,-29,9,5.9,4.4]
    ]) S.rock([x,-2.5,z],[w,h,d],far,{ res:.40 });
    S.rock([.70,-1.81,.22],[6.2,2.25,4.6],stone,{ res:.18 });
    S.box([0,-.115,.52],[3.44,.162,2.37],stone,{ res:.124,rd:.115 });
    for (let j=0;j<8;j++) for (let i=0;i<11;i++) {
      const x=(i-5)*.50+(j%2)*.075, z=(j-3.5)*.50+.43;
      S.box([x,.08+.019*Math.cos(i*2+j),z],[.244,.067,.242],wood,{ res:.087,rd:.031 });
    }
    for (const [x,z,sx,sy,sz] of [
      [-4.2,.8,1.33,.65,1.10], [-3.5,-2.1,1.55,.78,1.21], [3.5,-1.4,1.68,.50,1.18],
      [4.4,1.38,1.28,.71,1.18], [3.48,2.41,.65,.46,.61], [-2.78,2.59,.58,.38,.52]
    ]) {
      S.rock([x,-.02,z],[sx,sy,sz],stone,{ res:.106 });
      S.rock([x,sy*.55,z],[sx*.79,sy*.32,sz*.82],moss,{ res:.102 });
    }

    for (const x of [-1.68,1.68]) for (const z of [-.95,1.32]) {
      S.box([x,.23,z],[.235,.14,.235],stone,{ res:.067,rd:.038 });
      S.lathe([x,.35,z],2.48,[.117,.103],wood,{ res:.070 });
      S.box([x,2.75,z],[.23,.075,.24],wood,{ res:.072,rd:.034 });
    }
    for (const z of [-.95,1.32]) {
      S.box([0,2.67,z],[1.84,.096,.116],wood,{ res:.076,rd:.034 });
      for (const x of [-1.68,1.68]) {
        const inner = x - Math.sign(x)*.43;
        S.tube([[x,2.23,z],[inner,2.68,z]],.064,.054,wood,{ res:.055 });
      }
    }
    S.box([0,2.91,.19],[2.18,.10,1.51],stone,{ res:.091,rd:.050 });
    for (let row=0;row<6;row++) {
      S.box([0,3.06+row*.12,.19],[2.22-row*.07,.076,1.57-row*.246],tile,{ res:.092,rd:.068 });
      if (row===0 || row===2) for (const z of [.19-1.50+row*.246,.19+1.50-row*.246])
        for (let i=0;i<11;i++) S.box([(i-5)*.375,3.084+row*.12,z],[.156,.039,.072],tile,{ res:.064,rd:.03 });
    }
    S.tube([[-1.91,3.63,.19],[.0,3.73,.19],[1.91,3.63,.19]],.086,.083,tile,{ res:.065 });

    const lights = [];
    for (const [x,y,z,radius,intensity] of [[-.73,2.11,1.08,2.70,2.5],[.79,2.07,1.08,2.7,2.25],[3.41,1.42,1.95,3.13,3.1]]) {
      if (x > 3) S.lathe([x,.23,z],1.0,[.069,.052],wood,{ res:.054 });
      else S.lathe([x,y+.21,z],.36,.028,wood,{ res:.048 });
      S.lathe([x,y-.19,z],.062,[.162,.171],wood,{ res:.055 });
      S.ball([x,y,z],[.151,.16,.151],flame,{ res:.043,ghost:true });
      S.lathe([x,y+.17,z],.085,[.173,.068],tile,{ res:.050 });
      lights.push({ p:[x,y,z+.10], radius, intensity, color:[1,.61,.25] });
    }
    const cut = K.atmosphere.occluder(S.modelSource().field.sdf,{ bias:.008, step:.018, steps:56 });
    S.bake();
    const box = [-9,8,-7,7], ground = () => .14;
    K.weather.fall(B,{ kind:'rain', worldSpace:true, profile:true, box, top:6.5, ground, n:1040,
      seed, cols:[20,21,22], len:.128, size:.014, speed:8.4 });
    K.weather.fall(B,{ kind:'snow', worldSpace:true, profile:true, box, top:6.6, ground, n:660,
      seed:seed+11, cols:[21,22,23,24], size:.035, speed:1.09, sway:.12 });
    const flakes = { snowfall:.63, rain:0, windX:-1.20, windZ:.34, airTemperature:-2 };
    const sleet = { snowfall:.27, rain:.32, windX:2.18, windZ:-.42, airTemperature:0 };
    const rain = { snowfall:.05, rain:.56, windX:-1.83, windZ:.39, airTemperature:3 };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ zenith:'#142746', horizon:'#506783', ground:'#20374b', sunAltitude:-.085, sunStrength:0 },
      profiles:{ flakes, sleet, rain }, sequences:{ squall:{ duration:6, keys:[
        { at:0, profile:'flakes' }, { at:1.8, profile:'sleet' }, { at:3.7, profile:'rain' }, { at:5.52, profile:'flakes' }
      ] } }, tracks:[{ id:'precipitation', sequence:'squall' }]
    });
    return B.finish({
      cam:{ target:[0.3,1.43,0],dist:13.1,pitch:.178,yaw:.155,sway:0 },
      radius:47, detail:22, dither:0,
      skyEnvironment, weatherBinding:{ rainFull:.61, snowFull:.72 },
      precipitation:{ occluder:cut, lightStrength:.77 },
      lights,
      atmosphere:[K.atmosphere.fog({ bottom:-.8, top:2.05, near:9, far:34, density:.032, color:'#7a91a6' })]
    });
  }
});
