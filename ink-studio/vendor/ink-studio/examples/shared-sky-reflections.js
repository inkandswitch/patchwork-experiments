const profiles = require('./shared-sky-profiles.json');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'sunset-landing',
  name: 'Sunset landing',
  seed: 67,
  build(seed) {
    const B = makeBuilder(seed, [
      0x18283e, 0x243843, 0x354d55, 0x586d71, 0x8da1a0, 0xc6c6af, 0x354d6f, 0x59718a, 0x8293a0,
      0x174057, 0x25556b, 0x4a7986, 0x75aeb7, 0x212e32, 0x37494a, 0x687c70, 0x9bad8e,
      0x48383d, 0x805752, 0xb28069, 0xd3a688, 0xffb968, 0xffe9ad
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.amb = .38;
    S.sky = .14;
    S.sunK = .55;
    S.sun = K.V.norm([-.46,.79,.36]);
    const slate = { r:[1,2,3,4,5], materialId:'slate' };
    const distant = { r:[6,7,8], materialId:'hills' };
    const wet = K.surface.preset('wet-cobblestone', {r:[1,2,3,4], materialId:'wet-stone'}, {
      layers:{ environment:{type:'reflection',source:'scene',strength:.78,f0:.52,
        sky:'#5b8ea7',horizon:'#9acbd2',ground:'#2b3e52'} }
    });
    const basinMetal = K.surface.material({r:[13,14,15,16], materialId:'polished-metal'}, {
      layers:{ environment:{type:'reflection',source:'scene',strength:.83,f0:.70,
        sky:'#5892ac',horizon:'#b1d8e1',ground:'#2c4051'} }
    });
    const baseWater = K.surface.preset('rippling-water', {r:[9,10,11,12], materialId:'water'}, {
      normal:{amplitude:.027,scale:.56,speed:1.32},
      layers:{sky:{source:'scene',f0:.80,strength:.94,sky:'#3d84a9',horizon:'#99d2df',ground:'#243d5c'},
        sun:false,ripples:{strength:.22}}
    });
    const plane=K.reflection.plane({id:'inlet',at:[0,-.19,0]});
    const water = K.reflection.material(baseWater,'inlet',{f0:.84,strength:.83,distortion:13,blur:.52});

    for (const [x,z,w,h] of [[-14,-28,7,2.15],[-7.3,-26,4.9,2.02],[-2,-35,5.5,1.72],
      [6.1,-33,6.5,1.85],[11.4,-24,4.6,2.04],[15.0,-22,3.2,2.37]]) {
      S.rock([x,-.38+h*.10,z],[w,h,w*.57],distant,{res:.42});
    }
    for (let i=0;i<8;i++) {
      const x=2.55+i*.075, z=.1+i*.56, y=.01+.042*i;
      S.box([x,y-.30,z],[.8,.37,.38],slate,{res:.14,rd:.073});
      S.box([x,y+.066,z],[.72,.08,.31],wet,{res:.09,rd:.03});
    }
    S.rock([3.4,-.15,2.1],[1.28,.74,.99],slate,{res:.15});
    S.rock([3.74,-.15,3.52],[1.21,.67,.86],wet,{res:.13});
    S.rock([-4.9,-.14,2.77],[1.21,.65,.66],slate,{res:.17});
    S.rock([-5.25,-.11,1.62],[1.0,.47,.63],wet,{res:.16});

    S.lathe([3.96,.39,.52],1.6,[.21,.16],basinMetal,{res:.060});
    S.lathe([3.96,1.75,.52],.79,[.44,.13],basinMetal,{res:.067});
    S.ball([3.96,1.84,.75],[.095,.122,.076],{r:[21,22],em:true},{res:.05});
    S.box([-.8,-.224,-19],[29,.025,35],water,{res:.58,ghost:true});
    S.bake();
    return B.finish({
      cam:{target:[0,.44,-3.4],dist:15.3,pitch:.106,yaw:.05,sway:0},
      detail:21, radius:38, dither:0, look:{pixel:true},
      reflections:[plane], skyEnvironment:K.skyEnvironment.compile(profiles)
    });
  }
});
