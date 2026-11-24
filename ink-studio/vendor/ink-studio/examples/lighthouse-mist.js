module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'lighthouse-mist',
  name: 'Lighthouse mist',
  seed: 42,
  build(seed) {
    const B = makeBuilder(seed, [
      0x111b2d, 0x1d2937, 0x34414b, 0x4f5960, 0x687277,
      0x53474d, 0x8b7e7c, 0xb8aea4, 0xeee0c7,
      0x493539, 0x774448, 0xa95450, 0xc57860,
      0x232f31, 0x3c4a42, 0x536349, 0x657256,
      0x27353b, 0x454648, 0x74665a, 0xc4a484,
      0x0e263d, 0x14394e, 0x26556c, 0x396b80,
      0xffab54, 0xffd58c, 0xffefc4
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.amb = .39;
    S.sun = K.V.norm([-.42,.70,.68]);
    S.sky = .14;
    S.sunK = .57;
    const stone = { r:[1,2,3,4] }, plaster = { r:[5,6,7,8] }, stripe = { r:[9,10,11,12] };
    const grass = { r:[13,14,15,16] }, wood = { r:[17,18,19,20] }, flame = { r:[25,26,27], em:true };

    for (const [x,z,w,h] of [[-37,-51,12,3.9],[-19,-50,10,3.3],[-8,-53,11,3.4],
      [8,-59,13,4.5],[22,-54,10,3.0],[36,-49,14,4.3]]) {
      S.rock([x,-.6,z],[w,h,7],{ r:[1,2,3] },{ res:.55 });
    }
    for (const [x,z,sx,sy,sz] of [
      [-7.1,-3.9,4.7,1.16,3.5], [-5.4,-2.0,2.9,1.03,3.6], [-8.1,.58,3.2,1.09,3.1],
      [-5.0,1.88,2.0,.72,1.54], [-3.31,-.61,1.60,.51,1.74],[-2.2,2.87,1.06,.57,.98]
    ]) {
      S.rock([x,-.28,z],[sx,sy,sz],stone,{ res:.218 });
      S.rock([x,sy*.61-.29,z],[sx*.79,sy*.36,sz*.83],grass,{ res:.178 });
    }

    const [lx,lz] = [-5.43,-1.84];
    const source = [lx,5.05,lz];
    const tower = (y, h, a, b, material, res=.085) =>
      S.lathe([lx,y,lz],h,[a,b],material,{ res });
    tower(.65,.3,1.10,.97,stone);
    tower(.9,.94,.90,.83,plaster);
    tower(1.84,.57,.83,.78,stripe);
    tower(2.41,.85,.78,.71,plaster);
    tower(3.26,.54,.71,.67,stripe);
    tower(3.8,.62,.67,.64,plaster);
    tower(4.42,.17,.71,.87,stone,.065);
    tower(4.59,.14,.86,.85,plaster,.066);
    S.ball(source,[.31,.27,.31],flame,{ res:.052,ghost:true });
    for (const angle of [-1.42,-.38,.62,1.80,2.80,3.8]) {
      const point = [lx+.55*Math.sin(angle),4.7,lz+.55*Math.cos(angle)];
      S.lathe(point,.71,.037,stone,{ res:.048 });
    }
    tower(5.41,.16,.76,.75,stone,.062);
    tower(5.57,.51,.81,.12,stripe,.077);
    tower(6.08,.18,.075,.04,stone,.051);
    S.box([lx,.99,lz+.81],[.20,.33,.08],wood,{ res:.053,rd:.056 });
    for (const y of [2.2,3.5])
      S.box([lx,y,lz+.78-(y-2)*.08],[.082,.15,.05],wood,{ res:.052,rd:.032 });

    const lights = [];
    for (let i=0;i<13;i++) {
      const x=-2.12+i*.52;
      S.box([x,.34,.97],[.258,.089,.64],i%4 ? wood : stone,{ res:.105,rd:.031 });
      if (i%2===0) for (const z of [.49,1.46])
        S.lathe([x,-.46,z],.89,[.125,.14],wood,{ res:.072 });
      if (i%4!==1) continue;
      const z=1.47, y=1.55;
      S.lathe([x,.42,z],1,.055,wood,{ res:.053 });
      S.ball([x,y,z],[.084,.12,.084],flame,{ res:.047,ghost:true });
      S.lathe([x,1.67,z],.11,[.14,.041],wood,{ res:.047 });
      lights.push({ at:[x,y,z+.08], radius:2.45, intensity:4.2, color:'#ffae63' });
    }

    // The raised pilot hut cuts the lower part of the sweep across the channel.
    S.box([2.30,1.98,-2.19],[.92,1.60,.70],wood,{ res:.12,rd:.06 });
    S.box([2.30,3.82,-2.19],[1.07,.35,.76],plaster,{ res:.10,rd:.065 });
    S.box([2.30,4.24,-2.19],[1.18,.15,.86],stripe,{ res:.10,rd:.072 });
    S.box([2.30,4.43,-2.19],[1.01,.12,.68],stripe,{ res:.095,rd:.07 });
    for (const x of [1.84,2.30,2.76]) {
      S.box([x,3.93,-1.42],[.15,.15,.042],stone,{ res:.060,rd:.025 });
      S.box([x,3.93,-1.36],[.11,.105,.024],{ r:[19,25],em:true },{ res:.050,ghost:true });
    }
    for (const x of [1.41,3.15]) S.lathe([x,-.28,-1.70],1.15,[.18,.16],wood,{ res:.079 });
    S.box([2.49,.34,-.75],[1.8,.085,.39],wood,{ res:.116,rd:.04 });

    const shadow = K.atmosphere.occluder(S.modelSource().field.sdf, { steps:48 });
    const sea = K.surface.preset('rippling-water', { r:[21,22,23,24], materialId:'water' }, {
      normal:{ amplitude:.038,scale:.49,speed:.9 },
      layers:{ sun:false, sky:{source:'scene',strength:.68,f0:.35}, ripples:{strength:.11} }
    });
    S.box([0,-.20,-19],[33,.06,42],sea,{ res:.57,ghost:true });
    S.bake();

    const fog = K.procedural.density.bounded({
      bounds:{ min:[-16,-.16,-23], max:[18,7.8,8] },
      sample(x,y,z,t) {
        const height = .23 + .68*Math.exp(-Math.max(0,y)*1.35);
        const fade = K.clamp((7.8-y)*.49,0,1) * K.clamp((8-z)*.32,0,1) * K.clamp((z+23)*.28,0,1);
        const drift = .86 + .14*Math.sin(.77*x+.98*z+t*.38)*Math.sin(1.8*y-.53*z);
        return height * fade * drift;
      }
    });
    return B.finish({
      cam:{ target:[-.65,2.52,-2.25], dist:16.4, pitch:.124, yaw:.045, sway:0 },
      radius:48, detail:20, dither:0,
      skyEnvironment:{ defaults:{ zenith:'#102749', horizon:'#53768e', ground:'#1e3c55',
        sunAltitude:-.18, sunStrength:0 } },
      atmosphere:[K.atmosphere.field({ field:fog, density:.31, step:.30, anisotropy:.12, color:'#96bfd7' })],
      volumeLighting:{ ambient:.25, shadow, points:lights, spots:[{
        at:source, direction:t => [1,-.04+.09*Math.sin(t*Math.PI/2), .045+.16*Math.cos(t*Math.PI/2)],
        innerAngle:5.5, outerAngle:11.5, radius:20, intensity:7.7, color:'#ffe0a3'
      }] },
      volumeQuality:{ steps:64 }
    });
  }
});
