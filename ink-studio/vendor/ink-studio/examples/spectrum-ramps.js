/* A coastal signal station with a dusk spectrum and a painted signal board. */
const spectrum = require('./spectrum-ramp.json');
const primary = require('./primary-ramp.json');

module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'spectrum-ramps', name:'Signal at dusk', seed:37,
  build(seed) {
    const B = makeBuilder(seed,[
      0x141e32,0x222e47,0x32425a,0x495669,0x687279,0x96918b,0x342a39,0x583e47,
      0x82535a,0xab7771,0xd8a285,0xffddb3,0x122a37,0x20424d,0x2b6064,0x48827c,
      0x202941,0x363856,0x4f4b69,0x734c68,0xab6472,0xe5ad8e
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.64,.57,.25]),amb:.45,sky:.18,sunK:.52});
    const rock = {r:[0,1,2,3]}, masonry = {r:[1,2,3,4,5]}, iron = {r:[0,1,2,3]};
    const wood = {r:[6,7,8,9,10]}, brass = {r:[7,8,9,10,11]}, light = {r:[10,11],em:true};
    const water = K.surface.preset('rippling-water',{r:[12,13,14,15]},{
      normal:{amplitude:.055,scale:.98,speed:1.12},
      layers:{sky:{source:'scene',f0:.65,strength:.74},sun:false,ripples:{strength:.31}}
    });
    const far = {r:[16,17,18]}, near = {r:[1,2,3]};
    const box = (at,half,material,res=.10) => S.box(at,half,material,{res,rd:res*.55});

    S.box([-1,-1.263,-4],[22,.035,17],water,{res:.29,ghost:true});
    for (const [x,y,z,w,h] of [[-12,-1.2,-11,5,1.9],[-9,-1.4,-13,4,2.7],[6,-1.5,-16,6,2.6],
      [11,-1.35,-13,5,3.7],[15,-1.5,-15,6,3.2]]) S.rock([x,y,z],[w,h,3.4],far,{res:.28});
    for (const [x,y,z,w,h] of [[-7,-.88,-3,4.2,1.15],[-5,-.85,-2,3.6,.98],[1.6,-1.09,1.62,4.2,1.2],
      [4.38,-.76,1.48,2.23,1.31],[6.18,-.64,1.92,2.2,1.12],[1.42,-1.04,3.01,1.94,.99]])
      S.rock([x,y,z],[w,h,2.3],x < 0 ? near : rock,{res:.15});
    for (let i=0;i<14;i++) {
      const x = -8+i*.62, z = -1.6+(i*7%11)*.32;
      if (i%3 !== 0) box([x,-1.202,z],[.17+(i%4)*.09,.008,.022],{r:[14,15,18,19]},.055);
    }

    box([2.18,.02,.65],[3.18,.12,1.05],masonry);
    box([2.18,.17,.65],[3.25,.07,1.11],masonry);
    for (let i=0;i<10;i++) box([-.7+i*.64,.27,.65],[.303,.045,1.07],wood,.085);
    for (const x of [-.76,.46,1.66,4.75,5.32]) {
      box([x,.69,1.66],[.052,.44,.069],iron,.053);
      box([x,1.17,1.66],[.083,.052,.09],brass,.057);
    }
    for (const [a,b] of [[-.76,1.66],[4.75,5.32]]) {
      box([(a+b)/2,.99,1.66],[(b-a)/2,.038,.045],iron,.048);
      box([(a+b)/2,.70,1.66],[(b-a)/2,.026,.039],iron,.048);
    }

    for (const x of [1.2,4.37]) {
      box([x,1.47,.31],[.091,1.17,.105],wood,.064);
      box([x,2.68,.31],[.151,.076,.15],brass,.066);
    }
    const center = 2.785, lower = 1.49, upper = 2.52, width = 2.88;
    box([center,(lower+upper)/2,.38],[width/2+.12,(upper-lower)/2+.13,.145],iron,.075);
    const paint = K.surface.material({r:[13,14,15],em:true},{layers:{pigment:{
      type:'projected', pattern:'palette-ramp',
      projection:{origin:[center-width/2,lower,.55],along:[1,0,0],across:[0,1,0]},
      paletteRamp:{...primary,axis:'along',size:[width,upper-lower]}
    }}});
    box([center,(lower+upper)/2,.56],[width/2,(upper-lower)/2,.024],paint,.035);
    for (const y of [lower-.025,upper+.035]) box([center,y,.587],[width/2+.075,.047,.065],brass,.047);
    for (const [x,sign] of [[2.12,-1],[3.60,1]]) {
      const z = .605;
      const mark = sign < 0 ? light : {r:[0,1],em:true};
      S.tube([[x-sign*.25,1.79,z],[x,2.02,z],[x-sign*.25,2.25,z]],.043,.043,mark,{res:.031});
      S.tube([[x,2.02,z],[x-sign*.46,2.02,z]],.043,.043,mark,{res:.031});
    }
    for (const z of [-.04,.66]) {
      box([-.76,1.43,z],[.131,.045,.132],iron,.052);
      S.lathe([-.76,1.47,z],.34,[.098,.121,.107,.079],light,{res:.049});
      S.lathe([-.76,1.80,z],.16,[.156,.124,.054],brass,{res:.051});
    }

    S.bake();
    return B.finish({
      cam:{target:[.97,1.23,.27],dist:13.5,yaw:-.12,pitch:.095,sway:0},
      radius:28,detail:31,dither:0,look:{splatCoverage:'continuous'},
      skyEnvironment:{
        defaults:{zenith:'#333a67',horizon:'#f7be97',ground:'#a67a87',sunColor:'#fff0c9',
          sunAzimuth:3.48,sunAltitude:.139,sunSize:.068,sunStrength:1.43},
        sky:{orthoFov:38,paletteRamp:{ramp:{...spectrum,hue:[.086,-.31],saturation:.69,brightness:.82,steps:15},
          domain:[0,.42],strength:.70}}
      }
    });
  }
});
