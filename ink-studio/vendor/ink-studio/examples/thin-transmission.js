/* The same light reaches a leaf, an opaque paper lantern, and a folded awning. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'thin-transmission',
  name: 'The lantern stop',
  seed: 67,
  build(seed) {
    const palette = [
      0x151b2d,0x222e43,0x324158,0x4b5369,0x696779,0x898092,0xb1a0a3,
      0x182b32,0x24413a,0x36533e,0x587444,0x75884e,0x9ca758,0xc5c878,0xe1dd9c,0xf2ebb8,
      0x3f2b30,0x583934,0x755041,0x9b6846,0xc4834b,0xe6a654,0xf3c776,0xffd992,0xffebae,0xfff4d0,
      0x382c45,0x563c55,0x76515f,0x9b6574,0xc78582,0xd9a391,0xeebd9b,0xf5d6ae,0xf5e4be,
      0x473c42,0x63514f,0x816759,0xa68a6d,0xba9c7e
    ];
    const B=makeBuilder(seed,palette);
    const S=K.sculpt(makeSculpt(B));
    const sun=K.V.norm([-.24,.22,-.95]);
    Object.assign(S,{ pixel:true,keepRenderSdf:true,sun,amb:.53,sky:.10,sunK:.38,wob:.028 });
    const slate={r:[1,2,3,4,5]}, cap={r:[2,3,4,5,6]}, wood={r:[16,17,18,19,20]};
    const rail={r:[35,36,37,38,39]}, stem={r:[7,8,9,10]}, fineStem={r:[8,9,10,11]};
    const box=(at,half,mat,res=.066,rd=.04,extra={})=>S.box(at,half,mat,{res,rd,...extra});
    box([0,-.265,.04],[4.76,.20,1.45],slate,.121,.14);
    box([0,-.079,.04],[4.63,.071,1.35],cap,.111,.06);
    for(let i=0;i<14;i++){
      const x=(i-6.5)*.63;
      box([x,-.016,.08],[.303,.025,1.26],slate,.104,.019);
    }
    for(const x of [-4.45,-1.38,1.38,4.45]){
      box([x,.042,-.975],[.16,.126,.16],cap,.065,.053);
      box([x,.249,-.975],[.049,.163,.055],rail,.052,.027);
    }
    box([0,.37,-.975],[4.48,.049,.052],rail,.077,.034);

    const branch=[[-3.65,.027,.08],[-3.47,.49,.12],[-3.09,1.04,.13],[-2.98,1.51,.08],[-2.61,2.04,-.03]];
    S.tube(branch,.058,.020,stem,{res:.049});
    function leaf(center, angle, width, length, id) {
      const c=Math.cos(angle), s=Math.sin(angle), half=length*.5;
      const profile = y => width * Math.sqrt(Math.max(0, 1-(y/half)**2)) * (0.9-.16*y/half);
      const bend=(x,y)=>.09*(y/half)**2-.062*(x/width)**2 + .033*x/width;
      const edge=({position:[x,y]})=>{
        const dx=x-center[0], dy=y-center[1];
        const across=(dx*c+dy*s), along=-dx*s+dy*c;
        const fromRib=Math.abs(across)/Math.max(.035,profile(along));
        return Math.min(1,Math.max(0,(fromRib-.22)*1.24 + Math.max(0,Math.abs(along)/half-.76)*2));
      };
      const material=K.surface.material({r:[7,8,9,10,11]},{
        signals:{edge},
        layers:{through:{ type:'transmission', color:14, source:'sun',strength:.75,thickness:1.27,wrap:.19,
          drive:{thickness:{signal:'edge',to:.075}} }}
      });
      S.solid(center, Math.hypot(half,width)+.15, (x,y,z)=>Math.max(
        Math.abs(y)-half, Math.abs(x)-profile(y), Math.abs(z-bend(x,y))-.019
      ),(res,emit)=>{
        const rows=Math.ceil(length/res);
        for(let j=0;j<=rows;j++){
          const y=length*j/rows-half, w=profile(y), columns=Math.max(1,Math.ceil(2*w/res));
          for(let i=0;i<=columns;i++){
            const x=w*(2*i/columns-1), z=bend(x,y);
            emit(x,y,z-.019);
            emit(x,y,z+.019);
          }
        }
      },material,{res:.038,reach:.052,ax:[[c,s,0],[-s,c,0],[0,0,1]],objectId:id});
      const rib=[-.79,-.39,0,.43,.75].map(u=>{
        const y=half*u;
        return [center[0]-s*y,center[1]+c*y,center[2]+bend(0,y)+.027];
      });
      S.tube(rib,.013,.007,fineStem,{res:.026});
    }
    leaf([-3.69,.88,.28], .83,.29,.86,'leaf-low');
    leaf([-2.97,.65,.26],-.91,.29,.90,'leaf-right');
    leaf([-3.67,1.52,.17],1.01,.33,1.06,'leaf-left');
    leaf([-2.66,1.18,.25],-.79,.32,1.02,'leaf-middle');
    leaf([-2.53,1.83,.09],-.74,.31,1.02,'leaf-top');

    const paper=K.surface.material({r:[17,18,19,20]},{
      layers:{through:{type:'transmission',source:'local',color:24,strength:.89,thickness:.16,wrap:.27}}
    });
    const postX=[-.76,.51], lampX=-.125, lampBase=.245;
    box([lampX,.096,.18],[.85,.118,.60],slate,.074,.069);
    box([lampX,lampBase,.18],[.69,.077,.493],wood,.065,.047);
    box([lampX,1.746,.18],[.72,.088,.507],wood,.058,.051);
    box([lampX,1.882,.18],[.57,.066,.421],rail,.056,.041);
    box([lampX,1.993,.18],[.395,.051,.317],wood,.053,.035);
    S.torus([lampX,2.12,.16],.107,.023,wood,{res:.041,ax:[[1,0,0],[0,0,1],[0,-1,0]]});
    for(const x of postX) for(const z of [-.246,.606]) box([x,1.016,z],[.055,.708,.055],wood,.052,.027);
    box([lampX,1.005,.598],[.589,.687,.018],paper,.043,.011,{objectId:'front-paper'});
    box([.492,1.005,.167],[.019,.685,.396],paper,.043,.012,{objectId:'side-paper'});
    for(const z of [.624]) for(const y of [.56,1.466])
      box([lampX,y,z],[.629,.021,.026],rail,.031,.011);
    box([lampX,1.010,.627],[.023,.674,.028],rail,.032,.01);
    box([.525,1.01,.160],[.024,.672,.025],rail,.034,.01);

    const fabricCenter=[2.82,1.07,.51], sailWidth=1.16, sailHeight=.84;
    const fold=(x,y)=>.097*Math.cos(8.6*x+.88*y)+.042*Math.sin(3.6*x-3.6*y)+.117*(sailHeight-y);
    const flap=(x,y)=>y+(.065*Math.cos(x*3.2)-.082*x)*(1-y/sailHeight)*.58;
    const hem=({position:[x,y]})=>{
      const edge=Math.max(Math.abs(x-fabricCenter[0])/sailWidth,Math.abs(y-fabricCenter[1])/sailHeight);
      return Math.max(0,Math.min(1,(edge-.84)*7));
    };
    const cloth=K.surface.material({r:[26,27,28,29,30,31]},{
      signals:{hem},
      normal:{type:'waves',axis:'x',cross:'y',amplitude:.038,scale:.20},
      layers:{through:{type:'transmission',source:'sun',color:32,strength:.70,thickness:.28,wrap:.22,
        drive:{thickness:{signal:'hem',to:1.50}}}}
    });
    S.solid(fabricCenter,1.56,(x,y,z)=>{
      return Math.max(Math.abs(x)-sailWidth,Math.abs(flap(x,y))-sailHeight,Math.abs(z-fold(x,y))-.017);
    },(res,emit)=>{
      const rows=Math.ceil(1.86/res), columns=Math.ceil(sailWidth*2/res);
      for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++){
        const x=sailWidth*(2*i/columns-1), y=1.86*(j/rows-.5), z=fold(x,y);
        emit(x,y,z-.017);
        emit(x,y,z+.017);
      }
    },cloth,{res:.041,reach:.062,objectId:'folded-awning'});
    for(const x of [1.58,4.03]){
      box([x,.062,.38],[.16,.102,.189],cap,.070,.049);
      S.tube([[x,.12,.38],[x,1.96,.38]],.043,.037,wood,{res:.058});
    }
    S.tube([[1.45,1.947,.414],[4.19,1.947,.414]],.045,.042,rail,{res:.059});
    for(const x of [1.44,4.20]) S.ball([x,1.947,.414],.069,wood,{res:.034});
    // A rail behind the fabric breaks up the light reaching its upper half.
    box([2.88,1.52,.14],[1.18,.046,.047],wood,.049,.026);
    S.bake();

    return B.finish({
      cam:{target:[0,.94,.19],dist:8.25,yaw:.10,pitch:.18,sway:0},detail:25,radius:11,dither:0,
      look:{pixel:true,splatCoverage:'continuous'},
      liveSun:{direction:sun,ambient:.43,intensity:.88,shadows:true,mapSize:512,bias:.016,
        skyBounce:{color:'#92a1b1',intensity:.10}},
      lights:[{p:[lampX,1.107,.205],radius:1.83,intensity:2.12,color:[1,.67,.27]}],
      skyEnvironment:{defaults:{zenith:'#364460',horizon:'#b08886',ground:'#31394b',sunStrength:0}}
    });
  }
});
