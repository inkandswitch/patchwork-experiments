const FRAMES=64,FPS=10,DURATION=FRAMES/FPS,TAU=2*Math.PI;
const palette=[
  0x111826,0x202a3d,0x354759,0x526777,0x819393,0xb6bcb1,
  0x322936,0x563d43,0x80524a,0xae7356,0xd59a67,0xf2c284,0xffe8b2,
  0x153943,0x225864,0x3c8790,0x64b5af,0xa5ddc9,0xcff9df,
  0x26383c,0x425348,0x5e7153,0x859969,0xa7b779,0xd0d595,
  0x382831,0x4b353b,0x604342,0x775047,0x955d49,0xad7652,
  0x42243c,0x672f40,0x974343,0xc05d4e,0xef8a63,0xffb47c,
  0x292037,0x34283e,0x3e3047,0x523c50,0x625161,
  0x176b78,0x288e9f,0x53d2c6,0x89ebda,0xfff4ca
];
const iron={r:[0,0,1,2]},steel={r:[1,2,3,4,5]},bronze={r:[6,7,8,9,10,11]};
const jade={r:[13,14,15,16]},mint={r:[15,16,17,18],em:true},amber={r:[9,10,11,12],em:true};
const moss={r:[19,20,21,22,23]},soil={r:[25,26,27,28,29]};
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*clamp(t));
const phase=t=>((t%1)+1)%1;

function studio({KIT:K,makeBuilder,makeSculpt,SpriteSurface},seed){
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024),font=K.inspection.font({});
  const V=K.V;
  Object.assign(S,{pixel:true,amb:.31,sky:.17,sunK:.85,sun:V.norm([-.55,.76,.35])});
  const box=(p,half,mat,res=.088)=>S.box(p,half,mat,{res,rd:res*.83});
  function label(text,[x,y,z],span,upright){
    const cols=text.length*6,h=7*span/cols,letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],upright?[0,h,0]:[0,0,-h],cols,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?0xffdfaa:undefined);
  }

  function display(sim,{cam,cut,changeNode,root=false,tint,terminals}){
    sim.step(root?7:8);
    const frames=[],travel=new Float64Array(sim.frame().edges.length),cutAt=root?25:22;
    for(let i=0;i<FRAMES;i++){
      if(i===cutAt)sim.edit({integrity:{[cut]:0}});
      if(changeNode&&i===changeNode.frame)sim.edit({pressures:changeNode.pressures});
      const frame=sim.step(1);
      frame.edges.forEach((edge,j)=>{
        const power=clamp(Math.abs(edge.flow)/(root ? .043 : .070));
        travel[j]+=Math.sign(edge.flow)*(.055+.17*Math.sqrt(power));
      });
      frames.push({frame,travel:travel.slice()});
    }
    const samples=frames[0].frame.edges.map(e=>{
      const count=Math.max(2,Math.ceil(e.route.length/(root ? .145 : .237)));
      return Array.from({length:count+1},(_,j)=>e.route.sample(j/count).point);
    });
    const height=root?2:1;
    const lift=(p,amount)=>p.map((v,i)=>i===height?v+amount:v);
    const effects=K.frameSplats(B,5200,(draw,_dt,time)=>{
      const t=((time%DURATION)+DURATION)%DURATION,index=Math.min(FRAMES-1,Math.floor(t*FPS+1e-7));
      const item=frames[index],{frame}=item;
      for(let j=0;j<frame.edges.length;j++){
        const edge=frame.edges[j],{route}=edge,points=samples[j],broken=edge.integrity===0;
        const gain=clamp(Math.abs(edge.flow)/(root ? .052 : .079));
        const cap=Math.sqrt(edge.capacity/edge.maxCapacity),width=(root ? .012 : .022)+(root ? .102 : .105)*cap;
        const color=tint(edge.id,gain);
        const shell=root?mix([.16,.095,.12],[.52,.30,.18],cap):mix([.12,.18,.24],[.45,.47,.48],cap);
        const idle=root?[.27,.15,.14]:[.17,.25,.32];
        const core=mix(idle,color,clamp(.92*Math.sqrt(gain)+.04));
        for(let k=1;k<points.length;k++){
          const s=(k-.5)/(points.length-1);
          if(broken&&Math.abs(s-.5)<.14)continue;
          const a=points[k-1],b=points[k],taper=root?(1-.35*s):1;
          draw.streak(a,b,{width:width*taper,density:root?1.75:2.2,rgb:broken?(root?[.28,.14,.12]:[.34,.20,.22]):shell,
            depth:true,emissive:true});
          draw.streak(lift(a,width*.45),lift(b,width*.45),{width:width*taper*(root ? .49 : .54),density:1.85,
            rgb:broken?[.46,.24,.20]:core,depth:true,emissive:true});
        }
        if(gain>(root ? .009 : .029)){
          const n=Math.max(1,Math.floor(route.length/(root ? .61 : .54))),offset=K.hash(j,seed,61);
          for(let k=0;k<n;k++){
            const u=phase((k+offset)/n+item.travel[j]/route.length),p=route.sample(u).point;
            const sign=Math.sign(edge.flow),tail=route.sample(clamp(u-sign*(.12+.11*gain)/route.length)).point;
            const rgb=mix(root?color:core,[1,.98,.83],root ? .57 : .37+.20*Math.sqrt(gain));
            draw.streak(lift(tail,width*.86),lift(p,width*.86),{width:.018+width*.30,density:(root ? .72 : .40)+1.56*Math.sqrt(gain),rgb,depth:true});
          }
        }
      }
      for(const id of terminals){
        const node=frame.node(id),power=clamp(Math.abs(node.net)/.110),p=lift(node.at,.096);
        draw.point(p,{width:.045+.083*Math.sqrt(power),density:1.8,rgb:mix([.23,.21,.20],tint(id,power),.36+.64*power),depth:true});
        draw.point(lift(p,.045),{width:.023+.029*power,density:2.3,rgb:mix([.48,.39,.32],[1,.95,.72],.3+.7*power),depth:true});
      }
      if(index>=cutAt){
        const edge=frame.edge(cut),age=(index-cutAt)/FPS;
        for(const u of [.36,.64]){
          const end=edge.route.sample(u).point;
          draw.point(lift(end,.055),{width:.039+.038*Math.exp(-age*2.5),rgb:root?[.91,.50,.27]:[1,.34,.29],density:1.6,depth:true});
        }
        if(age<.67){
          const [x,y,z]=edge.route.sample(.5).point;
          for(let k=0;k<26;k++){
            const a=TAU*K.hash(k,seed,43),v=.22+.86*K.hash(k,seed,81),r=v*age;
            const p=root?[x+Math.cos(a)*r,y+Math.sin(a)*r-.22*age,z+.10+.57*age]:
              [x+Math.cos(a)*r,y+.095+.55*age-age*age*.39,z+Math.sin(a)*r];
            draw.point(p,{width:.023+.026*K.hash(k,seed,190),density:1.68*(1-age/.67),
              rgb:k%3?[1,.58,.27]:[1,.90,.61],depth:true});
          }
        }
      }
    });
    S.bake();
    const world=B.finish({cam,spriteSurfaces:sprites.finish(),radius:8,detail:23,dither:.039,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    effects.post=(_dt,_time,stage)=>{
      // Hidden positions still affect WebGL depth quantization. Restore the pool's parked coordinates.
      const data=stage.D;
      for(let i=effects.first;i<effects.first+effects.count;i++){
        const offset=16*i;
        if(data[offset+3]||!data[offset]&&!data[offset+2])continue;
        data[offset]=0;
        data[offset+2]=0;
        stage.touch(i);
      }
    };
    stage.add(effects);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }

  return {K,V,S,box,label,sprites,display};
}

function night({K,S,box,label,display},seed){
  const height=.48;
  const nodes=[
    ['intake',-3.93,0,1],['west',-3.05,0],['j1',-1.47,0],['j2',1.47,0],['east',3.03,0],['outlet',3.91,0,0],
    ['upper-w',-1.66,-1.23],['upper-m',-.24,-1.39],['upper-e',1.61,-1.22],
    ['lower-w',-2.21,1.36],['lower-m',.12,1.48],['lower-e',2.19,1.34]
  ].map(([id,x,z,pressure])=>({id,at:[x,height,z],pressure}));
  const location=new Map(nodes.map(n=>[n.id,n.at]));
  function link(id,from,to,capacity,minCapacity,maxCapacity,points){
    const flowScale=id.startsWith('upper') ? .044 : id.startsWith('lower') ? .057 : undefined;
    return {id,from,to,capacity,minCapacity,maxCapacity,flowScale,points:points?.map(([x,z])=>[x,height,z])};
  }
  const edges=[
    link('header','intake','west',.76,.19,.96),
    link('west-trunk','west','j1',.58,.15,.96),
    link('fault','j1','j2',.71,.15,1,[[-1.47,0],[-.50,0],[-.31,.13],[.50,.13],[.68,0],[1.47,0]]),
    link('east-trunk','j2','east',.58,.15,.96),
    link('collector','east','outlet',.74,.19,.96),
    link('upper-feed','j1','upper-w',.094,.090,.90,[[-1.47,0],[-1.47,-.96],[-1.66,-1.23]]),
    link('upper-run-a','upper-w','upper-m',.094,.090,.90,[[-1.66,-1.23],[-1.37,-1.39],[-.24,-1.39]]),
    link('upper-run-b','upper-m','upper-e',.094,.090,.90,[[-.24,-1.39],[1.32,-1.39],[1.61,-1.22]]),
    link('upper-return','upper-e','j2',.094,.090,.90,[[1.61,-1.22],[1.47,-.99],[1.47,0]]),
    link('lower-feed','west','lower-w',.066,.04,.52,[[-3.05,0],[-3.05,.86],[-2.78,1.36],[-2.21,1.36]]),
    link('lower-run-a','lower-w','lower-m',.066,.04,.52,[[-2.21,1.36],[-.32,1.36],[.12,1.48]]),
    link('lower-run-b','lower-m','lower-e',.066,.04,.52,[[.12,1.48],[1.79,1.48],[2.19,1.34]]),
    link('lower-return','lower-e','east',.066,.04,.52,[[2.19,1.34],[2.75,1.34],[3.03,1.10],[3.03,0]])
  ];
  const sim=K.procedural.routes.adaptiveTransport({nodes,edges,exponent:1.68,reinforce:5.7,decay:.73,flowScale:.018});
  box([0,-.026,.14],[4.63,.257,2.92],steel,.128);
  box([0,.233,.09],[4.44,.074,2.67],iron,.090);
  for(let z=0;z<11;z++)for(let x=0;x<19;x++){
    const u=-4.15+.46*x,v=-2.39+.46*z;
    box([u,.310,v],[.222,.025,.222],(x+z*3)%7?{r:[0,1,1,2]}:{r:[1,2,2,3]},.092);
  }
  for(const sign of [-1,1]){
    box([sign*4.40,.364,.007],[.069,.068,2.62],jade,.067);
    for(let j=0;j<14;j++)box([sign*4.425,.457,-2.26+.365*j],[.036,.024,.029],j%4?bronze:mint,.040);
  }
  for(const [x,z,half,h] of [[-3.38,-1.79,.39,.90],[-2.42,-1.93,.35,1.36],[-.98,-1.96,.48,.67],
    [.22,-1.99,.41,1.02],[1.31,-2.11,.45,1.39],[2.34,-1.94,.37,.74],[3.33,-1.81,.47,1.11],
    [-3.66,1.04,.29,.60],[3.64,1.03,.31,.52],[-1.30,.68,.32,.23],[.76,.69,.44,.22]]){
    const roof=.35+h;
    box([x,.35+h/2,z],[half,h/2,.32],{r:[0,1,2,3]},.075);
    box([x,roof+.040,z],[half+.039,.051,.349],steel,.067);
    for(let row=1;row<=Math.round(h/.23);row++)for(let col=0;col<3;col++){
      if(K.hash(row,col,x*9+seed)<.16)continue;
      box([x+(col-1)*half*.52,.40+row*.165,z+.329],[.043,.024,.019],(row+col)%4?jade:amber,.037);
    }
    if(h>.69)S.lathe([x-.04,roof+.095,z],.12,[.077,.062,.036],bronze,{res:.048});
  }
  for(const id of ['intake','outlet']){
    const [x,,z]=location.get(id);
    S.lathe([x,.349,z],.17,[.298,.254,.203],id==='intake'?jade:bronze,{res:.067});
    S.tube(K.curve.circle([x,.541,z],.211,31,[0,1,0]),.032,.033,steel,{res:.051});
  }
  for(const id of ['j1','j2','upper-w','upper-e','lower-w','lower-e']){
    const [x,,z]=location.get(id);
    S.lathe([x,.354,z],.065,[.103,.099,.073],bronze,{res:.052});
  }
  for(const x of [-.38,.60])box([x,.36,.11],[.065,.039,.17],{r:[31,32,33,34]},.039);
  box([0,.370,2.56],[1.81,.085,.169],iron,.063);
  label('NIGHT RELAY',[0,.532,2.67],2.80,false);
  const tint=id=>id.startsWith('upper')?[1,.62,.28]:id.startsWith('lower')?[.62,.47,.68]:[.23,.93,.86];
  return display(sim,{cam:{target:[0,.31,.16],dist:14.24,fov:.542,yaw:-.12,pitch:1.01,sway:0},
    cut:'fault',tint,terminals:['intake','outlet','j1','j2']});
}

function graft({K,S,box,label,sprites,display},seed){
  const nodes=[
    ['crown',.03,4.89,1],['fork',.07,3.84],['knuckle',.29,2.40],['heel',.07,1.48],['deep',.02,.81,0],
    ['west-high',-1.27,3.50],['west-low',-2.02,2.59],['west-knee',-1.24,1.69],['west-tip',-3.21,1.35,.18],
    ['east-high',1.34,3.60],['east-low',2.33,2.81],['east-knee',1.37,1.79],['east-tip',3.19,1.31,.22],
    ['hair-a',-2.92,2.94],['hair-b',-2.66,1.93],['hair-c',2.72,3.34],['hair-d',2.96,2.13],
    ['hair-e',-.85,.83],['hair-f',.97,.86]
  ].map(([id,x,y,pressure])=>({id,at:[x,y,.49],pressure}));
  const locations=new Map(nodes.map(n=>[n.id,n.at]));
  const edges=[];
  function link(id,from,to,capacity,minCapacity,maxCapacity,bend=0){
    const a=locations.get(from),b=locations.get(to),j=edges.length;
    const points=Array.from({length:9},(_,i)=>{
      const f=i/8,d=Math.sin(Math.PI*f);
      return [a[0]+(b[0]-a[0])*f+d*bend+.040*d*Math.sin(4*f+j),
        a[1]+(b[1]-a[1])*f+.094*d*Math.sin(7*f+j*.7),
        .49+.043*d*Math.sin(3*f+j)];
    });
    edges.push({id,from,to,capacity,minCapacity,maxCapacity,points});
  }
  link('heart','crown','fork',.76,.16,1,-.18);
  link('cut','fork','knuckle',.77,.14,.98,.21);
  link('main','knuckle','heel',.60,.13,.96,-.09);
  link('tap','heel','deep',.62,.15,.91,.16);
  link('left-crown','fork','west-high',.14,.092,.84,-.19);
  link('left-curve','west-high','west-low',.13,.092,.84,-.22);
  link('left-loop','west-low','west-knee',.11,.092,.84,-.22);
  link('left-graft','west-knee','heel',.11,.092,.84,.18);
  link('left-terminal','west-low','west-tip',.20,.11,.64,-.21);
  link('right-crown','fork','east-high',.085,.065,.71,.25);
  link('right-curve','east-high','east-low',.085,.065,.71,.21);
  link('right-loop','east-low','east-knee',.081,.065,.70,-.15);
  link('right-graft','east-knee','knuckle',.079,.063,.70,.10);
  link('right-terminal','east-low','east-tip',.13,.10,.65,.25);
  for(const [id,from,bend] of [['hair-a','west-high',-.19],['hair-b','west-low',-.11],['hair-c','east-high',.15],
    ['hair-d','east-low',.12],['hair-e','heel',-.14],['hair-f','heel',.18]]){
    link(id,from,id,.13,.019,.50,bend);
  }
  const sim=K.procedural.routes.adaptiveTransport({nodes,edges,exponent:1.55,reinforce:5.1,decay:.73,flowScale:.0175});
  box([0,3.13,-.24],[4.64,2.97,.38],steel,.107);
  box([0,3.07,.10],[4.45,2.82,.105],iron,.089);
  box([0,2.91,.23],[4.23,2.38,.037],soil,.076);
  sprites.face([-4.24,.58,.325],[8.48,0,0],[0,4.69,0],270,150,(u,v)=>{
    const x=u/270*8.48-4.24,y=(1-v/150)*4.69+.58;
    const n=K.noise3(2.9*x,3.8*y,seed*.1),fine=K.hash(u,v,seed),a=K.noise3(x*.75,y*2.6,3.4);
    if(y>4.92){const t=clamp((y-4.92)*4);return [0x343b31,0x425348,0x5e7153,0x7a8155][Math.min(3,Math.floor(3.8*(n*.56+t*.44)))];}
    const strata=.5+.5*Math.sin(y*17.8+x*.82+a*4.0),m=clamp(.38*n+.29*strata+.17*fine+.16*a);
    return [0x292037,0x34283e,0x3e3047,0x4b353b,0x523c50,0x604342][Math.min(5,Math.floor(m*6))];
  });
  for(const s of [-1,1]){
    box([s*4.26,2.96,.36],[.056,2.38,.079],bronze,.059);
    for(let j=0;j<10;j++)box([s*4.285,.93+j*.44,.45],[.026,.019,.020],j%3?bronze:mint,.034);
  }
  box([0,5.31,.407],[4.33,.061,.073],moss,.070);
  box([0,.544,.382],[4.34,.045,.063],bronze,.054);
  for(const [x,y,r] of [[-3.35,3.74,.38],[-2.67,4.36,.23],[-1.98,3.63,.23],[-.65,2.74,.25],
    [1.03,2.97,.30],[2.9,4.12,.36],[3.50,2.57,.35],[-3.58,2.02,.24],[2.67,1.66,.23],
    [2.3,.89,.35],[-2.08,.94,.34]]){
    S.rock([x,y,.404],[r,r*.46,r*.19],{r:[6,7,26,27,28]}, {res:.069});
  }
  S.ball([.03,4.97,.462],[.45,.194,.126],bronze,{res:.069});
  for(const sign of [-1,1]){
    S.tube([[.03,5.05,.49],[.14*sign,5.31,.52],[.40*sign,5.56,.542]],.064,.036,moss,{res:.056});
    S.ball([.43*sign,5.54,.544],[.32,.087,.075],moss,{res:.065});
  }
  for(const id of ['west-tip','east-tip','deep']){
    const [x,y,z]=locations.get(id);
    S.ball([x,y,z-.065],[.141,.098,.047],bronze,{res:.047});
  }
  box([0,.341,.36],[1.71,.126,.064],iron,.066);
  label('ROOT GRAFT',[0,.225,.479],2.45,true);
  const tint=id=>id.startsWith('left')?[.86,.83,.45]:id.startsWith('right')?[.58,.76,.46]:[.95,.65,.35];
  return display(sim,{cam:{target:[0,3.14,.04],dist:12.93,fov:.55,yaw:.099,pitch:.059,sway:0},
    cut:'cut',root:true,tint,terminals:['crown','west-tip','east-tip','deep'],
    changeNode:{frame:43,pressures:{'east-tip':.06}}});
}

module.exports=kit=>({
  id:'adaptive-transport-studies',name:'Night Relay and Root Graft',seed:30,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'relay';
    if(study!=='relay'&&study!=='roots')throw new RangeError('Choose relay or roots');
    const set=studio(kit,seed);
    return study==='relay'?night(set,seed):graft(set,seed);
  }
});
