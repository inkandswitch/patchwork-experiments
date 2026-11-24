const DURATION=6.4, FPS=10, FRAMES=Math.round(DURATION*FPS), TAU=2*Math.PI;
const palette=[0x101827,0x233141,0x3c4e61,0x69838a,0xa8b3a3,
  0x432e3c,0x704b4d,0xa26c53,0xd49b68,0xf6cf96,
  0x142e37,0x215865,0x318c88,0x79c6a1,0xccedd0,
  0x33243f,0x614666,0x98617e,0xc59197,0xefad86,0x589db0,0x397856,0x69bf7a,0xdceda3];
const iron={r:[0,0,1,2]}, steel={r:[1,2,3,4]}, bronze={r:[5,6,7,8,9]};
const jade={r:[10,11,12,13]}, live={r:[12,13,14],em:true}, amber={r:[7,8,9],em:true};
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,f)=>a.map((n,i)=>n+(b[i]-n)*clamp(f));

function studio(K,makeBuilder,makeSculpt,SpriteSurface,seed){
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024),font=K.inspection.font({});
  Object.assign(S,{pixel:true,amb:.35,sky:.15,sunK:.81,sun:K.V.norm([-.58,.73,.37])});
  const box=(p,r,mat,res=.087,rd=.065)=>S.box(p,r,mat,{res,rd});
  function label(text,[x,y,z],span,color){
    const columns=text.length*6,h=span*7/columns,letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],[0,0,-h],columns,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?color:undefined);
  }
  function chart(field,y){
    const {width,height,bounds}=field,region=sprites.reserve(width,height),rgba=new Uint8Array(width*height*4);
    const [x,z]=bounds.min,[hiX,hiZ]=bounds.max;
    sprites.faceRegion([x,y,hiZ],[hiX-x,0,0],[0,0,z-hiZ],region);
    return (write,pixel)=>{
      for(let row=0,i=0;row<height;row++)for(let col=0;col<width;col++,i++){
        const rgb=pixel(col,row,i);
        if(rgb)rgba.set(rgb,4*i);
        rgba[4*i+3]=rgb?255:0;
      }
      write(region,{w:width,h:height,rgba});
    };
  }
  function finish(cam,draw){
    S.bake();
    const atlas=sprites.finish(),write=(id,image)=>SpriteSurface.update(atlas,id,image);
    const world=B.finish({cam,radius:7,detail:23,dither:.051,spriteSurfaces:atlas,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    let shown=-1;
    stage.add({update(_dt,time){
      const t=((time%DURATION)+DURATION)%DURATION,frame=Math.min(FRAMES-1,Math.floor(t*FPS+1e-7));
      if(shown===frame)return;
      draw(write,frame);
      shown=frame;
    }});
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
  return {K,S,box,label,chart,finish};
}

function marks(field,tick,selected){
  const {width,height,bounds}=field,[x,z]=bounds.min,[hiX,hiZ]=bounds.max;
  const out=new Uint8Array(width*height);
  for(let i=0;i<tick.agents.length;i++){
    const agent=tick.agents[i];
    if(!agent.active)continue;
    const paint=selected(agent,i);
    if(!paint)continue;
    const c=Math.min(width-1,Math.floor((agent.at[0]-x)*width/(hiX-x)));
    const r=Math.min(height-1,Math.floor((agent.at[1]-z)*height/(hiZ-z)));
    out[r*width+c]=paint;
  }
  return out;
}

const nutrients=[[-2.87,-.82],[-2.11,1.38],[-.46,-1.58],[.51,.77],[2.57,-.95],[2.74,1.12]];
const stones=[{x:-1.29,z:.25,r:.40},{x:1.64,z:-.08,r:.33}];
const dish=(x,z)=>Math.hypot(x/4.13,z/2.34)<1;
function colony(K,seed){
  const {trailAgents}=K.procedural.motion,cell=.047;
  const width=180,height=104,origin=[-width*cell/2,-height*cell/2];
  const field=K.deposition.grid({width,height,cell,origin,channels:{trail:{diffusion:.76,decay:.047},food:{diffusion:.61,decay:.073}},
    mask:(x,z)=>dish(x,z)&&stones.every(p=>Math.hypot(x-p.x,z-p.z)>p.r)});
  const random=K.grow.dice(seed),agents=[];
  while(agents.length<2990){
    const at=[origin[0]+random()*width*cell,origin[1]+random()*height*cell];
    if(field.contains(...at))agents.push({at,heading:random()*TAU});
  }
  const sim=trailAgents({field,agents,seed,capacity:2,groups:{default:{
    speed:.047,sensorDistance:.327,sensorAngle:.66,turnAngle:.57,jitter:.108,deposit:{trail:1.3},sense:{trail:1,food:.35}
  }},emitters:nutrients.map(at=>({at,radius:.34,values:{food:.67}}))});
  return sim;
}

function atlas(set,seed){
  const {K,S,box,label,chart,finish}=set,run=colony(K,seed),field=run.field,paint=chart(field,.397),frames=[];
  const floor=[9,23,36], gel=[31,78,69], frond=[102,195,124], tip=[224,247,165];
  for(let i=0;i<FRAMES;i++){
    const target=1+Math.min(53,i)*5;
    while(run.tick<target)run.step(Math.min(8,target-run.tick));
    const frame=run.frame();
    frames.push({trail:frame.data('trail'),mask:frame.mask(),dots:marks(field,frame,(_a,j)=>j%13===0?1:0)});
  }
  box([0,-.073,.055],[4.53,.235,2.77],steel,.132,.114);
  box([0,.186,.046],[4.39,.056,2.65],iron,.101,.084);
  const rim=Array.from({length:115},(_,i)=>{
    const a=i*TAU/114;
    return [4.187*Math.cos(a),.384,2.388*Math.sin(a)];
  });
  S.tube(rim,.101,.101,bronze,{res:.076});
  S.tube(rim.map(([x,y,z])=>[x*1.027,y+.054,z*1.038]),.031,.031,jade,{res:.058});
  for(let i=0;i<18;i++){
    const a=i*TAU/18;
    S.ball([4.26*Math.cos(a),.485,2.50*Math.sin(a)],i%3?.036:.060,i%3?steel:live,{res:.042});
  }
  for(const [x,z] of nutrients){
    S.lathe([x,.398,z],.095,[.137,.118,.093],bronze,{res:.054});
    S.ball([x,.477,z],.053,amber,{res:.041});
  }
  for(const {x,z,r} of stones)S.rock([x,.43,z],[r,.221,r],steel,{res:.065});
  box([0,.344,2.502],[1.44,.083,.194],iron);
  label('MYCELIUM ATLAS',[0,.496,2.687],2.17,0xffdda6);
  function draw(write,k){
    const {trail,mask,dots}=frames[k];
    paint(write,(x,z,i)=>{
      if(!mask[i])return null;
      const v=trail[i],strength=clamp((v-.11)*.135),fine=clamp((v-.54)*.21);
      const shift=(x*19+z*31)%27===0?.019:0;
      const pigment=mix(floor,gel,shift+.10+.82*strength);
      return dots[i]?mix(tip,frond,.43):mix(pigment,v>6.9?tip:frond,.71*fine);
    });
  }
  return finish({target:[0,.24,.25],dist:13.28,fov:.555,yaw:-.135,pitch:1.03,sway:0},draw);
}

const cut={min:[-.36,-.57],max:[.36,.57]};
function route(x,z){
  const f=clamp((x+3.5)/7),bypass=-1.63*Math.sin(Math.PI*f)**2;
  const branch=clamp((-z-.14)/1.4);
  const connector=z<.09&&z> -1.60&&Math.abs(Math.abs(x)-(.55+.64*branch))<.286;
  return Math.hypot(x+3.43,z-.05)<.66||Math.hypot(x-3.43,z-.05)<.66||
    Math.abs(x)<3.43&&(Math.abs(z-.01)<.40||Math.abs(z-bypass)<.365||connector);
}
function traffic(K,seed){
  const width=164,height=90,cell=.051,origin=[-width*cell/2,-height*cell/2];
  const field=K.deposition.grid({width,height,cell,origin,mask:route,
    channels:{warm:{diffusion:.69,decay:.027},cool:{diffusion:.69,decay:.027},guide:{}}});
  const random=K.grow.dice(seed),agents=[];
  for(let i=0;i<850;i++){
    const side=i%2;
    agents.push({at:[-3.63+7.26*random(),-.287+.574*random()],
      heading:(side?0:Math.PI)+(random()-.5)*.37,group:side?'warm':'cool'});
  }
  const groups=Object.fromEntries(['warm','cool'].map((name,i)=>[name,{
    speed:.059,sensorDistance:.262,sensorAngle:.75,turnAngle:.73,jitter:.51,
    sense:{[name]:.56,[i?'warm':'cool']:.22,guide:i?-1:1},deposit:{[name]:1.34}
  }]));
  return K.procedural.motion.trailAgents({field,agents,seed,capacity:3,groups});
}

function closeRoute(K,field){
  field.edit({bounds:cut,blocked:true});
  const {width,height,bounds}=field;
  const guide=K.procedural.fields.potential({
    width,height,origin:bounds.min,cell:(bounds.max[0]-bounds.min[0])/width,
    mask:(x,z)=>field.contains(x,z)
  }).solve({pins:[{at:[-3.50,.05],radius:.275,value:0},{at:[3.50,.05],radius:.275,value:300}]});
  const values=guide.data();
  field.edit({values:(_x,_z,i)=>({guide:Math.max(0,values[i])})});
}

function circuit(set,seed){
  const {K,S,box,label,chart,finish}=set,run=traffic(K,seed),field=run.field,paint=chart(field,.395);
  const baseMask=field.frame().mask(),frames=[];
  for(let i=0;i<FRAMES;i++){
    if(i===17)closeRoute(K,field);
    const target=i<17?28+i*3:76+Math.min(i-17,41)*4;
    while(run.tick<target)run.step(Math.min(12,target-run.tick));
    const f=run.frame();
    frames.push({warm:f.data('warm'),cool:f.data('cool'),mask:f.mask(),
      dots:marks(field,f,(a,j)=>j%6===0?a.group==='warm'?1:2:0)});
  }
  box([0,-.057,.03],[4.52,.224,2.64],steel,.128,.106);
  box([0,.190,.024],[4.38,.066,2.49],iron,.098,.088);
  for(const sign of [-1,1]){
    box([0,.36,sign*2.365],[4.28,.084,.091],steel);
    box([sign*4.296,.365,0],[.082,.089,2.35],jade);
    for(let j=0;j<15;j++)box([-3.98+j*.566,.469,sign*2.373],[.027,.021,.037],j%4?steel:bronze,.034,.029);
  }
  for(const sign of [-1,1]){
    const x=sign*3.46,light=sign>0?amber:live;
    S.lathe([x,.423,.099],.090,[.212,.202,.145],sign>0?bronze:jade,{res:.058});
    S.ball([x,.516,.099],.086,light,{res:.044});
  }
  box([0,.371,2.493],[1.47,.082,.168],iron,.078);
  label('DETOUR CIRCUIT',[0,.519,2.620],2.28,0xffdda8);
  function draw(write,k){
    const frame=frames[k];
    paint(write,(c,r,i)=>{
      if(baseMask[i]&&!frame.mask[i])return (c+r*2)%7<3?[212,124,73]:[101,49,62];
      if(!baseMask[i]){
        const guide=c%13===0||r%11===0;
        return guide?[24,34,53]:[15,24,40];
      }
      const a=frame.warm[i],b=frame.cool[i],lit=a+b;
      const base=(c+r*3)%19===0?[54,58,82]:[41,48,70];
      const heat=mix([93,213,214],[251,148,78],a/Math.max(.0001,lit));
      if(frame.dots[i])return frame.dots[i]===1?[255,222,151]:[170,254,230];
      return mix(mix(base,[76,84,108],clamp(lit*.11)),heat,clamp((lit-.26)*.118));
    });
  }
  return finish({target:[0,.25,.16],dist:13.15,fov:.563,yaw:-.125,pitch:1.04,sway:0},draw);
}

module.exports=({KIT:K,makeBuilder,makeSculpt,SpriteSurface})=>({
  id:'trail-sensing-studies',name:'Mycelium Atlas and Detour Circuit',seed:68,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'atlas';
    if(!['atlas','detour'].includes(study))throw new RangeError('Choose atlas or detour');
    const set=studio(K,makeBuilder,makeSculpt,SpriteSurface,seed);
    return study==='atlas'?atlas(set,seed):circuit(set,seed);
  }
});
