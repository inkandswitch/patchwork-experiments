function camera(time) {
  const p=Math.max(0,Math.min(1,time/6));
  // Ease the approach, then pass the floating survey lights and leave the bank behind.
  const z=93-108*(1-(1-p)**2.05);
  const x=10*Math.sin(p*Math.PI*.95)*(1-p)-1.12;
  const y=6.55+5.2*(1-p);
  const yaw=.19*Math.sin(p*Math.PI)*Math.max(0,1-p*1.25);
  const pitch=.036+.060*Math.sin(Math.PI*p);
  const dist=6;
  const eye=[x,y,z];
  return { eye, yaw, pitch, dist, target:[
    x-dist*Math.cos(pitch)*Math.sin(yaw),
    y-dist*Math.sin(pitch),
    z-dist*Math.cos(pitch)*Math.cos(yaw)
  ] };
}

module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'cloud-flythrough',
  name:'Survey lights through a cloud bank',
  seed:43,
  build(seed) {
    const B=makeBuilder(seed,[
      0x5e86aa,0x264463,0x395873,0x54788c,0x6f92aa,0x8fb0bc,
      0x333d52,0x506177,0x73889a,0x94a7b0,
      0x574a4e,0x7b6255,0xb98352,0xe8b66f,0xf6db9b,
      0x88552d,0xb77a34,0xfaca76,0xff8b47,0xffd487,0xfff4ce
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.36,.54,.73]);
    S.amb=.48;
    S.sky=.26;
    S.sunK=.68;
    const distant={r:[1,2,3,4]}, face={r:[6,7,8,9]}, brass={r:[10,11,12,13,14]};
    for (const [x,z,w,h,d] of [
      [-93,-113,33,12,17],[-68,-108,29,18,15],[-43,-123,35,20,20],[-12,-123,28,11,19],
      [14,-120,18,9,16],[38,-119,28,16,20],[72,-106,33,21,22],[105,-109,35,17,23],
      [-23,-57,12,10,12],[-16,-50,9,11,9],[10,-61,13,8,13],[25,-53,14,10,14]
    ]) S.rock([x,-9,z],[w,h,d],distant,{res:.78});
    for (const [x,z,w,h,d] of [
      [-17,-21,8,11,8],[-23,-30,12,13,11],[-8.8,-7,3.26,8.7,4.3],
      [14,-19,8,8.8,7.5],[21,-27,9,10.9,9.5],[8,-3.6,3.2,6.4,4.5]
    ]) {
      S.rock([x,-6,z],[w,h,d],face,{res:.29});
      S.rock([x-.22,h-6.18,z-.43],[w*.61,h*.13,d*.57],{r:[3,4,5]},{res:.27});
    }
    S.box([0,-10,-38],[116,.13,149],{ r:[1,2,3,4] },{res:2.5,ghost:true});
    const glow={r:[18,19,20],em:true};
    for (const [x,y,z,scale] of [[-2.24,7.8,12,.66],[1.31,7.24,3.55,.83],[-3.16,6.96,-7.8,1],
      [3.02,6.91,-14.9,.92],[-1.48,6.57,-23,.59]]) {
      S.lathe([x,y-.87*scale,z],.37*scale,[.033,.055],brass,{res:.052});
      S.lathe([x,y-.51*scale,z],.24*scale,[.11*scale,.29*scale],brass,{res:.059});
      S.ball([x,y-.15*scale,z],[.32*scale,.175*scale,.32*scale],glow,{res:.060,ghost:true});
      S.lathe([x,y,z],.17*scale,[.37*scale,.22*scale],brass,{res:.061});
      S.lathe([x,y+.08*scale,z],.52*scale,[.29*scale,.16*scale,.014],{ r:[15,16,17] },{res:.057});
      for (let i=0;i<10;i++) {
        const a=i*Math.PI/5, rx=x+.52*scale*Math.cos(a), rz=z+.52*scale*Math.sin(a);
        S.ball([rx,y-.155*scale,rz],.065*scale,i%3===0?glow:brass,{res:.045,ghost:true});
      }
    }
    S.bake();
    const lumps=[
      [-5.7,-.9,4.6,4.5,.86],[-2.95,.2,4.35,4.2,1.05],[-.19,-2.8,4.60,6.65,1.17],
      [2.9,-.7,4.26,4.04,1.14],[5.35,-2.7,4.25,3.2,1.15],[.65,-7.2,3.7,4.4,1.18],
      [-4.75,-6.9,4.2,3.16,.92],[4.2,-5.9,3.5,4.1,1.04]
    ];
    const cloudField=K.clouds.asset({
      bounds:{min:[-12,-13],max:[11,7.8]}, resolution:[144,132],
      height:8.1,thickness:6.9,steps:32,opacity:.89,velocity:[.14,-.054],
      color:'#7d95b5', lighting:{ color:'#fff7e8', ambient:.62, strength:.71, rim:.28 },
      coverage(x,z) {
        let cover=0;
        for (const [cx,cz,rx,rz,depth] of lumps)
          cover=Math.max(cover,depth-Math.hypot((x-cx)/rx,(z-cz)/rz));
        const breakup=.045*Math.sin(2.13*x+1.24*z)*Math.sin(1.42*z-1.3*x)+.034*Math.cos(3.1*z-.78*x);
        return K.clamp((cover+breakup)*1.26,0,1);
      }
    },{ volume:[1.16,2.08], card:[3.1,4.9], resolution:80, directions:12 });
    const skyEnvironment={defaults:{zenith:'#316eaa', horizon:'#acc6da',ground:'#5d7fa9',
      sunAltitude:.43,sunAzimuth:-.42,sunStrength:.3}};
    const world=B.finish({ cam:{ ...camera(0), sway:0 }, radius:162, detail:22,dither:0,
      skyEnvironment, cloudField, aerialPerspective:{ start:34,density:.0046,contrast:.42 } });
    return world;
  },
  camera,
  animate(world) {
    world.anim={update(_dt,time){ Object.assign(world.cam,camera(time)); }};
    return world;
  }
});
