module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'rain-cistern',
  name:'Rain at the cistern',
  seed:61,
  build(seed) {
    const B = makeBuilder(seed, [
      0x16263d, 0x2b3d47, 0x45545a, 0x627473, 0x879188,
      0x65574d, 0x88715a, 0xad9473, 0xd4be92, 0xe1cda6,
      0x674544, 0x9e6152, 0xcf8461, 0xe19b72,
      0x233e51, 0x2b5a68, 0x4c8391, 0x83aebd, 0xbed8d9,
      0x334839, 0x4a644e, 0x6e805f, 0x879573,
      0x51677a, 0x697b8a, 0x8594a0,
      0xe9ad67, 0xffd688, 0xffebbf
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.47,.69,.58]);
    S.amb = .32;
    S.sky = .17;
    const stone = { r:[1,2,3,4] }, wood = { r:[5,6,7,8] }, tile = { r:[10,11,12,13] }, grass = { r:[19,20,21,22] };
    const coat = (color, mask, strength=1) => ({ type:'directionalColor', color, crossColor:color, strength, mask });
    const paving = K.surface.material({ r:[5,6,7,8,9] }, { layers:{
      wet:coat('#304e5c',{ type:'rainImpact', receiver:'awning', channel:'runoff' },.94),
      hits:coat('#d3f2fa',{ type:'rainImpact', receiver:'court', channel:'splash' },.92)
    } });
    const column = K.surface.material({ r:[1,2,3,4] }, { layers:{
      wet:coat('#183140',{ type:'rainImpact', receiver:'awning', channel:'runoff' },.90)
    } });
    const water = K.surface.material({ r:[14,15,16,17] }, { rainRipple:'pool', layers:{
      reflections:{ type:'reflection', strength:.87, f0:.76, sky:'#d2f2ed', horizon:'#4e7792', ground:'#233e51' },
      highlight:{ type:'specular', roughness:[.16,.19],color:'#fff0b9',strength:.34 }
    } });
    for (const [x,z,w,h,d] of [
      [-21,-28,9,9,7],[-9,-31,8,11,6],[2,-34,8,8,6],[14,-30,8,10,7],[25,-27,10,11,7]
    ]) S.rock([x,-1.8,z],[w,h,d],{ r:[23,24,25] },{ res:.38 });
    S.rock([-.15,-1.47,.17],[5.3,1.6,4.15],stone,{ res:.18 });
    S.box([-.05,-.232,.25],[4.15,.25,2.95],stone,{ res:.13,rd:.15 });
    for (let j=0;j<10;j++) for (let i=0;i<7;i++) {
      const x=-3.84+i*.50+(j%2)*.052, z=-2.17+j*.50;
      S.box([x,.095,z],[.244,.083,.244],paving,{ res:.071,rd:.042 });
    }

    const pool = { y:.106, min:[-.02,-1.90], max:[3.63,2.32] };
    for (const x of [-.10,3.73]) for (let i=0;i<9;i++) {
      S.box([x,.102,-1.91+i*.526],[.121,.121,.269],stone,{ res:.071,rd:.035 });
    }
    for (const z of [-2.04,2.45]) for (let i=0;i<9;i++) {
      S.box([-.095+i*.479,.094,z],[.245,.118,.14],stone,{ res:.073,rd:.036 });
    }
    S.box([1.805,.074,.21],[1.825,.032,2.11],water,{ res:.11,ghost:true });
    for (const [x,z,r] of [[-4.17,-.06,.52],[3.99,-1.7,.65],[3.98,1.41,.54],[-4.0,2.2,.42],[-.22,-2.45,.36]]) {
      S.rock([x,.044,z],[r,r*.72,r*.75],stone,{ res:.087 });
      S.rock([x,r*.46,z],[r*.72,r*.27,r*.59],grass,{ res:.078 });
    }

    for (const x of [-3.36,-1.24]) for (const z of [-1.53,.17]) {
      S.box([x,.34,z],[.24,.19,.25],stone,{ res:.065,rd:.047 });
      S.box([x,1.43,z],[.103,1.093,.114],z>.1 && x<-3 ? column : wood,{ res:.074,rd:.033 });
      S.box([x,2.5,z],[.21,.089,.22],wood,{ res:.062,rd:.029 });
    }
    for (const z of [-1.53,.17]) S.box([-2.30,2.53,z],[1.22,.102,.127],wood,{ res:.073,rd:.043 });
    S.box([-2.30,2.74,-.67],[1.47,.13,1.13],tile,{ res:.087,rd:.073 });
    for (let i=0;i<11;i++)
      S.box([-3.65+i*.27,2.70,.43],[.090,.052,.058],tile,{ res:.051,rd:.025 });
    const glow = { r:[26,27,28],em:true };
    S.lathe([-2.28,2.19,.09],.38,.035,wood,{ res:.047 });
    S.ball([-2.28,2.01,.11],[.15,.174,.146],glow,{ res:.050,ghost:true });
    S.lathe([-2.28,2.17,.11],.12,[.174,.049],tile,{ res:.047 });
    const occluder = K.atmosphere.occluder(S.modelSource().field.sdf,{ bias:.008,step:.017,steps:56 });
    S.bake();
    K.weather.fall(B,{ kind:'rain', worldSpace:true, profile:true, n:850, seed, box:[-6.5,5.4,-5.3,4.6],
      top:6.2, ground:() => 0, cols:[16,17,18], len:.124,size:.013,speed:8.8 });
    const profiles = {
      rain:{ rain:.54, windX:.82, windZ:.16, overcast:.46 },
      clear:{ rain:0, windX:.12, windZ:0, overcast:.21 }
    };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ zenith:'#37588a', horizon:'#c5ced2', ground:'#465e70', sunStrength:.23,
        sunAltitude:.36, sunAzimuth:-.78 },
      profiles, sequences:{ shower:{ duration:6.3, loop:false, keys:[
        { at:0, profile:'rain', ease:'hold' }, { at:2.75, profile:'rain' }, { at:3.45, profile:'clear' }
      ] } }, tracks:[{ id:'weather', sequence:'shower' }]
    });
    return B.finish({
      cam:{ target:[-.07,.88,-.46],dist:12.45,pitch:.54,yaw:.115,sway:0 },
      detail:23, radius:42, dither:0, skyEnvironment, weatherBinding:{ rainFull:.71 },
      precipitation:{ occluder, lightStrength:.42 },
      lights:[{ p:[-2.28,2.01,.26], radius:2.15, intensity:2.1, color:[1,.65,.34] }],
      rainImpacts:{
        maxSources:48,
        ripple:{ amplitude:.39, scale:.38, speed:1.53, width:.17, damping:.82, lifetime:.74 },
        paving:{ radius:.18, lifetime:.28, strength:1.28 },
        runoff:{ lifetime:2.30, strength:.26 },
        receivers:[
          { id:'pool', kind:'water', ...pool },
          { id:'court', kind:'paving', y:.178, min:[-4.09,-2.415], max:[-.57,2.59] },
          { id:'awning', kind:'roof', y:2.87, min:[-3.72,-1.75], max:[-.88,.425],
            drains:[
              { from:[-3.357,2.48,.283], to:[-3.357,.54,.283], width:.096, delay:.12, travel:.36 },
              { from:[-3.18,.178,.48], to:[-2.79,.178,2.26], width:.18, delay:.27, travel:.78 },
              { from:[-1.23,.178,.47], to:[-1.56,.178,1.74], width:.12, delay:.19, travel:.59 }
            ] }
        ]
      }
    });
  }
});
