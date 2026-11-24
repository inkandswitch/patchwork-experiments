const DURATION=6.4,FPS=10,TAU=2*Math.PI;
const palette=[
  0x111726,0x252e42,0x3c4d61,0x657d8c,0x9ba9ac,
  0x342b3e,0x583e48,0x885449,0xb77b58,0xe6b783,0xffe5ae,
  0x163a49,0x215666,0x367986,0x58a5a7,0x88c8c0,0xb8e6d8,
  0x162237,0x1b304b,0x254864,0x386783,0x5290a3,0x70afbb,0x9bd0d6,0xd2f4e8,0xecfff6,
  0x48354c,0x633d5a,0x85566c,0xa2738a,0xc897a2,0xebc6c1,
  0x63383a,0x85463e,0xa45c4a,0xc58361,0xda9d77,0xefba8a,
  0x594641,0x856855,0xa6876b,0xbe9e7c,0xd4b590,0xe5c8a0,0xf1d6ac,0xf9e4bd,0xffefd0
];
const iron={r:[0,0,1,2]},steel={r:[1,2,3,4]},copper={r:[5,6,7,8,9]};
const jade={r:[11,12,13,14]},frostLamp={r:[13,14,15,16],em:true},lamp={r:[8,9,10],em:true};
const clamp=v=>Math.max(0,Math.min(1,v)),mix=(a,b,f)=>a+(b-a)*f, wave=a=>.5+.5*Math.cos(a);
const rgb=(a,b,f)=>a.map((n,i)=>clamp(mix(n,b[i],f)/255));

function studio({KIT:K,makeBuilder,makeSculpt,SpriteSurface,TexturedSurface},seed){
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024);
  const font=K.inspection.font({});
  Object.assign(S,{pixel:true,amb:.34,sky:.18,sunK:.85,sun:K.V.norm([-.44,.81,.39])});
  const box=(p,half,mat,res=.092)=>S.box(p,half,mat,{res,rd:res*.82});
  function label(text,[x,y,z],span,upright){
    const cols=text.length*6,h=7*span/cols,letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],upright?[0,h,0]:[0,0,-h],cols,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?0xffdda1:undefined);
  }

  function exhibit(sim,{cam,mount,normal,drive,warm,particle,overlay}){
    const {min,max}=sim.bounds,w=max[0]-min[0],h=max[1]-min[1],sizes=[58,36];
    const place=(u,v)=>[min[0]+u*w,max[1]-v*h],vertexAt=[];
    const patch=TexturedSurface.grid({segments:sizes,point(u,v){
      const at=place(u,v);
      vertexAt.push(at);
      return mount(...at,0);
    }});
    const cols=260,rows=160,region=sprites.reserve(cols,rows),pixels=new Uint8Array(cols*rows*4);
    const sites=Array.from({length:cols*rows},(_,i)=>place((i%cols+.5)/cols,(Math.floor(i/cols)+.5)/rows));
    const heights=new Float64Array(sites.length),rough=new Float64Array(sites.length);
    sprites.meshRegion(patch,region);
    // Add static lettering after the patch so its vertices sit outside the dirty range.
    overlay();
    const frames=[sim.frame()];
    function seek(tick){
      while(frames.length<=tick)frames.push(sim.step(1,{drive}));
      return frames[tick];
    }
    const phase=t=>Math.min(DURATION*FPS-1,Math.floor((((t%DURATION)+DURATION)%DURATION)*FPS+1e-7));
    const tickFor=index=>warm+Math.round(index/(FPS*sim.dt));
    const particles=K.frameSplats(B,960,(draw,_dt,time)=>{
      const tick=tickFor(phase(time)),state=seek(tick);
      for(let j=Math.max(1,tick-20);j<=tick;j++)for(const event of frames[j].events){
        if(K.hash(event.id,seed,305)>.42)continue;
        const [x,z]=event.at;
        const age=state.time-event.time, life=.43+.53*K.hash(event.id,seed,81);
        if(age>=life)continue;
        const angle=TAU*K.hash(event.id,seed,23),speed=.12+.43*K.hash(event.id,seed,65);
        const rise=(state.sample('relief',x,z)??0)+.049+age*(.34-age*.19);
        const p=mount(x+speed*age*Math.cos(angle),z+speed*age*Math.sin(angle)+age*.14,rise);
        draw.point(p,{depth:true,density:1.55*(1-age/life),rgb:particle,width:.017+.027*K.hash(event.id,seed,96)});
      }
    });
    S.bake();
    const atlas=sprites.finish(),world=B.finish({cam,spriteSurfaces:atlas,radius:8,detail:22,dither:.045,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const reliefs=new Float32Array(vertexAt.length),stage=K.stage(world);
    let last=-1;
    stage.add({update(_dt,time){
      const index=phase(time);
      if(index===last)return;
      const frame=seek(tickFor(index));
      for(let i=0;i<vertexAt.length;i++)reliefs[i]=frame.sample('relief',...vertexAt[i])??0;
      for(let i=0;i<patch.triangles.length;i++){
        const j=patch.triangles[i];
        atlas.vertices[5*i+normal]=patch.points[3*j+normal]+reliefs[j];
      }
      SpriteSurface.markGeometryDirty(atlas,{first:0,count:patch.triangles.length});
      for(let i=0;i<sites.length;i++){
        const at=sites[i],p=i*4,color=frame.sample('color',...at);
        pixels[p+3]=color?255:0;
        if(!color){heights[i]=0;continue;}
        heights[i]=frame.sample('relief',...at);
        rough[i]=frame.sample('roughness',...at);
        for(let c=0;c<3;c++)pixels[p+c]=color[c]*255;
      }
      for(let y=0,i=0;y<rows;y++)for(let x=0;x<cols;x++,i++){
        const p=i*4;
        if(!pixels[p+3])continue;
        const gx=(heights[i+Number(x+1<cols)]-heights[i-Number(x>0)])*cols/(2*w);
        const gz=(heights[i-cols*Number(y>0)]-heights[i+cols*Number(y+1<rows)])*rows/(2*h);
        const light=(.89+.37*gx-.26*gz)/Math.hypot(1,gx,gz);
        const gloss=(1-rough[i])*.15*clamp(.5+2.6*(light-.89))**3;
        for(let c=0;c<3;c++)pixels[p+c]=clamp(pixels[p+c]*mix(.78,1.26,clamp(light-.34))/255+gloss)*255;
      }
      SpriteSurface.update(atlas,region,{w:cols,h:rows,rgba:pixels});
      last=index;
    }});
    stage.add(particles);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
  return {K,S,box,label,exhibit};
}

function frost({K,S,box,label,exhibit},seed){
  const cols=110,rows=66,cell=.077,w=cols*cell,h=rows*cell,base=.66;
  const seedSites=[[-2.83,.48,1.72,.25,.06],[-.21,-.48,1.89,.04,.62],[2.59,.55,1.64,.51,1.22]];
  const segments=[];
  for(const [x,z,r,offset] of seedSites)for(let j=0;j<6;j++){
    const a=offset+j*TAU/6,d=[Math.cos(a),Math.sin(a)],length=r*(.80+.31*K.hash(j,x,seed));
    segments.push([x,z,d[0],d[1],length,1]);
    for(let k=1;k<=5;k++)for(const s of [-1,1]){
      const reach=length*k/6.4,ox=x+reach*d[0],oz=z+reach*d[1],branch=a+s*(.86+.16*K.hash(j,k,seed)),
        u=Math.cos(branch),v=Math.sin(branch),span=(.13+.51*(1-k/6.4))*(.61+.56*K.hash(j,k*s,x));
      segments.push([ox,oz,u,v,span,.66]);
      if(k<4){
        const c=branch-s*.74;
        segments.push([ox+span*u*.49,oz+span*v*.49,Math.cos(c),Math.sin(c),span*.49,.46]);
      }
    }
  }
  function pattern(x,z){
    let spine=0;
    for(const [ox,oz,u,v,span,gain] of segments){
      const dx=x-ox,dz=z-oz,t=Math.max(0,Math.min(span,dx*u+dz*v));
      spine=Math.max(spine,gain*Math.exp(-340*((dx-t*u)**2+(dz-t*v)**2)));
    }
    const grain=wave(19*x+24*z+2*Math.sin(9*x-7*z))*.62+.38*wave(31*z-27*x);
    const arrival=Math.min(...seedSites.map(([a,b,_r,_ang,delay])=>delay+Math.hypot(x-a,(z-b)*1.1)/.65));
    return {spine,grain,arrival};
  }
  const features=[];
  const mask=(x,z)=>Math.hypot(Math.max(0,Math.abs(x)-3.92),Math.max(0,Math.abs(z)-2.19))<.31;
  const sim=K.procedural.motion.phaseChange({width:cols,height:rows,cell,origin:[-w/2,-h/2],mask,
    channels:{liquid:{diffusion:.00035},ice:{},chill:{diffusion:.043}},
    initial(x,z,i){
      const f=features[i]=pattern(x,z);
      return {liquid:.024+.060*f.grain+.78*f.spine};
    },
    rules:[
      {id:'freeze',consume:{liquid:1,chill:.16},produce:{ice:1},emitEvery:.275,
        rate:({fields,nearby,inputs})=>Math.max(0,fields.chill-.20+.19*nearby.ice)*fields.liquid*(2.9+1.8*inputs.spine)}
    ],
    finish({fields,nearby,cell}){
      const {spine,grain}=features[cell],solid=clamp(fields.ice*1.42),rim=clamp((fields.ice-nearby.ice)*3.35);
      const wet=[15+11*grain,27+24*grain,46+32*grain];
      const ice=[86+150*rim+32*grain,160+84*rim+36*grain,183+67*rim+45*grain];
      const shade=clamp(solid*.78+Math.sqrt(solid)*.22);
      return {color:rgb(wet,ice,shade),roughness:clamp(.13+.73*solid+.05*grain),
        relief:.117*solid*(.38+.49*spine+.13*grain)+.034*rim};
    }
  });
  const drive=({cell,time,fields})=>{
    const {arrival,spine}=features[cell], cooling=clamp((time-arrival+.27)*2.4);
    return {inputs:{spine},sources:{chill:2.5*cooling*(.93-fields.chill)-.09*fields.chill}};
  };
  box([0,3.19,-.33],[4.66,3.02,.32],steel,.104);
  box([0,3.19,.018],[4.48,2.86,.11],iron,.086);
  box([0,3.19,.145],[4.30,2.55,.052],iron,.073);
  for(const x of [-4.30,4.30]){
    box([x,3.21,.217],[.064,2.58,.080],jade,.061);
    for(let j=0;j<12;j++)box([x,1.02+j*.40,.323],[.031,.025,.018],j%4?copper:frostLamp,.039);
  }
  for(const y of [.63,5.77])box([0,y,.232],[4.35,.043,.076],copper,.059);
  for(const [x,z] of seedSites){
    const y=base+h/2+z;
    S.tube(K.curve.circle([x,y,.374],.111,18,[0,0,1]),.031,.026,steel,{res:.043});
    S.ball([x,y,.422],.039,frostLamp,{res:.036});
  }
  box([0,.412,.229],[1.82,.127,.045],iron,.062);
  return exhibit(sim,{drive,warm:6,normal:2,overlay:()=>label('FROST CIRCUIT',[0,.268,.384],2.65,true),mount:(x,z,relief)=>[x,base+h/2+z,.309+relief],
    particle:[.81,.99,1],cam:{target:[0,3.16,0],dist:12.71,fov:.553,yaw:-.108,pitch:.105,sway:0}});
}

function drying({K,S,box,label,exhibit}){
  const cols=108,rows=66,cell=.076,w=cols*cell,h=rows*cell;
  const features=[];
  function spot(x,z,cx,cz,sx,sz){
    const u=(x-cx)/sx,v=(z-cz)/sz,a=Math.atan2(v,u);
    const r=Math.hypot(u,v)+.057*Math.sin(4*a+.3)+.036*Math.cos(7*a-.4);
    return {r,a};
  }
  const mask=(x,z)=>Math.hypot(Math.max(0,Math.abs(x)-3.80),Math.max(0,Math.abs(z)-2.20))<.29;
  const sim=K.procedural.motion.phaseChange({width:cols,height:rows,cell,origin:[-w/2,-h/2],mask,
    channels:{water:{diffusion:.00038},vapor:{diffusion:.006,capacity:1.5},solute:{diffusion:.00026},crystal:{}},
    initial(x,z,i){
      const a=spot(x,z,-1.58,.18,1.66,1.56),b=spot(x,z,1.95,-.24,1.30,1.13),left=a.r<b.r;
      const {r,a:angle}=left?a:b, film=clamp((1.11-r)*8.2);
      const edge=Math.exp(-((r-.91)**2)*51), grain=wave(39*x+25*z+2*Math.cos(12*x))*wave(31*z-21*x);
      features[i]={r,left,edge,grain};
      return {water:film*(.74+.23*clamp(1-r)+.022*Math.cos(15*angle)),
        solute:film*(.026+.42*edge*(.63+.26*Math.cos(5*angle+.27)+.17*grain))};
    },
    rules:[
      {id:'evaporate',consume:{water:1},produce:{vapor:1},
        rate:({fields,nearby,inputs})=>fields.water*(.27+.83*inputs.drying+.26*fields.crystal)+
          .27*clamp((fields.water-nearby.water)*4)*inputs.drying},
      {id:'crystallize',consume:{solute:1},produce:{crystal:1},emitEvery:.17,
        rate:({fields,nearby,inputs})=>Math.max(0,fields.solute-fields.water*.68-.022)*
          (.65+1.8*inputs.rim+1.4*nearby.crystal)}
    ],
    finish({fields,nearby,cell,at:[x,z]}){
      const {left,grain,edge}=features[cell],water=fields.water,s=fields.solute,crystal=fields.crystal;
      const spec=clamp(water*1.42),rim=clamp(crystal*2.8),patina=.49*wave(x*7.5+z*9.9)+grain*.51;
      const bed=[224+14*patina,198+17*patina,153+21*patina];
      const dye=left?[108,64,100]:[148,73,52], salt=left?[97,53,78]:[143,59,43];
      const liquid=bed.map((c,i)=>mix(c,dye[i],clamp(water*.62+s*.81)));
      const facets=clamp(.46*grain+.63*Math.max(0,crystal-nearby.crystal));
      const crust=salt.map((v,c)=>mix(v,[246,216,158][c],facets));
      return {color:rgb(liquid,crust,rim),roughness:clamp(.57-.49*spec+.37*rim+.05*grain),
        relief:.053*water*water+.207*crystal*(.49+.51*grain)+.029*edge*rim};
    }
  });
  const drive=({cell,at:[x,z],time})=>{
    const {edge,r}=features[cell], breeze=clamp(.37+.22*x-.17*z+.19*Math.sin(time*1.63));
    return {inputs:{rim:edge,drying:.18+.47*edge+.26*breeze+.15*clamp(r)}};
  };
  box([0,.016,.09],[4.71,.251,2.94],steel,.13);
  box([0,.257,.02],[4.47,.091,2.71],iron,.092);
  box([0,.31,0],[4.17,.045,2.56],{r:[39,40,41,42]},.085);
  for(const s of [-1,1]){
    box([0,.429,s*2.59],[4.22,.065,.081],copper,.069);
    box([s*4.18,.430,0],[.082,.066,2.62],{r:[39,40,41,42,43]},.067);
    for(let j=0;j<11;j++)box([s*4.37,.453,-2.25+.45*j],[.067,.020,.050],j%5?jade:lamp,.043);
  }
  for(const x of [-4.08,4.08])for(const z of [-2.51,2.51]){
    S.lathe([x,.488,z],.066,[.120,.113,.09],copper,{res:.059});
    S.ball([x,.576,z],[.041,.024,.041],lamp,{res:.039});
  }
  box([0,.416,2.72],[1.98,.088,.166],iron,.061);
  return exhibit(sim,{drive,warm:6,normal:1,overlay:()=>label('EVAPORATION PLATE',[0,.58,2.88],3.33,false),mount:(x,z,relief)=>[x,.460+relief,z],particle:[1,.76,.46],
    cam:{target:[0,.23,.08],dist:13.75,fov:.552,yaw:.15,pitch:1.07,sway:0}});
}

module.exports=kit=>({
  id:'phase-change-studies',name:'Frost Circuit and Evaporation Plate',seed:29,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'frost';
    if(study!=='frost'&&study!=='drying')throw new RangeError('Choose frost or drying');
    const set=studio(kit,seed);
    return study==='frost'?frost(set,seed):drying(set);
  }
});
