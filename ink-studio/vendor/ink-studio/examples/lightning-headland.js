module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'lightning-headland',
  name: 'Lightning over the headland',
  seed: 38,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101325, 0x151a2f, 0x252c47, 0x414969, 0x656986,
      0x151d30, 0x25354a, 0x3a5664, 0x647684,
      0x212b38, 0x374559, 0x596273, 0x8990a2,
      0x201f39, 0x3c324b, 0x654b65, 0x9d7484,
      0x121a30, 0x1c2a45, 0x314464, 0x4f6b88,
      0xd18350, 0xffbe76, 0xffedab
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.6,.59,.54]);
    S.amb = .37;
    S.sky = .17;
    S.sunK = .34;
    const rock = { r:[1,2,3,4] }, turf = { r:[5,6,7,8] }, wall = { r:[9,10,11,12] };
    const roof = { r:[13,14,15,16] }, lamp = { r:[21,22,23], em:true };
    for (const [x,z,w,h] of [[-45,-68,15,6],[-28,-73,12,5],[-14,-76,15,6.2],
      [5,-77,12,4.5],[21,-70,14,7],[41,-65,16,7]]) {
      S.rock([x,-1,z],[w,h,7],{ r:[1,2,3] },{ res:.68 });
    }
    for (const [x,z,w,h,d] of [
      [-8.9,-3.5,5.6,1.48,5.4],[-8.0,1.3,4.45,1.63,4.0],[-5.65,-3.2,2.82,1.18,3.47],
      [-6.65,4.8,4.1,1.4,2.65],[-4.25,-4.31,1.58,.62,2.38],[-2.97,-4.98,.84,.41,1.35],
      [9.5,-10,2.75,.93,2.0],[11,-11.5,3.3,1.0,2.38]
    ]) {
      S.rock([x,-.24,z],[w,h,d],rock,{ res:.23 });
      S.rock([x,h*.56-.25,z],[w*.89,h*.36,d*.87],turf,{ res:.20 });
    }

    const x = -6.1, z = -.64;
    const tower = (y,h,a,b,material,res=.083) => S.lathe([x,y,z],h,[a,b],material,{ res });
    tower(.85,.27,.89,.78,rock);
    tower(1.12,1.29,.74,.64,wall);
    tower(2.41,.53,.64,.59,roof);
    tower(2.94,1.20,.59,.50,wall);
    tower(4.14,.16,.50,.68,rock);
    tower(4.30,.12,.69,.67,wall);
    S.ball([x,4.71,z],[.27,.29,.27],lamp,{ res:.053, ghost:true });
    for (let i=0;i<8;i++) {
      const angle = i*Math.PI/4;
      S.lathe([x+.53*Math.cos(angle),4.39,z+.53*Math.sin(angle)],.67,.038,rock,{ res:.052 });
    }
    tower(5.05,.16,.68,.72,rock,.065);
    tower(5.21,.57,.72,.085,roof,.066);
    tower(5.78,.27,.035,.022,rock,.042);
    S.box([x+.10,1.60,z+.70],[.17,.32,.04],roof,{ res:.062, rd:.034 });
    S.box([x+.13,3.47,z+.52],[.068,.094,.035],lamp,{ res:.048, rd:.021 });
    for (const [tx,ty,tz,h] of [[-9.6,.92,1.3,3.45],[-10.68,1.15,2.4,2.86],[-8.8,.92,2.02,2.34],
      [-4.74,.42,-3.27,1.69],[-3.67,.22,-4.39,1.28],[9.25,.23,-10.25,1.45],[10.7,.48,-11.0,1.70]]) {
      S.lathe([tx,ty,tz],h*.91,[.13,.043],rock,{ res:.09 });
      for (let tier=0;tier<5;tier++) {
        const s = 1-tier*.135, y = ty+h*(.23+.13*tier);
        S.lathe([tx+.075*tier,y,tz],h*.27,[h*.234*s,.014],turf,{ res:.095 });
      }
    }
    const sea = K.surface.preset('rippling-water',{ r:[17,18,19,20], materialId:'sea' },{
      normal:{ type:'noise', amplitude:.033, scale:1.04, speed:.71 },
      layers:{ sun:false, sky:{ source:'scene', strength:.87, f0:.66 }, ripples:{ strength:.046 } }
    });
    S.box([0,-.25,-29],[46,.065,64],sea,{ res:.68, ghost:true });
    S.bake();

    const clamp = x => Math.max(0,Math.min(1,x));
    const clouds = K.clouds.compile({
      bounds:{ min:[-78,-121], max:[78,22] }, resolution:[128,120],
      height:8.3, velocity:[.59,.15], opacity:.86, color:'#20233e',
      coverage(x,z) {
        const coarse = Math.sin(x*.19+z*.17) * Math.cos(x*.32-z*.09)
          + .6*Math.cos(x*.15+z*.29) + .36*Math.sin(x*.72+Math.sin(z*.45)*2)*Math.cos(z*.76);
        const billows = Math.sin(z*.26+x*.114+Math.cos(x*.28)*1.46);
        return clamp(.45 + coarse*.51 + billows*.31);
      }
    });
    const lightning = K.weather.lightning({
      cues:[K.anim.cue('western-thunder','sound',1.20), K.anim.cue('eastern-thunder','sound',3.10)],
      events:[
        { id:'western-flash', cue:'western-thunder', at:[-6.8,8.4,-18.5], duration:.64,
          radius:25, falloff:2.35, intensity:2.75, attack:.08, color:'#b6c1ff' },
        { id:'eastern-flash', cue:'eastern-thunder', at:[11.2,7.2,-26.5], duration:.73,
          radius:28, falloff:2.4, intensity:2.28, attack:.10, color:'#e0b8ef' }
      ]
    });
    return B.finish({
      cam:{ target:[-1.3,2.76,-2.0], dist:18, yaw:.064, pitch:.098, sway:0 },
      radius:58, detail:22, dither:0, cloudField:clouds, lightning,
      skyEnvironment:{ defaults:{
        zenith:'#151730', horizon:'#555577', ground:'#141c32',
        sunAltitude:-.3, sunStrength:0
      } }
    });
  }
});
