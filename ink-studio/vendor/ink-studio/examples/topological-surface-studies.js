const FPS=10,FRAMES=64,DURATION=FRAMES/FPS,TAU=2*Math.PI;
const palette=[
  0x101725,0x1e293b,0x303e52,0x485c70,0x748997,0xa8b6b7,
  0x422f40,0x694750,0x955f54,0xb97f5e,0xd6a572,0xf1cd94,0xffedbe,
  0x103138,0x164952,0x21636b,0x2b8689,0x4eab9f,0x82cdaf,0xbdf1d2,0xecffee,
  0x322749,0x4d345c,0x724774,0x995885,0xc473a5,0xe69abb,0xffc5c8,
  0x3a323c,0x62463f,0x886249,0xad8059,0xcda46f,0xe9c087,0xffe6ad,
  0x183535,0x2f5244,0x4d7150,0x729059,0x9cb76f,0xc2cd92,0xe3e3b2,
  0x15304c,0x1e4b65,0x2f6c85,0x5598ac,0x8ac2cb,0xc3e7e9
];
const iron={r:[0,0,1,2]},steel={r:[1,2,3,4]},brass={r:[6,7,8,9,10,11]};
const jade={r:[13,14,15,16,17]},amber={r:[9,10,11,12],em:true},mint={r:[16,17,18,19],em:true};
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*clamp(t));
const wave=n=>.5+.5*Math.cos(n);
const pack=rgb=>rgb.reduce((out,value)=>out*256+Math.min(255,Math.max(0,Math.round(value))),0);

function design(P,study){
  const matte={ size:[12,2.4], skin:[24,82,86], shade:[112,193,161], ink:[255,194,119], accent:[215,250,209] };
  if(study==='twist')return [
    {...matte,title:'MOBIUS',kind:'mobius',x:-2.38,segments:[100,20],
      chart:P.surface.mobius({radius:1.40,halfWidth:.57}),rotation:[1.00,-.23,-.24],y:2.26,
      laps:2,lanes:[u=>[.23,0],u=>[.50,0]],rims:[[0,2]]},
    {...matte,title:'KLEIN IMMERSION',kind:'klein',x:2.38,segments:[92,44],size:[9.9,5.3],
      chart:P.surface.kleinBottle({radius:1.27,tube:.51}),rotation:[1.01,.34,.23],y:2.26,
      skin:[51,34,85],shade:[172,99,159],ink:[254,181,122],accent:[251,214,237],
      laps:2,lanes:[u=>[.14+.5*u,.5],u=>[.31+.5*u,.5]],rims:[]}
  ];
  return [
    {...matte,title:'HELICOID',kind:'helicoid',x:-2.38,segments:[118,12],size:[12,2.8],
      chart:P.surface.helicoid({radius:1.42,pitch:1.34,turns:2.32}),rotation:[.07,.24,-.045],y:2.23,
      skin:[32,68,56],shade:[162,200,115],ink:[254,203,124],accent:[222,246,192],
      laps:0,lanes:[u=>[.50+.30*Math.sin(2.7*Math.PI*u-.74),.81*Math.PI*Math.cos(2.7*Math.PI*u-.74)],
        u=>[.50+.30*Math.sin(2.7*Math.PI*u+2.35),.81*Math.PI*Math.cos(2.7*Math.PI*u+2.35)]],rims:[[0,1],[1,1]]},
    {...matte,title:'CATENOID',kind:'catenoid',x:2.38,segments:[84,28],size:[8.6,3.8],
      chart:P.surface.catenoid({radius:.75,height:2.28}),rotation:[0,-.34,.035],y:2.17,
      skin:[26,59,101],shade:[104,174,205],ink:[249,196,111],accent:[190,251,241],
      laps:1,lanes:[u=>[.50+.33*Math.sin(TAU*u-.38),.33*TAU*Math.cos(TAU*u-.38)],
        u=>[.50+.33*Math.sin(TAU*u+2.76),.33*TAU*Math.cos(TAU*u+2.76)]],rims:[[0,1],[1,1]]}
  ];
}

module.exports=({KIT:K,makeBuilder,makeSculpt,SpriteSurface})=>({
  id:'topological-surface-studies',name:'Twisted Glaze and Minimal Forms',seed:31,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'twist';
    if(study!=='twist'&&study!=='minimal')throw new RangeError('Choose twist or minimal');
    const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024);
    const P=K.procedural,V=K.V,font=K.inspection.font({}), definitions=design(P,study);
    const light=V.norm([-.56,.79,.42]),view=V.norm([-.07,.22,1]),half=V.norm(V.add(light,view));
    Object.assign(S,{pixel:true,amb:.35,sky:.15,sunK:.86,sun:light});
    const box=(p,extent,mat,res=.085)=>S.box(p,extent,mat,{res,rd:res*.75});
    function label(text,x){
      const span=text.length>9?2.28:1.37,w=text.length*6,h=span*7/w,letters=[...text].map(c=>font.get(c));
      sprites.face([x-span/2,.324-h/2,2.153],[span,0,0],[0,h,0],w,7,
        (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?0xffdc9b:undefined);
    }

    box([0,-.16,0],[5.10,.239,2.16],steel,.124);
    box([0,.097,.02],[4.94,.058,2.06],iron,.093);
    for(const side of [-1,1]){
      box([side*4.91,.176,0],[.044,.041,1.98],jade,.063);
      for(let j=0;j<9;j++)box([side*4.90,.239,-1.76+.44*j],[.024,.017,.029],j%3?brass:mint,.037);
    }
    box([0,.175,-1.93],[4.90,.069,.053],brass,.061);
    box([0,.161,1.99],[4.88,.034,.036],steel,.056);
    for(let j=0;j<15;j++)box([-4.45+j*.635,.214,1.989],[.033,.012,.019],j%4?jade:amber,.033);

    const animated=[];
    for(const item of definitions){
      const chart=P.surface.transform(item.chart,P.transforms.local({position:[item.x,item.y,0],rotation:item.rotation}));
      const mesh=chart.mesh({segments:item.segments}),[width,height]=item.kind==='klein'?[330,133]:[300,97];
      const {topology}=chart, options={size:item.size,topology};
      const lanes=item.lanes.map(fn=>{
        const n=140*Math.max(1,item.laps), points=Array.from({length:n+1},(_,i)=>{
          const u=i/n*Math.max(1,item.laps);
          return topology.canonical([u,fn(u)[0]]).uv;
        });
        return {
          wide:P.surfaceMasks.compile([{points,width:.235,softness:.027}],options),
          fine:P.surfaceMasks.compile([{points,width:.099,softness:.018}],options)
        };
      });
      sprites.mesh(mesh,width,height,(px,py)=>{
        const u=px/(width-1),v=py/(height-1),sample=chart.sample([u,v]),{p,n}=sample;
        const stripe=wave((v-.5)*TAU*(item.kind==='klein'?9:7)), latitude=wave(u*TAU*29);
        const etch=.16*stripe**8+.075*latitude**14;
        const grain=.094*wave(p[0]*28+p[1]*14-p[2]*22)+.045*wave(p[1]*64+p[2]*37);
        const diffuse=.31+.57*Math.abs(V.dot(n,light)), gloss=.24*Math.abs(V.dot(n,half))**21;
        let color=mix(item.skin,item.shade,clamp(diffuse+grain+etch*.61));
        color=mix(color,[248,250,216],gloss);
        for(let j=0;j<lanes.length;j++){
          const lane=lanes[j],rg=lane.wide.weight(u,v),fg=lane.fine.weight(u,v);
          const ink=j?item.accent:item.ink,edge=mix(item.skin,ink,.63);
          color=mix(color,edge,rg*.89);
          color=mix(color,ink,fg*(.88+.10*diffuse));
        }
        return pack(color);
      });

      for(const [v,span] of item.rims){
        const steps=Math.round(109*span);
        const rim=Array.from({length:steps+1},(_,i)=>chart.sample([span*i/steps,v]).p);
        S.tube(rim,.023,.033,brass,{res:.046});
      }
      let foot=[0,Infinity,0];
      for(let i=0;i<mesh.points.length;i+=3)if(mesh.points[i+1]<foot[1])foot=Array.from(mesh.points.slice(i,i+3));
      const vp=Math.max(.42,foot[1]), [fx,,fz]=foot;
      S.lathe([item.x,.147,0],.155,[1.77,1.84,1.86,1.80],steel,{res:.085});
      S.lathe([item.x,.300,0],.050,[1.71,1.70,1.62],jade,{res:.073});
      S.lathe([fx,.349,fz],.086,[.230,.206,.164],brass,{res:.058});
      if(vp>.47)S.tube([[fx,.409,fz],[fx,vp+.017,fz]],.053,.036,steel,{res:.056});
      box([item.x,.324,2.047],[1.288,.147,.076],iron,.059);
      label(item.title,item.x);
      for(const sign of [-1,1]){
        box([item.x+sign*1.43,.25,1.45],[.181,.035,.063],brass,.057);
        S.ball([item.x+sign*1.43,.297,1.45],.035,amber,{res:.038});
      }

      const seeds=[];
      for(let lane=0;lane<item.lanes.length;lane++){
        const fn=item.lanes[lane], count=item.laps?19:12;
        for(let i=0;i<count;i++){
          const lift=(i+.35+lane*.31)/count*Math.max(1,item.laps), {uv,orientation}=topology.canonical([lift,fn(lift)[0]]);
          seeds.push({uv,data:{lane,sheet:item.laps?Math.floor(lift):0,orientation,launch:0}});
        }
        if(!item.laps)for(let i=1;i<=8;i++){
          const u=.039+lane*.014;
          seeds.push({uv:[u,fn(u)[0]],data:{lane,sheet:0,orientation:1,launch:.49*i+.16*lane}});
        }
      }
      const sim=P.motion.surfaceAdvection(chart,seeds,{step:.05,boundary:'stop',
        velocity(_x,_y,_z,t,{lift,du,dv,data}){
          if(t<data.launch)return [0,0,0];
          const speed=item.laps?item.laps/DURATION:.23;
          return V.mad(V.mul(du,speed),dv,speed*data.orientation*item.lanes[data.lane](lift[0]+data.sheet)[1]);
        }
      });
      const sequence=[sim.snapshot()];
      for(let i=1;i<FRAMES;i++)sequence.push(sim.advance(1/FPS));
      animated.push({sequence,item});
    }

    const sparks=K.frameSplats(B,650,(draw,_dt,t)=>{
      const time=((t%DURATION)+DURATION)%DURATION, k=Math.min(FRAMES-1,Math.floor(time*FPS+1e-7));
      for(const {sequence,item} of animated){
        const now=sequence[k].particles,last=sequence[Math.max(0,k-1)].particles;
        for(let i=0;i<now.length;i++){
          const p=now[i],a=last[i],{lane,launch}=p.data;
          if(!p.active||time<launch)continue;
          const radius=.028+.018*K.hash(i,seed,16);
          const fade=item.laps?1:clamp((p.uv[0]-.025)*14)*clamp((1-p.uv[0])*12);
          const color=mix(lane?item.accent:item.ink,[255,254,227],.65).map(n=>n/255);
          for(const sign of [-1,1]){
            const start=V.mad(a.position,a.normal,.046*sign),end=V.mad(p.position,p.normal,.046*sign);
            draw.streak(start,end,{width:radius,density:1.28*fade,rgb:color,depth:true});
            draw.point(end,{width:radius*.70,density:1.61*fade,rgb:[1,1,.86],depth:true});
          }
        }
      }
    });
    S.bake();
    const world=B.finish({cam:{target:[0,1.66,.11],dist:13.55,fov:.545,yaw:-.085,pitch:.25,sway:0},
      spriteSurfaces:sprites.finish(),detail:25,dither:.047,radius:7,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    sparks.post=(_dt,_t,active)=>{
      const data=active.D;
      for(let i=sparks.first;i<sparks.first+sparks.count;i++){
        const o=16*i;
        if(!data[o+3]&&(data[o]||data[o+2])){
          data[o]=data[o+2]=0;
          active.touch(i);
        }
      }
    };
    stage.add(sparks);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
});
