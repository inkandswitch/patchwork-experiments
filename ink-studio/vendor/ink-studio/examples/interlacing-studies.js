const DURATION=6.4,FPS=10,TAU=2*Math.PI;
const palette=[
  0x111826,0x202a3b,0x35465a,0x586e79,0x849697,0xb8b9a6,
  0x3d293a,0x633e46,0x96604e,0xc68b62,0xeab782,0xffda9d,0xffefd0,
  0x123440,0x1a5060,0x2d7681,0x54a9a2,0x8ed2b7,0xd4f5d1,
  0x302540,0x503254,0x75476b,0xa96c93,0xd497ad,0xf8c9c4,
  0x153a3d,0x30574d,0x4e7d66,0x7ca57f,0xa7cb9c,0xe5e4b4,
  0x4e393e,0x76504a,0x9d6e55,0xc89369,0xe9b984,0xfee2ac,
  0x1a3d55,0x285e7b,0x368f9d,0x70b9bc,0xaae3da,0xe6f9de
];
const iron={r:[0,0,1,2]},steel={r:[1,2,3,4]},brass={r:[6,7,8,9,10,11]},gold={r:[7,8,9,10,11,12]};
const jade={r:[13,14,15,16,17]},mint={r:[14,15,16,17,18],em:true},amber={r:[9,10,11,12],em:true};
const plum={r:[19,20,21,22,23,24]},linen={r:[31,32,33,34,35,36]};
const clamp=n=>Math.max(0,Math.min(1,n));
const phase=t=>((t%1)+1)%1;

function studio({KIT:K,makeBuilder,makeSculpt,SpriteSurface},seed){
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024),font=K.inspection.font({});
  const V=K.V;
  Object.assign(S,{pixel:true,amb:.34,sky:.18,sunK:.88,sun:V.norm([-.52,.79,.35])});
  const box=(at,half,mat,res=.084)=>S.box(at,half,mat,{res,rd:.81*res});
  function label(text,[x,y,z],span){
    const cols=text.length*6,h=7*span/cols,letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y-h/2,z],[span,0,0],[0,h,0],cols,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?0xffdfa8:undefined);
  }
  function finish(cam,paint){
    const sparks=K.frameSplats(B,650,(draw,_dt,t)=>{
      const wrapped=((t%DURATION)+DURATION)%DURATION,at=Math.min(63,Math.floor(wrapped*FPS+1e-7))/FPS;
      paint(draw,at);
    });
    S.bake();
    const world=B.finish({cam,spriteSurfaces:sprites.finish(),radius:8,detail:25,dither:.041,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    sparks.post=(_dt,_t,active)=>{
      const data=active.D;
      for(let i=sparks.first;i<sparks.first+sparks.count;i++){
        const o=i*16;
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
  return { K,V,S,box,label,finish };
}

function loom({K,S,box,label,finish},seed){
  const columns=18,rows=12,dx=.418,dy=.365,left=-dx*(columns-1)/2,base=.86,front=.376;
  const warp=Array.from({length:columns},(_,i)=>({id:'warp-'+i,radius:.057+.014*K.hash(i,seed,19)}));
  const weft=Array.from({length:rows},(_,i)=>({id:'weft-'+i,radius:.067+.009*K.hash(i,seed,42)}));
  const weave=K.procedural.interlace.weave({warp,weft,pattern:['1100','0110','0011','1001'],
    spacing:[dx,dy],margin:[.31,.23],clearance:.022,origin:[left,base,front],
    u:[1,0,0],v:[0,1,0]});
  for(const {radius,index,family,path} of weave.strands){
    const isWarp=family==='warp';
    const material=isWarp?(index%5===2?linen:gold):index%7===3?plum:jade;
    S.tube(path.points,radius,radius,material,{res:.051});
    if(isWarp&&index%3===0){
      const accent=K.curve.resample(path.points,100).map(([x,y,z])=>[x-.008,y,z+radius*.79]);
      S.tube(accent,.010,.010,linen,{res:.037});
    }
  }

  const top=base+dy*(rows-1),frameY=(base+top)/2;
  box([0,frameY-.01,-.32],[4.55,2.81,.27],steel,.111);
  box([0,frameY-.01,-.023],[4.36,2.67,.115],iron,.094);
  box([0,frameY,-.001],[3.97,2.22,.052],{r:[0,0,1,2]},.072);
  for(const side of [-1,1]){
    box([side*4.03,frameY,.36],[.077,2.30,.196],brass,.066);
    for(let j=0;j<rows;j++){
      const y=base+j*dy;
      box([side*4.01,y,.456],[.093,.045,.081],j%4?steel:jade,.048);
      S.ball([side*3.92,y,.513],.030,j%4?brass:amber,{res:.035});
    }
  }
  for(const y of [base-.268,top+.274]){
    box([0,y,.376],[4.07,.104,.184],brass,.072);
    for(let c=0;c<columns;c++){
      const x=left+c*dx;
      box([x,y,.579],[.066,.053,.045],c%4===0?jade:steel,.050);
      S.ball([x,y,.606],.026,c%4===0?mint:linen,{res:.033});
    }
  }
  box([0,.26,.323],[1.63,.146,.082],iron,.065);
  label('COPPER LOOM',[0,.255,.571],2.44);
  for(const x of [-2.58,2.58])for(let j=0;j<6;j++)
    box([x+.115*(j-3),.298,.453],[.027,.029+(j%3===0?.018:0),.025],j%3?brass:mint,.036);

  const picks=weave.strands.filter(s=>s.family==='weft');
  function trace(draw,t){
    const f=t/ DURATION*rows, row=Math.min(rows-1,Math.floor(f)), path=picks[row].path;
    const direction=row%2===0?1:-1, start=direction>0?0:path.length;
    const distance=start+direction*(f-row)*path.length;
    for(let j=0;j<21;j++){
      const tail=distance-direction*j*.047;
      if(tail<0||tail>path.length)continue;
      const a=path.frame(tail).p, b=path.frame(tail-direction*.042).p;
      a[2]+= .084;
      b[2]+= .084;
      draw.streak(a,b,{width:.024+.017*(1-j/21),rgb:[1,.76,.36],density:1.45*(1-j/22),depth:true});
    }
    const p=path.frame(distance).p;
    p[2]+=.105;
    draw.point(p,{rgb:[1,.91,.62],width:.069,density:2,depth:true});
    draw.point([p[0],p[1],p[2]+.039],{rgb:[1,1,.85],width:.034,density:2.15,depth:true});
  }
  return finish({target:[0,2.82,.04],dist:13.46,fov:.550,yaw:-.14,pitch:.153,sway:0},trace);
}

function span({K,V,S,box,label,finish},seed){
  const spine=K.curve.path(Array.from({length:145},(_,i)=>{
    const t=i/144;
    return [8.65*(t-.5),.88+2.89*Math.sin(Math.PI*t)**1.23,.24+.48*Math.sin(TAU*t+.32)];
  }),{up:[0,0,1]});
  const braid=K.procedural.interlace.braid({spine,word:[1,-2],repeats:4,spacing:.55,clearance:.065,
    strands:[{id:'verdigris',radius:.135},{id:'bronze',radius:.148},{id:'amethyst',radius:.131}],samplesPerCrossing:16});
  const materials=[jade,gold,plum], glows=[[.52,.98,.82],[1,.82,.44],[1,.74,.87]];
  for(const {path,index,radius} of braid.strands){
    S.tube(path.points,radius-.014,radius-.014,materials[index],{res:.059});
    const n=Math.ceil(path.length/.044);
    for(const sign of [-1,1]){
      const trace=Array.from({length:n+1},(_,i)=>{
        const station=i/n*path.length, f=path.frame(station),a=station*TAU/.85+sign*Math.PI/2;
        return V.mad(V.mad(f.p,f.N,(radius-.021)*Math.cos(a)),f.B,(radius-.021)*Math.sin(a));
      });
      S.tube(trace,.017,.017,index===0?mint:index===1?linen:plum,{res:.042});
    }
  }

  box([0,-.11,.05],[4.98,.222,2.09],steel,.122);
  box([0,.144,.071],[4.78,.062,1.97],iron,.096);
  for(const side of [-1,1]){
    box([side*4.77,.204,.075],[.049,.053,1.92],jade,.062);
    for(let j=0;j<12;j++)box([side*4.79,.273,-1.71+.326*j],[.032,.022,.025],j%4?brass:mint,.037);
  }
  for(const z of [-1.82,1.88])box([0,.198,z],[4.73,.054,.049],brass,.068);
  for(const s of [-1,1]){
    const f=spine.frame(s<0?0:spine.length), [x,y,z]=f.p;
    box([x,.299,z],[.404,.095,.42],steel,.079);
    box([x,.706,z],[.206,.36,.192],jade,.072);
    box([x,y+.35,z],[.172,.535,.19],brass,.065);
    box([x,y+.923,z],[.250,.087,.272],steel,.064);
    S.ball([x,y+1.062,z],.058,amber,{res:.040});
    for(let j=0;j<3;j++){
      box([x,.56+j*.21,z+.213],[.090,.028,.021],j===1?mint:steel,.043);
    }
  }
  box([0,.403,1.878],[1.61,.158,.109],iron,.065);
  label('BRAIDED SPAN',[0,.420,2.092],2.53);
  for(const x of [-2.37,2.37])box([x,.29,1.69],[.33,.05,.083],brass,.059);

  const cameraVector=V.norm([-.05,.24,1]);
  function onSurface(path,d,radius){
    const {p,T}=path.frame(d), n=V.norm(V.mad(cameraVector,T,-V.dot(cameraVector,T)));
    return V.mad(p,n,radius+.021);
  }
  function trace(draw,time){
    for(const {path,index,radius} of braid.strands){
      const count=8;
      for(let j=0;j<count;j++){
        const d=phase(time*(index===1?-1:1)/DURATION+(j+.52*K.hash(j,index,seed))/count)*path.length;
        const fade=clamp(d/.24)*clamp((path.length-d)/.24),tail=d-(index===1?-1:1)*.18;
        if(tail<0||tail>path.length)continue;
        const a=onSurface(path,tail,radius),b=onSurface(path,d,radius);
        draw.streak(a,b,{width:.031,density:1.64*fade,rgb:glows[index],depth:true});
        draw.point(b,{rgb:[1,1,.87],width:.028,density:1.83*fade,depth:true});
      }
    }
  }
  return finish({target:[0,1.86,.12],dist:14.3,fov:.54,yaw:-.12,pitch:.27,sway:0},trace);
}

module.exports=kit=>({
  id:'interlacing-studies',name:'Copper Loom and Braided Span',seed:32,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'weave';
    if(study!=='weave'&&study!=='braid')throw new RangeError('Choose weave or braid');
    return (study==='weave'?loom:span)(studio(kit,seed),seed);
  }
});
