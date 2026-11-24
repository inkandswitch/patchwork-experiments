/* Four specimens with generated palette roles and an artist-edited stone highlight. */
const source = require('./lighting-ramp-palette.json');

module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'authored-lighting-ramps',name:'The lighting bench',seed:63,
  build(seed,{controls}={}) {
    const draft = K.palette.lightingRamps.suggest(source);
    draft.ramps.stone.positions = [0,.17,.34,.48,.66];
    draft.ramps.stone.swatches.highlight = controls?.stoneHighlight ?? 26;
    const {palette,roles,ramps} = K.palette.lightingRamps.approve(draft);
    const B = makeBuilder(seed,palette);
    const S = K.sculpt(makeSculpt(B));
    const left = K.V.norm([-.57,.43,.76]), right = K.V.norm([.76,.26,.61]);
    Object.assign(S,{sun:left,amb:.40,sky:.19,sunK:.56});
    const stage={r:roles.studio.slice(1,5)}, back={r:roles.studio.slice(0,4)}, timber={r:roles.wood};
    const rim={r:roles.wood.slice(2)}, dark={r:[0,1,14]}, eye={r:[14,17,20]}, lips={r:[28,29,30]};
    const material=(role,extra={})=>K.surface.material({r:roles[role],materialId:role},{
      layers:{diffuse:{type:'diffuse',lightingRamp:ramps[role]},...extra}
    });
    const cloth=material('cloth',{nap:{type:'sheen',color:roles['cloth.bounce'][0],strength:.28,power:2}});
    const iron=material('iron',{glint:{type:'specular',strength:.67,roughness:.23,shadow:false,
      lightingRamp:{role:'iron',positions:[0,.13,.29,.51,1],weights:[0,.03,.14,.51,1]}}});
    const stone=material('stone');
    const skin=material('skin',{gloss:{type:'specular',color:roles['skin.highlight'][0],roughness:.54,strength:.13}});
    const box=(p,h,m,res=.080)=>S.box(p,h,m,{res,rd:res*.56});

    box([0,-.224,.02],[4.66,.188,1.44],stage,.13);
    box([0,-.013,.04],[4.70,.047,1.47],timber,.099);
    box([0,-.075,1.512],[4.74,.060,.076],rim,.087);
    box([0,1.55,-.98],[4.54,1.63,.16],back,.14);
    for (let row=0;row<3;row++) for (let i=0;i<9;i++) {
      const x=(i-4)*1.004+.04*(row%2);
      box([x,.52+row*1.051,-.802],[.487,.51,.021],(i+2*row)%6===0 ? stage : back,.12);
    }
    box([0,3.137,-.75],[4.57,.06,.133],timber,.091);
    for (const x of [-3.28,-1.09,1.09,3.28]) {
      box([x,.106,.10],[.92,.121,.78],stage,.087);
      box([x,.241,.10],[.947,.060,.80],rim,.066);
      box([x,.245,.90],[.31,.042,.028],dark,.044);
      for (const dx of [-.26,.26]) S.ball([x+dx,.248,.933],.021,rim,{res:.022});
    }

    const cx=-3.26, cy=1.46, cz=.24, halfW=.72, halfH=.89;
    const fold=(x,y)=>.123*Math.cos(x*12+.62*y)+.035*Math.sin(4.2*x-y*2.5)+.043*(halfH-y);
    S.solid([cx,cy,cz],1.24,
      (x,y,z)=>Math.max(Math.abs(x)-halfW,Math.abs(y)-halfH,Math.abs(z-fold(x,y))-.02),
      (res,emit)=>{
        const nx=Math.ceil(2*halfW/res), ny=Math.ceil(2*halfH/res);
        for (let iy=0;iy<=ny;iy++) for (let ix=0;ix<=nx;ix++) {
          const x=halfW*(2*ix/nx-1), y=halfH*(2*iy/ny-1), z=fold(x,y);
          emit(x,y,z-.019);
          emit(x,y,z+.019);
        }
      },cloth,{res:.044,reach:.08});
    const hem=Array.from({length:36},(_,i)=>{
      const x=halfW*(2*i/35-1), y=-halfH;
      return [cx+x,cy+y,cz+fold(x,y)+.02];
    });
    S.tube(hem,.026,.026,rim,{res:.036});
    S.tube([[cx-.90,2.43,cz+.035],[cx+.90,2.43,cz+.035]],.047,.047,rim,{res:.048});
    for (const x of [cx-.88,cx+.88]) S.ball([x,2.43,cz+.037],.076,rim,{res:.034});

    const ix=-1.09, iz=.29;
    S.lathe([ix,.29,iz],.323,[.56,.35],iron,{res:.057});
    S.tube([[ix,.47,iz],[ix,.92,iz]],.17,.19,iron,{res:.055});
    S.torus([ix,1.58,iz],.59,.171,iron,{ax:[[1,0,0],[0,0,1],[0,-1,0]],res:.042});
    for (const d of [-1,1]) S.ball([ix+d*.35,.447,iz+.31],.07,rim,{res:.034});

    const sx=1.09, sz=.23;
    box([sx,.386,sz],[.62,.092,.49],stone,.058);
    box([sx,1.142,sz],[.48,.713,.39],stone,.058);
    box([sx,1.902,sz],[.58,.114,.48],stone,.053);
    box([sx,2.035,sz],[.635,.047,.51],stone,.053);
    S.extrude([[[-.35,0],[0,.28],[.35,0],[0,-.28]]],[sx,1.22,sz+.42],.054,stone,{res:.041});
    for (const d of [-1,1]) {
      box([sx+d*.42,1.153,sz+.393],[.052,.62,.063],stone,.044);
      box([sx,1.22+d*.42,sz+.396],[.32,.032,.054],stone,.045);
    }

    const hx=3.22, hz=.22;
    S.ball([hx,.65,hz],[.68,.43,.37],cloth,{res:.053});
    S.lathe([hx,.82,hz],.64,[.26,.247],skin,{res:.054});
    S.ball([hx,1.67,hz],[.466,.626,.385],skin,{res:.043});
    S.ball([hx,1.395,hz+.113],[.355,.338,.325],skin,{res:.043});
    S.ball([hx+.03,1.584,hz+.355],[.095,.15,.129],skin,{res:.035});
    for (const d of [-1,1]) {
      S.ball([hx+d*.454,1.63,hz+.01],[.091,.155,.093],skin,{res:.040});
      S.ball([hx+d*.171,1.726,hz+.335],[.075,.025,.039],eye,{res:.025});
      S.tube([[hx+d*.098,1.793,hz+.345],[hx+d*.175,1.821,hz+.352],[hx+d*.235,1.804,hz+.313]],
        .022,.017,dark,{res:.024});
    }
    S.tube([[hx-.107,1.433,hz+.401],[hx+.020,1.445,hz+.427],[hx+.11,1.428,hz+.386]],
      .022,.017,lips,{res:.026});
    S.ball([hx-.034,2.015,hz-.031],[.473,.327,.379],dark,{res:.044});
    S.tube([[hx-.285,1.949,hz+.284],[hx-.145,2.049,hz+.356],[hx+.092,2.131,hz+.309],[hx+.291,2.09,hz+.192]],
      .063,.046,dark,{res:.039});
    S.bake();
    return B.finish({
      cam:{target:[0,1.40,.10],dist:7.55,pitch:.10,yaw:.039,sway:0},
      radius:14,detail:34,dither:0,paletteRoles:roles,
      surfaceLight:[[0,...left],[1.5,...right],[3,...left]],
      look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#354c5e',horizon:'#687b83',ground:'#3e5261',sunStrength:0}}
    });
  }
});
