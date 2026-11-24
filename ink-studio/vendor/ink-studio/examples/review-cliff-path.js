const reviewCamera = require('./environment-review-camera.js');

module.exports = ({KIT:K,makeBuilder,makeSculpt}) => {
  const camera = reviewCamera([
    {time:0, target:[-.30,2.22,-5.30], dist:14.1, yaw:.23, pitch:.135},
    {time:1.8, target:[-1.1,1.78,-5.55], dist:11.6, yaw:.14, pitch:.105},
    {time:3.1, target:[-.72,1.42,-6.27], dist:7.8, yaw:-.12, pitch:.035},
    {time:5.1, target:[-.40,1.61,-9.0], dist:6.1, yaw:-.24, pitch:.12}
  ]);
  return {
    id:'review-cliff-path',name:'Clouds at the cliff path',seed:22,
    review:{duration:5.1,checkpoints:[0,3.1,5.0]},
    animate:camera.animate,
    build(seed) {
      const B = makeBuilder(seed,[
        0x324a67,0x344d62,0x53677b,0x738494,0xa2a6a2,0xc1b6a1,
        0x315344,0x4f7156,0x71916b,0x9aaf84,0x756b60,0xa2937e,
        0xcbb79a,0xe2cdad,0x523d40,0x8f554d,0xcf835c,0xffb571,0xffdf97,
        0x40748b,0x598a9a,0x83a9b1,0x688292,0x9ca7ad,0xcac4b3
      ]);
      const S = K.sculpt(makeSculpt(B));
      S.amb=.33;
      S.sky=.24;
      S.sun=K.V.norm([.56,.62,.38]);
      const rock={r:[1,2,3,4,5]}, grass={r:[6,7,8,9]}, stone={r:[10,11,12,13]};
      const copper={r:[14,15,16,17]}, glow={r:[17,18],em:true};
      const xAt = z => -1.55+.50*Math.sin(z*.52);
      for (const [x,z,w,h,d] of [
        [-20,-31,10,5,8],[-12,-43,9,8,9],[1,-45,11,6,8],[17,-41,12,7,8],[26,-32,10,5,7]
      ]) S.rock([x,-4.1,z],[w,h,d],{r:[22,23,24]},{res:.51});
      for (const [x,z,w,h,d] of [
        [-5.45,3.5,4.7,3.25,3.5],[-5.9,-2.05,4.5,3.85,4.23],[-5.25,-6.02,3.98,4.42,3.10],
        [-6.0,-10.25,5.08,4.63,3.21],[-5.66,-15.1,3.75,5.25,3.80],[-7.65,-19,4.82,4.66,3.6]
      ]) {
        S.rock([x,-1.96,z],[w,h,d],rock,{res:.22});
        S.rock([x,h*.65-2.02,z],[w*.90,h*.36,d*.84],grass,{res:.188});
      }
      const rail=[];
      for (let i=0;i<27;i++) {
        const z=5.4-i*.76, x=xAt(z), y=.8+.045*i;
        S.box([x,y-.23,z],[.98,.24,.40],rock,{res:.118,rd:.064});
        S.box([x,y,z],[.86,.11,.38],stone,{res:.099,rd:.061});
        if (i%3===0) {
          S.lathe([x+.82,y,z],.77,[.063,.046],rock,{res:.068});
          rail.push([x+.82,y+.69,z]);
        }
        if (i%6===1) {
          S.lathe([x-.72,y+.09,z],.82,[.058,.045],copper,{res:.061});
          S.box([x-.72,y+1.03,z],[.107,.132,.105],glow,{rd:.031,res:.053});
          S.lathe([x-.72,y+1.17,z],.16,[.14,.057],copper,{res:.067});
        }
      }
      S.tube(rail,.036,.033,copper,{res:.038,ghost:true});
      for (const x of [-2.23,-.64]) S.lathe([x,2.0,-13.0],2.52,[.19,.15],stone,{res:.085});
      S.box([-1.44,4.50,-13.0],[1.1,.128,.27],stone,{rd:.066,res:.085});
      S.box([-1.44,4.66,-13.0],[1.17,.090,.31],copper,{rd:.067,res:.083});
      S.bake();
      for (let z=-41;z<=20;z+=.62) for (let x=-12;x<=27;x+=.62) {
        const jx=.15*Math.sin(x*27.4+z*12.7), jz=.14*Math.sin(z*44.3-x*16.3);
        const band=Math.sin(z*.65+x*.20)+.44*Math.sin(x*3-z*2);
        B.disc(x+jx,-3.20,z+jz,[0,1,0],.62,.009,B.P[band>.94 ? 20 : 19],3,{nd:true});
      }

      const cloudField = K.clouds.asset({
        bounds:{min:[-3.0,-21],max:[15.4,-8.3]},height:4.58,thickness:3.30,
        resolution:[48,48],color:'#858daf',opacity:.94,velocity:[.20,-.02],
        lighting:{color:'#ffe5cd',ambient:.40,strength:.79,rim:.46},
        coverage(x,z) {
          const bank = Math.max(1.14-Math.hypot((x-1.2)/3.8,(z+13.1)/3.4),
            1.11-Math.hypot((x-6.4)/4.5,(z+15.2)/4.4),1.17-Math.hypot((x-12.4)/3.8,(z+16.7)/3.8));
          return K.clamp(bank+.11*Math.sin(2.7*x+1.6*z)+.08*Math.cos(3.4*z-.58*x),0,1);
        }
      },{resolution:64});
      return B.finish({
        cam:{...camera.at(0),sway:0},radius:48,detail:23,dither:0, cloudField,cloudRepresentation:'card',
        skyEnvironment:{defaults:{zenith:'#43699d',horizon:'#f0c9ad',ground:'#5f8699',
          sunColor:'#ffebbe',sunAzimuth:3.06,sunAltitude:.255,sunStrength:.71}},
        atmosphere:[
          K.atmosphere.box({id:'crossing',min:[-4.05,.48,-1.20],max:[1.94,2.73,3.2],density:.43,color:'#b4c7d9'}),
          K.atmosphere.fog({id:'sea haze',bottom:-3.23,top:-.28,near:10,far:50,density:.023,color:'#a9c1c6'})
        ]
      });
    }
  };
};
