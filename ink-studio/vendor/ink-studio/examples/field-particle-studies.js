const DURATION = 6.4, FPS = 10;
const palette = [0x121a29,0x242c3d,0x394b59,0x617886,0x9ba4a2,
  0x382c3b,0x634347,0x96664f,0xc18c60,0xf2ca90,0xffedbc,
  0x153839,0x225854,0x387a72,0x6ba79a,0xaad9b9,
  0x17283d,0x1d3548,0x224960,0x28607a,0x427a92,0x70a4ad,0xb8d2d0,
  0x492e47,0x66344f,0x924361,0xb75271,0xdb718a,0xf0a0a6,0xfacbc2,
  0x3b2b2c,0x572f2c,0x783b35,0xa35448,0xc4735b,0xe39573,0xf6b98f,
  0x31344e,0x424667,0x575a82,0x6f7399,0x949bb7,0xb9bdcd,
  0x503941,0x78564c,0xa0816b,0xb89c7d,0xcab18c,0xdcc49c,0xe7d3ac,0xf5e1b9,0xffedd0,
  0x35544b,0x487664,0x6d9f81,0xa2cbb0,0xd1e8d1];
const iron = { r:[0,0,1,2] }, steel = { r:[1,2,3,4] };
const copper = { r:[5,6,7,8,9] }, jade = { r:[11,12,13,14,15] }, lamp = { r:[8,9,10],em:true };
const clamp = n => Math.max(0,Math.min(1,n));
const mix = (a,b,t) => a+(b-a)*t;
const wave = n => .5+.5*Math.cos(n);
const TAU = 2*Math.PI;

function studio(kit,seed) {
  const { KIT:K,makeBuilder,makeSculpt,SpriteSurface } = kit;
  const B = makeBuilder(seed,palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S,{pixel:true,amb:.34,sky:.17,sunK:.85,sun:K.V.norm([-.52,.81,.35])});
  const box = (p,half,mat,res=.10) => S.box(p,half,mat,{res,rd:res*.81});
  function label(text,[x,y,z],span,upright) {
    const columns = text.length*6, h = 7*span/columns, letters = [...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],upright?[0,h,0]:[0,0,-h],columns,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?0xffdfaa:undefined);
  }

  function display(sim,{ at,upright,cam,emit,inputs,style,pigments,warm = 0 }) {
    const width=264,height=164,rgba=new Uint8Array(width*height*4);
    const {min,max} = sim.bounds,w = max[0]-min[0],h = max[1]-min[1];
    const region = sprites.reserve(width,height), pixels = [];
    sprites.faceRegion(at,[w,0,0],upright?[0,h,0]:[0,0,h],region);
    for(let row=0,i=0;row<height;row++)for(let col=0;col<width;col++,i++){
      const x=min[0]+(col+.5)*w/width,z=max[1]-(row+.5)*h/height;
      pixels.push({x,z,bed:style.bed(x,z,K.hash(col+13,row,seed))});
    }
    const frames=[sim.frame()];
    function read(tick){
      while(frames.length<=tick){
        const next=frames.length-1;
        sim.spawn(emit(next,next*sim.dt));
        frames.push(sim.step(1,inputs));
      }
      return frames[tick];
    }
    function paint(field) {
      const samples=new Float64Array(pigments.length);
      for(let i=0;i<pixels.length;i++){
        const {x,z,bed}=pixels[i], p=4*i, density=field.sample('density',x,z);
        if(density===null){rgba[p+3]=0;continue;}
        for(let j=0;j<pigments.length;j++)samples[j]=field.sample(pigments[j][0],x,z);
        rgba.set(style.ink(bed,samples,density,x,z),p);
        rgba[p+3]=255;
      }
      for(const p of field.particles){
        if(p.id%9!==0||p.age>.52)continue;
        const col=Math.floor((p.at[0]-min[0])*width/w),row=Math.floor((max[1]-p.at[1])*height/h);
        if(col<0||col>=width||row<0||row>=height)continue;
        const index=(row*width+col)*4, pick=pigments.find(([name])=>p.dyes[name]>0);
        if(!pick||!rgba[index+3])continue;
        for(let c=0;c<3;c++)rgba[index+c]=mix(rgba[index+c],pick[1][c],.56);
      }
      SpriteSurface.update(atlas,region,{w:width,h:height,rgba});
    }

    S.bake();
    const atlas=sprites.finish(),world=B.finish({cam,spriteSurfaces:atlas,radius:8,detail:24,dither:.04,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    let last=-1;
    stage.add({update(_dt,time){
      const t=((time%DURATION)+DURATION)%DURATION,k=Math.min(DURATION*FPS-1,Math.floor(t*FPS+1e-7));
      if(k===last)return;
      paint(read(warm+Math.round(k/(FPS*sim.dt))));
      last=k;
    }});
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
  return {K,S,box,label,display};
}

function marbling({K,S,box,label,display},seed,feedback) {
  const width=106,height=66,cell=.077,w=width*cell,h=height*cell,dt=.05;
  const pigments=[['coral',[237,128,159]],['opal',[255,225,178]],['verdigris',[137,221,180]]];
  const inside=(x,z)=>Math.hypot(Math.max(0,Math.abs(x)-3.56),Math.max(0,Math.abs(z)-2.05))<.45;
  function current(x,z,t){
    const ax=x+.96-.16*Math.sin(t*.8),az=z+.21, bx=x-1.36,bz=z-.37+.19*Math.sin(t);
    const a=3.36*Math.exp(-.57*(ax*ax+az*az)),b=-3.07*Math.exp(-.71*(bx*bx+bz*bz));
    return [-az*a-bz*b+.18*Math.sin(z*1.8+t*.9),ax*a+bx*b];
  }
  const sim=K.procedural.motion.coupledFluid({width,height,cell,dt,origin:[-w/2,-h/2],mask:inside,feedback,
    drag:5.4,release:2.5,maxSpeed:5,pressureIterations:19,diffusionIterations:3,
    dyes:{coral:{diffusion:.00013,dissipation:.042},opal:{diffusion:.00007,dissipation:.058},
      verdigris:{diffusion:.00011,dissipation:.04}},
    initial:(x,z)=>({velocity:current(x,z,0)})});
  function emit(tick,t){
    const nozzles = [
      {p:[-2.45+.16*Math.sin(1.2*t),-.58+.37*Math.cos(t*.93)],v:[1.58,.88],name:'coral',offset:0},
      {p:[2.42-.23*Math.cos(t*.98),.76+.36*Math.sin(1.4*t)],v:[-1.48,-1.25],name:'opal',offset:1},
      {p:[.12+.50*Math.sin(t*.75),-1.38+.28*Math.cos(1.6*t)],v:[.53,1.56],name:'verdigris',offset:0}
    ], drops=[];
    for(const {p,v,name,offset} of nozzles){
      if(tick%2!==offset || t>5.4)continue;
      for(let i=0;i<10;i++){
        const r=K.hash(i,tick,seed+offset), q=K.hash(i+19,tick+71,seed), d=(i-4.5)*.037;
        drops.push({at:[p[0]+d+.036*(r-.5),p[1]+.11*(q-.5)],velocity:[v[0]+.86*(q-.5),v[1]+.82*(r-.5)],
          mass:.0024+.0016*r,density:.0011,dyes:{[name]:.0064*(.47+.88*r)},lifetime:2.55});
      }
    }
    return drops;
  }
  const inputs={viscosity:.00012,diffusion:.00024,dissipation:.14,force(x,z,t,{velocity}){
    const a=current(x,z,t);
    return [.72*(a[0]-velocity[0]),.72*(a[1]-velocity[1])];
  }};
  box([0,-.02,.13],[4.63,.24,3.02],steel,.128);
  box([0,.206,.08],[4.42,.098,2.80],iron,.084);
  const side=2.64;
  for(const sign of [-1,1]){
    box([0,.373,sign*side],[4.23,.075,.108],jade,.068);
    box([0,.457,sign*side],[4.19,.019,.029],copper,.043);
    box([sign*4.20,.371,0],[.104,.081,side],jade,.072);
    for(let j=0;j<10;j++)box([sign*4.30,.465,-2.29+.50*j],[.037,.032,.041],j%3?copper:lamp,.043);
  }
  for(const x of [-3.96,3.96])for(const z of [-2.57,2.57]){
    S.lathe([x,.461,z],.07,[.140,.120,.10],copper,{res:.063});
    S.ball([x,.546,z],[.048,.035,.048],lamp,{res:.041});
  }
  box([0,.359,2.84],[1.90,.094,.183],iron,.062);
  label('MARBLING BATH',[0,.479,2.99],2.62,false);
  const style={
    bed(x,z,noise){
      const n=5*wave(x*6.6+z*18)+4*wave(z*7.6-3*x)+5*noise;
      return [16+n*.39,28+n*.57,43+n*.66];
    },
    ink(bed,values,density,x,z){
      const total=values[0]+values[1]+values[2];
      if(total<.001)return bed;
      const phase=Math.log1p(total*7);
      const strength=(1-Math.exp(-5.2*total))*(.74+.26*wave(phase*21));
      const gloss=.37*wave(phase*28+Math.sin(x*2+z*2.9))**10;
      return bed.map((v,c)=>{
        const hue=values.reduce((sum,a,i)=>sum+a*pigments[i][1][c],0)/total;
        const tint=mix(hue*.65,hue,clamp(.67+.78*density));
        return clamp(mix(v,mix(tint,[255,239,202][c],gloss),clamp(strength+gloss*.28))/255)*255;
      });
    }
  };
  return display(sim,{at:[-w/2,.434,-h/2],cam:{target:[0,.23,.12],dist:13.37,fov:.55,yaw:.10,pitch:1.13,sway:0},
    emit,inputs,style,pigments,warm:13});
}

function stain({K,S,box,label,display},seed,feedback) {
  const width=104,height=64,cell=.078,w=width*cell,h=height*cell,dt=.05,base=.72;
  const pigments=[['madder',[110,41,53]],['indigo',[36,53,93]],['ochre',[135,79,38]]];
  const holes=[[-.83,.77,.51],[1.48,-.46,.65],[-1.75,-1.32,.48]];
  const mask=(x,z)=>Math.abs(x)<3.95+.023*Math.sin(43*z)&&Math.abs(z)<2.43+.028*Math.cos(27*x)&&
    holes.every(([a,b,r])=>Math.hypot(Math.max(0,Math.abs(x-a)-r),z-b)>.11);
  const sim=K.procedural.motion.coupledFluid({width,height,cell,dt,origin:[-w/2,-h/2],mask,feedback,
    drag:5,windDrag:2.3,release:2.05,maxSpeed:4,pressureIterations:18,diffusionIterations:4,
    dyes:Object.fromEntries(pigments.map(([n])=>[n,{diffusion:.0024,dissipation:.009}]))});
  const taps=[[-2.47,1.72,'madder',0],[-.57,1.63,'indigo',.42],[2.08,1.52,'ochre',.72]];
  function emit(tick,t){
    if(tick%2!==0)return [];
    const drops=[];
    for(let k=0;k<taps.length;k++){
      const [ox,oz,name,start]=taps[k];
      if(t<start||t>start+2.1)continue;
      for(let i=0;i<11;i++){
        const a=K.hash(tick,i,seed+k),b=K.hash(tick,i+42,seed+k),r=.08+.12*b,angle=TAU*a;
        const x=ox+r*Math.cos(angle)+.21*Math.sin(t*1.8+k),z=oz+r*Math.sin(angle)-.16*t;
        if(!mask(x,z))continue;
        drops.push({at:[x,z],velocity:[.48*Math.cos(angle),-.62-.53*b],mass:.0027+.0014*a,
          density:.0013,dyes:{[name]:.0071*(.58+.75*a)},lifetime:3.4});
      }
    }
    return drops;
  }
  const inputs={viscosity:.00029,diffusion:.009,dissipation:.13,
    wind:(x,z,t)=>[.54*Math.sin(2.4*z+1.37*t)+.23*Math.sin(x*3.2-z*4.9),-.84+.30*Math.cos(x*3.8+z*2.4+t*.8)],
    force:(x,z,t)=>[.43*Math.sin(1.8*z+x*1.5+t*.62),-.31+.22*Math.sin(x*2.9-z*.8)]};
  box([0,3.15,-.25],[4.59,2.98,.30],steel,.113);
  box([0,3.16,.066],[4.38,2.83,.096],iron,.088);
  box([0,3.22,.155],[4.12,2.56,.056],iron,.071);
  for(const x of [-4.15,4.15]){
    box([x,3.21,.242],[.045,2.54,.070],copper,.056);
    for(const y of [.73,5.71])S.ball([x,y,.305],.078,lamp,{res:.054});
  }
  for(const [x,z,r] of holes)box([x,base+h/2+z,.200],[r+.072,.092,.026],{r:[0,1,2]},.043);
  box([0,5.69,.235],[4.16,.042,.078],copper,.061);
  for(const [x] of taps){
    box([x,5.65,.30],[.24,.095,.059],steel,.057);
    S.ball([x,5.63,.393],.046,jade,{res:.049});
  }
  box([0,.405,.23],[1.82,.135,.054],iron,.069);
  label('CAPILLARY PROOF',[0,.284,.31],2.94,true);
  const style={
    bed(x,z,noise){
      const n=6*(noise-.5)+3*Math.sin(z*61+x*9)+5*Math.cos(x*4.7+z*3.1)+4*Math.sin(x*19);
      return [237+n,218+n,177+n];
    },
    ink(bed,values,density,x,z){
      const total=values[0]+values[1]+values[2];
      if(total<.0001)return bed;
      const absorb=1-Math.exp(-total*(3.1+.55*Math.sin(x*38+z*19)));
      const edge=clamp(1-Math.abs(total-.072)/.038);
      return bed.map((v,c)=>{
        const ink=values.reduce((sum,a,i)=>sum+a*pigments[i][1][c],0)/total;
        const wick=clamp(absorb+.11*edge+.09*clamp(density*2));
        return mix(v,ink*.82,wick);
      });
    }
  };
  return display(sim,{at:[-w/2,base,.275],upright:true,emit,inputs,style,pigments,warm:8,
    cam:{target:[0,3.15,-.05],dist:12.40,fov:.555,yaw:-.10,pitch:.061,sway:0}});
}

module.exports=kit=>({
  id:'field-particle-studies',name:'Marbling Bath and Capillary Proof',seed:28,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'marbling',feedback=controls?.feedback===false?0:1;
    if(study!=='marbling'&&study!=='stain')throw new RangeError('Choose marbling or stain');
    return (study==='marbling'?marbling:stain)(studio(kit,seed),seed,feedback);
  }
});
