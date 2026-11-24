const duration = 6;
const phase = time => ((time % duration) + duration) % duration;
const fade = time => Math.min(1,time/.52,(duration-time)/.88);

function sequence(motion, grid, controls) {
  const rate = 24, solver = motion.stableFluid(grid), frames = [solver.snapshot()];
  return time => {
    const cursor = Math.max(0, Math.min(duration, time)) * rate;
    const left = Math.floor(cursor), right = Math.ceil(cursor), blend = cursor - left;
    // Seek on the same fixed steps even if the render asks for times out of order.
    while (frames.length <= right) frames.push(solver.step(1 / rate, controls));
    return (u, v) => {
      const a = frames[left].sample(u, v)?.density ?? 0;
      return blend ? a * (1 - blend) + (frames[right].sample(u, v)?.density ?? 0) * blend : a;
    };
  };
}

function basin({ KIT: K, makeBuilder, makeSculpt }, seed, controls) {
  const B = makeBuilder(seed, [
    0x111e2b,0x1b2837,0x263648,0x354858,0x546474,0x737982,
    0x2a3b3d,0x3a5551,0x4e6d5c,0x68816a,0x899372,
    0x1c4c60,0x246477,0x367d87,0x459393,0x70b1ab,
    0x433543,0x714451,0xa35a56,0xce7958,0xefac68,0xffe5a3,
    0x4f3d41,0x785747,0xa9734d,0xc8995e,0xdfb97a
  ]);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { pixel:true, amb:.38, sky:.21, sunK:.65, shLen:0, sun:K.V.norm([-.63,.78,.31]) });
  const border = {r:[1,2,3,4]}, tile = {r:[2,3,4,5]}, clay={r:[22,23,24,25,26]};
  const glaze={r:[7,8,9,10,15]};
  const darkStone={r:[0,1,2,3,4]}, leaf={r:[6,7,8,9,10]};
  const box=(p,half,mat,res=.10,rd=.045,extra)=>S.box(p,half,mat,{res,rd,...extra});
  const oval=(x,z)=>Math.hypot(x/2.71,z/1.76);
  const stone=(x,z)=>Math.hypot((x-.38)/.58,(z+.047)/.46);
  const sourceAt=t=>[-.91+.37*Math.sin(t*Math.PI/3-.7), .31+.26*Math.cos(t*2*Math.PI/3)];
  function current(x,z,t) {
    const u=x-.27,v=z+.06,r=Math.hypot(u,v), spin=1.02+.99*Math.exp(-r*r*.69);
    const b=x+1.22,c=z-.66, shear=.85*Math.exp(-(b*b+c*c)*1.44);
    return [-v*spin+c*shear, u*spin-b*shear+.16*Math.sin(t*.9+x*2.1)];
  }
  const fluid = sequence(K.procedural.motion, {
    width:88,height:58,cell:.064,origin:[-2.816,-1.856],pressureIterations:20,maxDt:.05,
    diffusionIterations:3,mask:(x,z)=>oval(x,z)<.986&&stone(x,z)>1,
    initial(x,z) {
      return { velocity:current(x,z,0), density:.50*Math.exp(-((x+1.18)**2*11+(z-.43)**2*21)) };
    }
  }, {
    force(x,z,t,{velocity}) {
      const [a,b]=current(x,z,t);
      return [.98*(a-velocity[0]),.98*(b-velocity[1])];
    },
    source(x,z,t) {
      const [a,b]=sourceAt(t), d=(x-a)**2+(z-b)**2;
      const pulse=.76+.24*Math.cos(t*4.4);
      return 4.2*pulse*Math.exp(-d*38)+1.32*Math.exp(-((x+1.61)**2+(z+.30)**2)*69);
    },
    viscosity:.00007,diffusion:.000025,dissipation:.19
  });
  const pigment={
    channels:['density'],
    frame(time) {
      const t=phase(time), density=fluid(t), opacity=fade(t);
      return { sample:(_name,x,z)=>density(x,z)*opacity };
    }
  };
  const bands={stops:[{at:.036,color:17},{at:.083,color:18},{at:.157,color:19},{at:.27,color:20}],
    ...(controls?.edge!==false && {edge:{width:.016,color:21}})};
  const water = K.surface.material({r:[11,12,13,14],materialId:'pigment-basin'},{
    layers:{
      bed:{
        type:'projected',color:'#275f71',strength:.47,
        pattern({u,v},result) {
          const light=Math.sin(u*5.9+v*5.3)+Math.sin(u*9.5-v*3.2)*.42;
          const ripple=Math.sin(v*16.4+.52*Math.cos(u*3.7)+.24*Math.cos(u*8.2));
          result[3]=K.clamp(.18+.30*light+.44*Math.max(0,ripple-.56),0,1);
        }
      },
      pigment:{
      type:'projected',field:'pigment',space:'world',
      ...(controls?.banded===false ? {maskChannel:'density',range:[.036,.34],colors:[17,18,19,20,21]} :
        {pattern:'bands',bandChannel:'density',bands})
    }}
  });

  box([0,-.255,-.035],[3.58,.30,2.43],border,.131,.18);
  for(let row=0;row<7;row++) for(let col=0;col<10;col++){
    const x=(col-4.5)*.69+(row%2?.12:-.12), z=(row-3)*.65;
    if(oval(x,z)<.92) continue;
    box([x,.04,z],[.334,.054,.308],(row*3+col)%5===2?border:tile,.104,.047);
  }
  const size=[2.78,1.83], lip=Array.from({length:65},(_,i)=>{
    const a=i*Math.PI/32;
    return [size[0]*Math.cos(a),.267,size[1]*Math.sin(a)];
  });
  S.tube(lip,.206,.186,darkStone,{res:.097});
  for(let i=0;i<52;i++){
    const a=(i+.5)*Math.PI/26, c=Math.cos(a),s=Math.sin(a),t=K.V.norm([-size[0]*s,0,size[1]*c]);
    box([size[0]*c,.450,size[1]*s],[.145,.058,.139],i%7===2?clay:glaze,.061,.031,
      {ax:[t,[0,1,0],[t[2],0,-t[0]]]});
    if(i%3===1) box([size[0]*c,.510,size[1]*s],[.053,.018,.054],clay,.046,.023);
  }
  S.rock([.38,.371,-.047],[.57,.425,.447],darkStone,{res:.068});
  S.rock([.34,.616,-.053],[.29,.213,.243],leaf,{res:.066});
  S.rock([.64,.538,-.14],[.191,.139,.199],leaf,{res:.067});
  for(const [x,z,r] of [[-2.99,1.37,.33],[-2.91,1.62,.23],[2.87,1.35,.34],[2.83,-1.44,.24],
    [2.18,-1.85,.30],[-2.57,-1.63,.27],[-2.71,-1.91,.19],[1.86,1.87,.22]]){
    S.rock([x,.125,z],[r,r*.62,r*.82],leaf,{res:.071});
    for(let i=0;i<4;i++){
      const d=(i-1.5)*.064;
      S.tube([[x+d,.18,z],[x+d*1.5,.31+.12*K.hash(i,seed,r*100),z+.07]],.019,.013,leaf,{res:.049});
    }
  }
  for(const x of [-2.90,2.91]){
    box([x,.24,-1.63],[.26,.16,.27],border,.084,.053);
    S.lathe([x,.39,-1.63],.28,[.183,.086],clay,{res:.064});
    S.ball([x,.665,-1.63],[.071,.081,.076],{r:[20,21],em:true},{res:.049,ghost:true});
  }
  S.bake();
  S.implicitForm({
    bounds:{min:[-2.73,.19,-1.79],max:[2.73,.28,1.79]},
    sd:(x,y,z)=>Math.max((oval(x,z)-1)*1.76,.208-y,y-.258)
  },water,{res:.066,cell:.049});
  S.bake();
  const marker=K.frameSplats(B,12,(draw,_dt,t)=>{
    const [x,z]=sourceAt(phase(t));
    draw.point([x,.281,z],{rgb:[.23,.12,.14],width:.129,density:1,depth:true});
    draw.point([x,.324,z],{rgb:[.99,.67,.28],width:.084,density:1,depth:true});
    draw.point([x-.025,.355,z+.006],{rgb:[1,.90,.55],width:.031,density:1,depth:true});
  });
  const world=B.finish({
    cam:{target:[-.02,.20,-.025],dist:8.45,yaw:.13,pitch:.88,ortho:true,sway:0},
    radius:8,detail:28,dither:0,look:{splatCoverage:'continuous'},
    surfaceEffects:{fields:{pigment}}
  });
  K.stage(world).add(marker);
  return world;
}

function censer({ KIT: K, makeBuilder, makeSculpt }, seed, controls) {
  const B=makeBuilder(seed,[
    0x161827,0x20263b,0x2e364c,0x424760,0x5c5970,0x766478,
    0x48333d,0x744b48,0x9d6552,0xc38459,0xe5a36a,0xffd48a,0xffeda7,
    0x372b48,0x563b62,0x8f597a,0xca86a0,0xf1c1b6,
    0x293645,0x395657,0x59736e
  ]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{pixel:true,amb:.34,sky:.19,sunK:.56,shLen:0,sun:K.V.norm([-.63,.73,.39])});
  const stone={r:[1,2,3,4]}, inset={r:[1,2,3]}, brass={r:[6,7,8,9,10]};
  const ember={r:[9,10,11,12],em:true,v:.8}, moss={r:[18,19,20]};
  const box=(at,half,mat,res=.105,rd=.04,extra)=>S.box(at,half,mat,{res,rd,...extra});
  box([0,-.17,.10],[2.82,.226,1.46],stone,.128,.118);
  for(let j=0;j<4;j++) for(let i=-4;i<=4;i++)
    box([i*.6+.15*(j%2),.071,-.97+j*.63],[.289,.047,.295],i%3===0?stone:inset,.104,.049);
  box([0,1.38,-1.22],[2.64,1.38,.21],inset,.139,.091);
  for(let j=0;j<7;j++) for(let i=-4;i<=4;i++)
    box([i*.565+.21*(j%2),.22+j*.369,-1.009],[.27,.176,.095],(i*2+j)%7===2?stone:inset,.100,.035);
  for(const side of [-1,1]){
    const x=side*1.77;
    box([x,.23,-.84],[.25,.19,.18],stone,.084,.056);
    box([x,1.03,-.84],[.135,.67,.176],stone,.090,.054);
    box([x,1.75,-.84],[.222,.086,.20],brass,.079,.040);
    const lamp=side*2.27;
    S.lathe([lamp,.35,-.65],1.09,[.092,.062],brass,{res:.064});
    S.ball([lamp,1.50,-.65],[.121,.144,.114],ember,{res:.051,ghost:true});
    S.lathe([lamp,1.639,-.65],.152,[.192,.036],brass,{res:.060});
    S.rock([side*2.10,.128,.76],[.28,.17,.21],moss,{res:.073});
    S.rock([side*2.41,.131,.57],[.19,.145,.23],moss,{res:.071});
  }
  for(let i=0;i<15;i++){
    const a=(i+.5)*Math.PI/15,c=Math.cos(a),s=Math.sin(a),ax=[[c,s,0],[-s,c,0],[0,0,1]];
    box([1.76*c,1.795+1.29*s,-.843],[.137,.193,.141],i%5===2?brass:stone,.078,.04,{ax});
  }
  box([0,.175,.19],[.75,.10,.52],stone,.086,.055);
  box([0,.307,.19],[.646,.046,.454],brass,.078,.039);
  S.lathe([0,.345,.19],.285,t=>.26+.35*t,brass,{res:.063});
  S.torus([0,.644,.19],.58,.053,brass,{res:.064});
  for(let i=0;i<19;i++){
    const a=i*2.399,r=.05+.42*K.hash(i,seed,7);
    S.ball([r*Math.cos(a),.634+.032*K.hash(i,seed,9),.19+r*Math.sin(a)],[.066,.041,.057],ember,
      {res:.039,ghost:true});
  }
  S.bake();
  function draft(x,y,t) {
    const a=x+.31,b=y-1.43,c=x-.20-.19*Math.sin(t*.72),d=y-2.42;
    const lower=2.2*Math.exp(-(a*a+b*b)*2.5), upper=2.16*Math.exp(-(c*c+d*d)*1.86);
    const jet=(.81+.18*Math.sin(t*1.5))*(2.3*Math.exp(-x*x*1.8)-.88);
    return [.10+.24*Math.sin(y*3.2-t*1.9)-b*lower+d*upper,jet+a*lower-c*upper];
  }
  const flow=sequence(K.procedural.motion,{
    width:72,height:72,cell:.057,origin:[-2.052,.54],pressureIterations:17,diffusionIterations:3,maxDt:.05,
    initial(x,y) {
      return {velocity:draft(x,y,0),density:.31*Math.exp(-(x*x*14+(y-1.04)**2*8))};
    }
  },{
    force(x,y,t,{velocity}) {
      const [a,b]=draft(x,y,t);
      return [1.4*(a-velocity[0]),1.4*(b-velocity[1])];
    },
    source(x,y,t) {
      const a=.22*Math.sin(t*2.2);
      return (5.4+1.42*Math.sin(t*4.5))*Math.exp(-((x-a)**2*38+(y-.76)**2*96));
    },
    viscosity:.000065,diffusion:.00004,dissipation:.29
  });
  let lastTime, localTime, density, opacity;
  const smoke=K.procedural.density.bounded({
    bounds:{min:[-2.05,.65,-.52],max:[2.05,3.63,.95]},
    sample(x,y,z,t) {
      if(t!==lastTime){lastTime=t;localTime=phase(t);density=flow(localTime);opacity=fade(localTime);}
      const center=.225+.20*Math.sin(y*2.42-localTime*.8);
      const width=.28+y*.13;
      const shape=K.clamp((1-Math.abs(z-center)/width)*3.8,0,1)*K.clamp((3.63-y)*2.25,0,1);
      return density(x,y)*shape*opacity;
    }
  });
  const bands={stops:[{at:.032,color:'#655281'},{at:.073,color:'#ad6a98'},
    {at:.145,color:'#db87a6'},{at:.265,color:'#f6c2aa'}],
    ...(controls?.edge!==false && {edge:{width:.024,color:'#efd0d9'}})};
  return B.finish({
    cam:{target:[-.07,1.63,-.015],dist:7.10,yaw:.10,pitch:.21,ortho:true,sway:0},
    radius:8,detail:28,dither:0,look:{splatCoverage:'continuous'},
    atmosphere:[K.atmosphere.field({field:smoke,density:18.5,step:.072,lit:false,color:'#cb8fa6',
      ...(controls?.banded!==false&&{bands})})],
    volumeQuality:{jitter:'off'}
  });
}

module.exports = kit => ({
  id:'banded-pigment',
  name:'The pigment court',
  seed:71,
  build(seed,{controls}={}) {
    return (controls?.study==='smoke' ? censer : basin)(kit,seed,controls);
  }
});
