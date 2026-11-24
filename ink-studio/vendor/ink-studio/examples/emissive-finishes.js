/* Three independent emissive profiles in a little night market. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'emissive-finishes',
  name: 'Night market lights',
  seed: 38,
  build(seed) {
    const palette = [
      0x151823,0x202435,0x2d3144,0x403d50,0x565265,0x75677a,
      0x192b34,0x25414c,0x32626a,0x3e8f91,0x5cbeb4,0x8dd9c7,0xc2f6dd,
      0x2f242a,0x4b322d,0x704334,0xa2603d,0xca8450,0xf3b067,0xffd795,0xffefbd,
      0x2b233f,0x403155,0x584477,0x805b9c,0xae7cc3,0xc89fe6,0xe1c6fa,0xf2e1ff,
      0x374448,0x4a5558,0x686864,0x928276,0xada08b
    ];
    const B=makeBuilder(seed,palette);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{pixel:true,sun:K.V.norm([-.2,.64,.74]),amb:.37,sky:.12,sunK:.31,wob:.025,keepRenderSdf:true});
    const stone={r:[1,2,3,4,5]}, floor={r:[2,3,4,29,30]}, trim={r:[3,4,5,31]};
    const signWood={r:[6,7,8]}, timber={r:[13,14,15,16]}, iron={r:[1,2,3,4]};
    const arcane={r:[21,22,23,24]}, brass={r:[14,15,16,17,18]};
    const signLight={r:[9,10,11,12],em:true,v:.55};
    const fire={r:[17,18,19,20],em:true,v:.59};
    const crystal={r:[24,25,26,27],em:true,v:.67};
    const box=(at,half,material,res=.069,rd=.045,other={})=>S.box(at,half,material,{res,rd,...other});
    box([0,-.265,.11],[4.67,.22,1.94],stone,.126,.13);
    box([0,-.096,.11],[4.49,.085,1.80],floor,.118,.062);
    for(let row=0;row<6;row++) for(let col=0;col<14;col++){
      const x=(col-6.5)*.62+.10*(row%2), z=(row-2.5)*.59;
      box([x,-.022+.016*Math.sin(col*2.7+row*.82),z],[.30,.040,.281],floor,.11,.041);
    }
    box([0,.154,-1.34],[4.47,.205,.20],trim,.095,.073);
    for(let row=0;row<5;row++) for(let col=-5;col<=5;col++){
      const x=col*.83+(row%2)*.31;
      box([x,.40+row*.37,-1.43],[.397,.177,.201],stone,.094,.057,{bump:[.02,4.2]});
    }
    box([0,2.19,-1.44],[4.73,.12,.31],trim,.095,.065);
    for(const x of [-4.37,-1.42,1.38,4.38]){
      box([x,.18,-1.07],[.186,.19,.233],trim,.078,.052);
      box([x,1.07,-1.18],[.133,.80,.177],stone,.083,.049);
      box([x,1.934,-1.12],[.19,.150,.234],trim,.076,.051);
    }

    // A sign with an original moon-and-tide mark and a sharp, narrow outline.
    const sx=-2.91, sy=1.27, sz=-.92;
    box([sx,sy,sz-.23],[.91,.66,.101],trim,.079,.075);
    box([sx,sy,sz-.13],[.82,.56,.070],signWood,.059,.065);
    box([sx,sy+.57,sz-.10],[.88,.045,.08],iron,.053,.035);
    box([sx,sy-.57,sz-.10],[.88,.045,.08],iron,.053,.035);
    const moon=Array.from({length:13},(_,i)=>{
      const a=(-.60+i/12*1.63)*Math.PI;
      return [sx-.25+Math.cos(a)*.31,sy+.05+Math.sin(a)*.29,sz];
    });
    S.tube(moon,.050,.047,signLight,{res:.028,ghost:true,objectId:'moon-sign'});
    for(const [y,length] of [[.21,.35],[.035,.48],[-.145,.39]]){
      S.tube([[sx+.26,sy+y,sz],[sx+.26+length,sy+y,sz]],.044,.044,signLight,
        {res:.027,ghost:true,objectId:'moon-sign'});
    }

    // The sign and the lantern have different spill orientations.
    box([0,.095,-.25],[.47,.106,.42],trim,.070,.057);
    box([0,1.58,-.88],[.07,.29,.06],timber,.046,.025);
    S.tube([[0,1.91,-1.18],[0,1.91,-.65],[0,1.70,-.43]],.042,.036,iron,{res:.045});
    const lx=0, lz=-.43;
    box([lx,1.075,lz],[.31,.063,.243],brass,.048,.040);
    box([lx,1.627,lz],[.34,.077,.253],iron,.048,.047);
    S.lathe([lx,1.692,lz],.128,[.266,.07],brass,{res:.047});
    box([lx,1.346,lz],[.241,.235,.148],fire,.034,.018,{ghost:true,objectId:'amber-lantern'});
    for(const x of [-.261,.261]) for(const z of [lz-.16,lz+.177])
      S.tube([[x,1.12,z],[x*.94,1.59,z]],.028,.025,iron,{res:.029});
    S.tube([[0,1.13,lz+.178],[0,1.60,lz+.178]],.018,.018,iron,{res:.025});

    const mx=2.85, mz=.07, axes=[[.707,.707,0],[-.707,.707,0],[0,0,1]];
    box([mx,.084,mz],[.75,.103,.62],trim,.075,.057);
    box([mx,.217,mz],[.61,.070,.51],arcane,.062,.049);
    S.lathe([mx,.27,mz],.43,t=>.25+.11*Math.cos(t*2*Math.PI),arcane,{res:.066});
    S.torus([mx,.649,mz],.40,.055,brass,{res:.054});
    box([mx,1.185,mz],[.293,.293,.137],crystal,.038,.017,{ax:axes,ghost:true,objectId:'violet-prism'});
    for(const [x,y,z,r] of [[-.44,1.53,.04,.056],[.47,1.23,.06,.071],[.32,1.73,-.045,.048]])
      S.ball([mx+x,y,mz+z],r,crystal,{res:.028,ghost:true,objectId:'violet-prism'});
    for(const [x,z] of [[-3.94,.77],[-1.62,1.36],[1.12,1.53],[4.23,.81]])
      S.rock([x,.047,z],[.22,.105,.175],floor,{res:.080});
    S.bake();

    return B.finish({
      cam:{target:[0,.93,-.18],dist:7.9,yaw:.045,pitch:.195,sway:0},
      detail:26,radius:12,dither:0,look:{pixel:true,splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#272c4b',horizon:'#535069',ground:'#29293d',sunStrength:0}},
      emissiveFinishes:[
        { id:'moon-sign',select:{object:'moon-sign'},core:{color:'#a0fce2',strength:1.32},
          spill:{ color:'#42ebda',at:[sx,sy,sz+.46],normal:[0,0,-1],size:[1.25,.70],
            radius:2.12,intensity:6.4,shadows:false,sampleGrid:2 },
          glow:{color:'#45ecd3',radius:4,strength:.61,depthBias:.024,small:{belowPixels:96,radius:1,strength:.44}} },
        { id:'lantern',select:{object:'amber-lantern'},core:{color:'#fff0b0',strength:1.24},
          spill:{ color:'#ff823b',at:[0,1.27,lz+.41],normal:[0,-.71,-.70],size:[.28,.43],
            radius:2.97,intensity:9.7,shadowSteps:4,sampleGrid:2 },
          glow:{color:'#ffc05f',radius:4,strength:.67,depthBias:.031,small:{belowPixels:96,radius:1,strength:.45}} },
        { id:'prism',select:{object:'violet-prism'},core:{color:'#efd3ff',strength:1.26},
          spill:{ color:'#ba73ff',offset:[0,-.22,.27],normal:[0,-1,-.23],shape:'disk',size:[.42,.42],
            radius:2.47,intensity:9.3,sampleGrid:2,shadows:false },
          glow:{color:'#c58bff',radius:5,strength:.70,depthBias:.035,small:{belowPixels:96,radius:1,strength:.47}} }
      ]
    });
  }
});
