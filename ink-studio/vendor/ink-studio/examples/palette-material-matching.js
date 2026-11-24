/* A woven banner and copper ewer use the same candidate palettes in both views. */
const clothPalette = ['#211c30','#403353','#68355e','#6a667f','#a06786','#92a59a','#c795a7','#ebcfb7'];
const copperPalette = ['#2c4445','#4f6467','#73847e','#abc1b2','#66372b','#986047','#c88c54','#e6b59a','#27232e'];

module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'palette-material-matching',name:'Dye and copper works',seed:42,
  build(seed,{controls}={}) {
    const mode = controls?.mode ?? 'priorities';
    if (!['rgb','priorities','perceptual','brightness','chroma','hue'].includes(mode))
      throw new RangeError('Choose priorities or a palette matching mode');
    const B = makeBuilder(seed,[
      0x172431,0x283844,0x40525e,0x52626a,0x78837e,0x9a9c8d,0xc2b29b,0xddc3a3,
      0x27152e,0x371a3e,0x482348,0x5c3058,0x764267,0x935675,0xad6f8a,0xc68c9f,0xdeb0aa,
      0x3b2925,0x46332e,0x58423a,0x61534e,0x756763,0x8b7867,0x987c68,0xaf907c,0xd2a78a,0xe4c1a3,
      0x373039,0x62483e,0x956c51,0xc08d63,0xe6b481,0xefe0ae,0x376460,0x638479
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.64,.67,.45]),amb:.24,sky:.13,sunK:.64});
    const names = { cloth:mode === 'priorities' ? 'brightness' : mode, copper:mode === 'priorities' ? 'hue' : mode };
    const paint = (id,r,palette)=>K.surface.material({r,materialId:id},{
      paletteConstraint:{palette,match:names[id]}
    });
    const cloth = paint('cloth',[8,9,10,11,12,13,14,15,16],clothPalette);
    const copper = paint('copper',[17,18,19,20,21,22,23,24,25,26],copperPalette);
    const wood={r:[27,28,29,30]}, wall={r:[1,2,3,4,5]}, stone={r:[1,2,3,4]}, rim={r:[28,29,30,31,32]};
    const dark={r:[0,1,17]}, enamel={r:[33,34,32]}, clothTrim={r:[27,29,30,31,32]};
    const box=(p,h,m,res=.088)=>S.box(p,h,m,{res,rd:res*.58});
    box([0,-.21,.09],[4.52,.17,1.37],stone,.145);
    box([0,-.055,.09],[4.53,.049,1.386],wood,.105);
    box([0,-.098,1.463],[4.60,.065,.059],rim,.087);
    box([0,1.58,-.73],[4.38,1.63,.155],wall,.13);
    for (let j=0;j<4;j++) for (let i=0;i<12;i++) {
      const x = (i-5.5)*.728+(j%2)*.07;
      box([x,.40+j*.775,-.545],[.352,.372,.023],(i+2*j)%7===0 ? stone : wall,.117);
    }
    box([0,3.236,-.56],[4.41,.053,.159],wood,.092);
    box([0,.145,-.407],[4.43,.068,.185],rim,.086);

    const cx=-2.02, cy=1.66, cz=.38, halfW=1.34, halfH=1.18;
    const fold=(x,y)=>.19*Math.cos(9.2*x+.36*y)+.071*Math.sin(4.0*x-1.9*y)+.055*(halfH-y);
    const sag=x=>.061*(x/halfW)**2;
    S.solid([cx,cy,cz],1.97,
      (x,y,z)=>Math.max(Math.abs(x)-halfW,Math.abs(y-sag(x))-halfH,Math.abs(z-fold(x,y))-.026),(res,emit)=>{
        const columns=Math.ceil(2*halfW/res), rows=Math.ceil(2*halfH/res);
        for (let iy=0;iy<=rows;iy++) for (let ix=0;ix<=columns;ix++) {
          const x=halfW*(2*ix/columns-1), y=halfH*(2*iy/rows-1)+sag(x), z=fold(x,y);
          emit(x,y,z-.025);
          emit(x,y,z+.025);
        }
      },cloth,{res:.048,reach:.094,objectId:'folded-cloth'});
    S.tube([[cx-halfW-.18,cy+halfH+.08,cz+.11],[cx+halfW+.18,cy+halfH+.08,cz+.11]],.053,.053,rim,{res:.049});
    const edge = Array.from({length:41},(_,i)=>{
      const x=halfW*(2*i/40-1), y=-halfH+sag(x);
      return [cx+x,cy+y,cz+fold(x,y)+.027];
    });
    S.tube(edge,.030,.029,clothTrim,{res:.037});
    for (const x of [cx-halfW-.20,cx+halfW+.20])
      S.ball([x,cy+halfH+.077,cz+.11],.090,rim,{res:.034});

    const x=1.91,z=.26;
    box([x,.163,z],[1.24,.162,.69],stone,.087);
    box([x,.336,z],[1.26,.057,.71],wood,.071);
    const radii=[.51,.57,.76,.89,.91,.85,.74,.51,.31,.28,.385];
    const profile=t=>{
      const q=t*(radii.length-1), lo=Math.min(radii.length-2,Math.floor(q));
      return radii[lo]+(radii[lo+1]-radii[lo])*(q-lo);
    };
    S.lathe([x,.385,z],2.22,profile,copper,{res:.050});
    S.lathe([x,.373,z],.101,[.55,.555],rim,{res:.046});
    S.lathe([x,2.604,z],.075,[.383,.40],copper,{res:.043});
    S.lathe([x,2.674,z],.022,[.319,.324],dark,{res:.033});
    S.tube([[x+.215,2.37,z],[x+.741,2.33,z],[x+1.015,2.04,z],[x+1.05,1.72,z],
      [x+.946,1.50,z],[x+.716,1.27,z]],.086,.073,copper,{res:.045});
    S.tube([[x-.54,1.62,z],[x-.83,1.88,z],[x-.98,2.17,z],[x-1.19,2.29,z]],
      .157,.061,copper,{res:.045});
    for (let i=0;i<4;i++) {
      const p=[-0.07-.41*i,.059,1.012];
      box(p,[.13,.057,.085],i%2 ? enamel : clothTrim,.045);
    }

    S.bake();
    return B.finish({
      cam:{target:[0,1.53,.10],dist:8.03,pitch:.13,yaw:.041,sway:0},radius:13,detail:34,dither:0,
      skyEnvironment:{defaults:{zenith:'#263a51',horizon:'#526776',ground:'#3a4b56',sunStrength:0}},
      look:{splatCoverage:'continuous'}
    });
  }
});
