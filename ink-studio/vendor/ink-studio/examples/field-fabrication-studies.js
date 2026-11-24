const FPS=10, FRAMES=64, DURATION=FRAMES/FPS, TAU=2*Math.PI;
const palette=[
  0x101725,0x1a2637,0x27394a,0x384c5d,0x4a626e,0x758e90,0xa1ac9e,
  0x123339,0x19494e,0x25656a,0x398983,0x58a798,0x8bc7ad,0xd3e2b8,
  0x322533,0x593139,0x84443b,0xab5d42,0xca7847,0xe19856,0xf7bd72,0xffd993,0xffedb7,
  0x242946,0x3a4265,0x59658b,0x8292ac,0xb1bfcd,
  0x3b3538,0x63514a,0x8e735d,0xb49874,0xccb190,0xe8cfaa,
  0x713658,0xa55269,0xcf7880,0xefab99
];
const iron={r:[0,1,2,3]}, slate={r:[1,2,3,4]}, bronze={r:[14,15,16,17,18,19]}, teal={r:[7,8,9,10]};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t));
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const z=clamp(x);return z*z*(3-2*z);};
const hex=c=>c.reduce((n,x)=>256*n+Math.max(0,Math.min(255,Math.round(x))),0);
const phase=t=>Math.min(FRAMES-1,Math.floor((t-DURATION*Math.floor(t/DURATION))*FPS+1e-7));
const angle=t=>phase(t)*TAU/FRAMES;

// Segment visibility against the same triangles that make the lantern.
function occluder(V,{points,triangles}){
  const faces=[];
  for(let i=0;i<triangles.length;i+=3){
    const p=[0,1,2].map(j=>Array.from(points.subarray(triangles[i+j]*3,triangles[i+j]*3+3)));
    const [a,b,c]=p, min=a.map((x,k)=>Math.min(x,b[k],c[k])), max=a.map((x,k)=>Math.max(x,b[k],c[k]));
    faces.push({a,ab:V.sub(b,a),ac:V.sub(c,a),min,max});
  }
  function build(list){
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const face of list)for(let k=0;k<3;k++){
      min[k]=Math.min(min[k],face.min[k]);max[k]=Math.max(max[k],face.max[k]);
    }
    if(list.length<=8)return {min,max,list};
    const axis=min.reduce((i,x,k)=>max[k]-x>max[i]-min[i]?k:i,0);
    list.sort((a,b)=>a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis]);
    const m=list.length>>1;
    return {min,max,left:build(list.slice(0,m)),right:build(list.slice(m))};
  }
  const root=build(faces);
  function hits({a,ab,ac},start,direction){
    const p=V.cross(direction,ac), determinant=V.dot(ab,p);
    if(Math.abs(determinant)<1e-10)return false;
    const inverse=1/determinant, d=V.sub(start,a), u=V.dot(d,p)*inverse;
    if(u<0||u>1)return false;
    const q=V.cross(d,ab),v=V.dot(direction,q)*inverse;
    if(v<0||u+v>1)return false;
    const t=V.dot(ac,q)*inverse;
    return t>1e-6&&t<1-1e-6;
  }
  return (start,end)=>{
    const dir=V.sub(end,start), inv=dir.map(x=>x===0?0:1/x);
    function walk(node){
      let lo=0,hi=1;
      for(let k=0;k<3;k++){
        if(dir[k]===0){if(start[k]<node.min[k]||start[k]>node.max[k])return false;continue;}
        const a=(node.min[k]-start[k])*inv[k],b=(node.max[k]-start[k])*inv[k];
        lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
        if(lo>hi)return false;
      }
      return node.list?node.list.some(face=>hits(face,start,dir)):walk(node.left)||walk(node.right);
    }
    return walk(root);
  };
}

function lantern(K, B, S, sprites){
  const P=K.procedural,V=K.V, baseY=.42, H=2.88, center=[-.65,0,-.10];
  const radius=v=>.80+.245*Math.sin(Math.PI*v)+.066*v;
  const carrier={periodicU:true,sample([u,v]){
    const a=TAU*u,c=Math.cos(a),s=Math.sin(a),r=radius(v);
    return {p:[center[0]+r*c,baseY+H*v,center[2]+r*s],
      n:V.norm([c,-(.245*Math.PI*Math.cos(Math.PI*v)+.066)/H,s])};
  }};
  const sim=P.growth.grayScott.create({
    charts:[{id:'skin',width:112,height:47,carrier}],
    seams:[{a:['skin','u0'],b:['skin','u1']}],feed:.035,kill:.0605
  });
  for(let j=0;j<3;j++)for(let i=0;i<8;i++){
    const u=(i+.28+.44*K.hash(i,j,51))/8,v=(j+.29+.47*K.hash(i,j,37))/3;
    sim.brush({chart:'skin',at:[u,v],radius:4.4,values:{u:.49,v:.29},falloff:'flat'});
  }
  for(let i=0;i<9;i++)sim.step(80);
  const frame=sim.frame('skin'), level=.269;
  const field=(u,v)=>frame.sample('v',u,v)*smooth(Math.min(v,1-v)*14);
  const body=P.fabrication.shell({carrier,field,segments:[146,69],cut:{level},
    thickness:value=>.097+.16*smooth(value/.32),
    ribs:[{level:.171,width:.049,height:.045},{level:.224,width:.025,height:.029}]
  });
  const shade=V.norm([-.59,.46,.66]), reflect=V.norm([-.55,.17,.81]), w=392,h=168;
  sprites.mesh(body.surface('outer'),w,h,(i,j)=>{
    const u=i/(w-1),v=j/(h-1),{n}=carrier.sample([u,v]),f=field(u,v);
    const diffuse=.34+.51*Math.max(0,V.dot(n,shade)), fleck=K.hash(i,j,29);
    const ceramic=mix([16,45,54],[92,166,142],diffuse+.17*fleck+.055*Math.sin(i*.19+j*.43));
    const ridge=.64*Math.exp(-(((f-.171)/.031)**2))+.38*Math.exp(-(((f-.224)/.020)**2));
    let color=mix(ceramic,[181,171,114],ridge*(.42+.52*diffuse));
    color=mix(color,[231,208,146],.28*Math.max(0,V.dot(n,reflect))**9);
    if(Math.min(v,1-v)<.038)color=mix(color,[217,166,104],.39+.40*diffuse);
    return hex(color);
  });
  sprites.mesh(body.surface('inner'),210,94,(i,j)=>{
    const u=i/209,v=j/93,n=carrier.sample([u,v]).n;
    const g=.26+.47*smooth(v)+.10*K.hash(i,j,73)+.12*Math.abs(V.dot(n,shade));
    return hex(mix([35,36,42],[190,101,51],g));
  });
  sprites.mesh(body.surface('wall'),22,28,(i,j)=>hex(mix([78,53,39],[246,180,99],
    .45+.18*Math.cos(Math.PI*(j/27-.21))+.13*K.hash(i,j,3)-(j>19?.19:0))));
  const base=[center[0],.286,center[2]];
  S.lathe(base,.035,[1.035,1.015,1.002,.96],iron,{res:.075});
  S.lathe([base[0],.350,base[2]],.030,[.966,.953,.939],bronze,{res:.069});
  S.lathe([base[0],.400,base[2]],.017,[.931,.914],teal,{res:.065});
  S.lathe([base[0],baseY+H,base[2]],.024,[.983,.983,.942,.902],bronze,{res:.071});
  const lamp=t=>{
    const a=angle(t);
    return [center[0]+.27*Math.sin(a),baseY+1.91+.24*Math.cos(a),center[2]+.17*Math.sin(a+.93)];
  };
  const blocked=occluder(V,body.indexed()), floorY=.317, fw=250,fh=142, span=[8.20,5.06], origin=[-4.10,floorY,-2.36];
  const region=sprites.reserve(fw,fh);
  sprites.faceRegion(origin,[span[0],0,0],[0,0,span[1]],region);
  const floor=new Float64Array(fw*fh*2), ink=new Float32Array(fw*fh);
  for(let j=0;j<fh;j++)for(let i=0;i<fw;i++){
    const q=i+j*fw, u=(i+.5)/fw,v=(j+.5)/fh;
    floor[2*q]=origin[0]+span[0]*u;floor[2*q+1]=origin[2]+span[1]*(1-v);
    ink[q]=K.hash(i,j,21);
  }
  const paint=K.frameSplats(B,52,(draw,_dt,t)=>{
    const a=angle(t), p=lamp(t), tint=[1,.75,.40];
    draw.point(p,{width:.13,density:2.06,rgb:tint,depth:true});
    draw.point(V.mad(p,[0,1,0],.06),{width:.072,density:2.31,rgb:[1,.92,.63],depth:true});
    for(let i=0;i<13;i++){
      const speed=i%3===0?2:1,d=(a/TAU*speed+i*.087)%1,r=.077+.13*d;
      const q=[p[0]+r*Math.cos(i*2.4+a),p[1]+.42*d,p[2]+r*Math.sin(i*2.4+a)];
      draw.point(q,{width:.018,density:1.27*Math.sin(Math.PI*d),rgb:tint,depth:true});
    }
  });
  let last=-1;
  function update(SpriteSurface,atlas,t){
    const k=phase(t);
    if(k===last)return;
    const p=lamp(t), a=angle(t), brightness=.97+.10*Math.sin(a*2+.4), rgba=new Uint8Array(fw*fh*4);
    for(let i=0;i<ink.length;i++){
      const x=floor[2*i],z=floor[2*i+1],r=Math.hypot(x-center[0],z-center[2]), hit=[x,floorY,z];
      const falloff=Math.max(0,1-r/3.43)**.93 / (.89+.19*(r-1)**2);
      const weight=r>.98&&falloff>.018&&!blocked(p,hit)?brightness*falloff:0;
      const joint=(Math.abs((x+4.10)%1.03)<.024||Math.abs((z+2.36)%1.02)<.026)?.68:1;
      const base=.32+.25*ink[i]+.10*Math.cos(x*9+z*3);
      let color=mix([17,26,40],[65,82,89],base*joint);
      color=mix(color,[253,177,89],.92*smooth(weight*1.93)*(.82+.18*ink[i]));
      rgba.set(color.map(Math.round),i*4);rgba[i*4+3]=255;
    }
    SpriteSurface.update(atlas,region,{w:fw,h:fh,rgba});
    last=k;
  }
  return {paint,update};
}

function contourStack(K,B,_S,sprites){
  const V=K.V,P=K.procedural;
  const outline=Array.from({length:90},(_,i)=>{
    const a=TAU*i/90,r=1+.087*Math.sin(3*a+.40)+.10*Math.cos(2*a-.27)+.039*Math.sin(5*a);
    return [2.34*r*Math.cos(a)+.13*Math.sin(2*a),1.41*r*Math.sin(a)+.16*Math.cos(2*a)];
  });
  const well=Array.from({length:54},(_,i)=>{
    const a=TAU*i/54,r=1+.15*Math.cos(3*a+.74);
    return [.39+.60*r*Math.cos(a),.065+.41*r*Math.sin(a)];
  });
  const {sd:field}=P.construct.profile([outline,well]);
  const bounds={min:[-3.09,-1.98],max:[3.07,1.99]}, n=8;
  const specs=Array.from({length:n},(_,i)=>({
    id:'stratum-'+i,low:.35+.159*i,high:.35+.159*i+.132,cut:{level:.121-.068*i}
  }));
  const strata=P.fabrication.stack({bounds,field,layers:specs,segments:[86,61]});
  const chroma=[
    [[19,53,66],[76,133,144]],[[26,48,67],[103,136,167]],[[43,42,66],[123,126,166]],
    [[62,46,68],[157,122,142]],[[79,52,65],[177,124,128]],[[107,65,69],[197,142,127]],
    [[124,78,67],[206,159,128]],[[128,87,64],[222,183,133]]
  ];
  const records=[];
  const spanY=a=>.016+.229*(.5-.5*Math.cos(a))**1.30;
  for(const [i,row] of strata.entries()){
    const first=records.at(-1)?.end??0, [dark,lit]=chroma[i], level=specs[i].cut.level;
    let count=0;
    for(const name of ['inner','wall','outer']){
      const surface=row.surface(name);
      count+=surface.triangles.length;
      const w=name==='outer'?204:32,h=name==='outer'?126:24;
      sprites.mesh(surface,w,h,(x,y)=>{
        const u=x/(w-1),v=y/(h-1),noise=K.hash(i,x,y);
        if(name==='inner')return hex(mix(dark,lit,.17+.24*noise));
        if(name==='wall'){
          const edge=(v<.09?.34:v>.86?-.20:0), pores=.075*Math.cos(x*2.9+y*.34);
          return hex(mix(dark,lit,.39+.24*(1-v)+edge+.12*noise+pores));
        }
        const X=bounds.min[0]+(bounds.max[0]-bounds.min[0])*u,Z=bounds.min[1]+(bounds.max[1]-bounds.min[1])*v;
        const gap=level-field(X,Z), etched=.082*Math.cos(gap*171+u*2), corner=.28*Math.exp(-(((gap-.034)/.016)**2));
        return hex(mix(dark,lit,.47+.21*(1-v)+.13*noise+etched+corner));
      });
    }
    const paths=P.contours.march(field,{bounds,cell:.036,iso:level}).filter(p=>p.closed).map(({points})=>
      K.curve.path(points.map(([x,z])=>[x,row.high+.039,z]),{closed:true}));
    records.push({first,end:first+count,paths});
  }
  const paint=K.frameSplats(B,204,(draw,_dt,t)=>{
    const a=angle(t), height=spanY(a), glow=[1,.76,.48];
    for(const [i,{paths}] of records.entries())for(const [j,path] of paths.entries()){
      const d=((a/TAU+i*.086+j*.21)%1)*path.length, p=V.mad(path.frame(d).p,[0,1,0],height*i);
      draw.point(p,{width:.029,density:1.16,rgb:glow,depth:true});
      for(let k=0;k<4;k++){
        const from=V.mad(path.frame(d-.070*k).p,[0,1,0],height*i);
        const to=V.mad(path.frame(d-.070*(k+1)).p,[0,1,0],height*i);
        draw.streak(from,to,{width:.031+.002*k,density:.81-.15*k,rgb:glow,depth:true});
      }
    }
  });
  let initial,last=-1;
  function update(SpriteSurface,atlas,t){
    const k=phase(t);
    if(k===last)return;
    const length=records.at(-1).end, a=angle(t), height=spanY(a);
    initial??=Float32Array.from({length},(_,i)=>atlas.vertices[i*5+1]);
    for(const [j,{first,end}] of records.entries()){
      for(let i=first;i<end;i++)atlas.vertices[i*5+1]=initial[i]+height*j;
    }
    SpriteSurface.markGeometryDirty(atlas,{first:0,count:length});
    last=k;
  }
  return {paint,update};
}

module.exports=({KIT:K,makeBuilder,makeSculpt,SpriteSurface})=>({
  id:'field-fabrication-studies',name:'Reaction Lantern and Contour Stack',seed:36,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'lantern', light=study==='lantern';
    if(!light&&study!=='stack')throw new RangeError('Choose lantern or stack');
    const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024);
    Object.assign(S,{pixel:true,amb:.32,sky:.14,sunK:.76,sun:K.V.norm([-.52,.75,.47])});
    const depth=light?2.57:2.26, origin=light?.17:.06;
    S.box([0,-.11,origin],[4.31,.145,depth+.075],iron,{res:.139,rd:.114});
    S.box([0,.074,origin],[4.22,.032,depth+.025],bronze,{res:.108,rd:.072});
    S.box([0,.144,origin],[4.17,.065,depth],slate,{res:.116,rd:.098});
    const scene=(light?lantern:contourStack)(K,B,S,sprites);
    const font=K.inspection.font({}), title=light?'REACTION LANTERN':'CONTOUR STACK';
    const chars=[...title].map(c=>font.get(c)), w=chars.length*6+18;
    sprites.face([-1.49,-.03,origin+depth+.095],[2.98,0,0],[0,.245,0],w,11,(i,j)=>{
      if(!i||!j||i===w-1||j===10)return 0xa97855;
      const x=i-9,y=j-2;
      return x>=0&&y>=0&&y<7&&chars[Math.floor(x/6)]?.[y*6+x%6]?0xffdaa1:0x151f2e;
    });
    for(const sign of [-1,1])for(let i=0;i<8;i++)
      S.box([3.99*sign,light?.321:.227,-1.81+i*.545],[.038,.025,.042],i%3?teal:bronze,{res:.057});
    S.bake();
    const atlas=sprites.finish(), world=B.finish({cam:light
      ?{target:[0,1.22,.14],dist:11.95,fov:.60,yaw:-.13,pitch:.48,sway:0}
      :{target:[0,1.22,.06],dist:12.38,fov:.60,yaw:-.23,pitch:.55,sway:0},
      spriteSurfaces:atlas,detail:23,dither:.044,radius:8,look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    stage.add({update(_dt,t){scene.update(SpriteSurface,atlas,t);}});
    const {paint}=scene;
    paint.post=(_dt,_t,active)=>{
      for(let i=paint.first;i<paint.first+paint.count;i++){
        const q=16*i,D=active.D;
        if(!D[q+3]&&(D[q]||D[q+2])){D[q]=D[q+2]=0;active.touch(i);}
      }
    };
    stage.add(paint);
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
});
