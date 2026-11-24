const DURATION=6.4,FPS=10,FRAME_COUNT=Math.round(DURATION*FPS),TAU=2*Math.PI;
const palette=[0x111827,0x253447,0x405768,0x627d87,0xa8afa1,0x201e32,0x4e394d,0x845259,
  0xb87860,0xe8aa76,0xffd59e,0x182d37,0x2b5861,0x398589,0x6cad9d,0xa5dac0,0xd6eacb,
  0x3b314c,0x655274,0x958094,0x9e5c58,0xd89371];
const iron={r:[0,0,1,2]},steel={r:[1,2,3,4]},brass={r:[5,6,7,8,9,10]},jade={r:[11,12,13,14,15]},lamp={r:[13,14,15,16],em:true};
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,f)=>a.map((n,i)=>n+(b[i]-n)*clamp(f));

function studio(kit,seed){
  const {KIT:K,makeBuilder,makeSculpt,SpriteSurface,TexturedSurface}=kit;
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),sprites=SpriteSurface.make(1024),font=K.inspection.font({});
  Object.assign(S,{pixel:true,amb:.35,sky:.16,sunK:.82,sun:K.V.norm([-.49,.77,.39])});
  const box=(p,r,mat,res=.087,rd=.066)=>S.box(p,r,mat,{res,rd});
  function label(text,[x,y,z],span,color){
    const columns=text.length*6,h=span*7/columns,letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],[0,0,-h],columns,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?color:undefined);
  }
  function finish(cam,draw){
    S.bake();
    const atlas=sprites.finish();
    const world=B.finish({cam,radius:7,detail:23,dither:.042,spriteSurfaces:atlas,
      look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    let previous=-1;
    stage.add({update(_dt,time){
      const t=((time%DURATION)+DURATION)%DURATION,index=Math.min(FRAME_COUNT-1,Math.floor(t*FPS+1e-7));
      if(previous===index)return;
      draw(atlas,index);
      previous=index;
    }});
    stage.stateful=false;
    stage.update(0,0);
    return world;
  }
  return {K, S, box, label, sprites, SpriteSurface, TexturedSurface, finish};
}

function ceramic(K){
  const n=48,rings=10,points=[],triangles=[];
  for(let j=0;j<=rings;j++)for(let i=0;i<n;i++){
    const w=j/rings,a=i*TAU/n,r=.58+1.68*w;
    points.push([r*Math.cos(a),.56+1.10*w**1.73+w**3*(.117*Math.sin(a*6)+.026*Math.cos(9*a+.33)),r*Math.sin(a)]);
    if(j===rings)continue;
    const A=j*n+i,B=j*n+(i+1)%n,C=A+n,D=B+n;
    triangles.push([A,B,C],[C,B,D]);
  }
  const pins=Array.from({length:n*2},(_,i)=>i);
  const growth=K.procedural.growth.differential.shell({points,triangles,pins,clearance:.105,tether:.058,smooth:.162,
    stiffness:.88,iterations:4,bounds:{min:[-4,.38,-4],max:[4,4.5,4]},rate:({rest,edge,tick})=>{
      const r=Math.hypot(rest[0],rest[2]),w=clamp((r-.72)/1.52),a=Math.atan2(rest[2],rest[0]);
      const around=Math.floor(edge[0]/n)===Math.floor(edge[1]/n)?1:.54;
      return .0016+w**2*(.031+.007*Math.cos(a*3-.24)+.003*Math.sin(a*5+tick*.055))*around;
    }});
  return {growth,n,rings};
}

function bloom(set){
  const {K,S,box,label,sprites,SpriteSurface,TexturedSurface,finish}=set,V=K.V;
  const {growth,n:controlCount,rings:controlRings}=ceramic(K),sequence=[];
  for(let i=0;i<=54;i++){
    if(i)growth.step();
    sequence.push(growth.frame().points);
  }
  const n=2*controlCount,rings=2*controlRings;
  const index=(u,v)=>v*n+((u%n)+n)%n;
  // Use a periodic cubic surface for the glaze preview. The solver retains the control mesh.
  const kernel=t=>[(1-t)**3,4-6*t*t+3*t**3,1+3*t+3*t*t-3*t**3,t**3].map(w=>w/6);
  const samples=Array.from({length:n*(rings+1)},(_,i)=>{
    const u=i%n/2,v=Math.floor(i/n)/2,a=Math.floor(u),b=Math.floor(v),width=kernel(u-a),depth=kernel(v-b);
    const stencil=[];
    for(let z=0;z<4;z++)for(let x=0;x<4;x++){
      const col=(a+x-1+controlCount)%controlCount,row=Math.max(0,Math.min(controlRings,b+z-1));
      stencil.push([row*controlCount+col,width[x]*depth[z]]);
    }
    return stencil;
  });
  const subdivide=points=>samples.map(stencil=>{
    const out=[0,0,0];
    for(const [j,w] of stencil)for(let k=0;k<3;k++)out[k]+=w*points[j][k];
    return out;
  });
  const rest=subdivide(sequence[0]);
  const chart=TexturedSurface.grid({segments:[n,rings],point:(u,v)=>rest[index(Math.round(u*n),Math.round(v*rings))]});
  const source=Int32Array.from(chart.triangles,i=>index(i%(n+1),Math.floor(i/(n+1))));
  const dims=[192,92],region=sprites.reserve(...dims),image=new Uint8Array(dims[0]*dims[1]*4);
  sprites.meshRegion(chart,region);
  box([0,-.047,.10],[4.28,.222,3.27],steel,.128,.112);
  box([0,.205,.04],[4.12,.059,3.12],iron,.100,.100);
  const pedestal={r:[1,2,3,4]};
  S.lathe([0,.29,0],.19,[1.29,1.31,1.225,.91],pedestal,{res:.085});
  S.lathe([0,.429,0],.105,[.925,.902,.871],brass,{res:.069});
  S.lathe([0,.491,0],.068,[.743,.717,.690],jade,{res:.065});
  for(const side of [-1,1]){
    box([side*3.77,.338,.17],[.126,.085,2.68],jade,.082,.067);
    for(let j=0;j<12;j++)box([side*3.77,.466,-2.40+j*.47],[.037,.023,.024],j%4?steel:lamp,.035,.031);
  }
  box([0,.357,2.871],[1.31,.086,.169],iron,.071);
  label('GLAZE BLOOM',[0,.505,3.011],2.18,0xffdda5);
  for(const x of [-2.78,2.78]){
    box([x,.304,2.780],[.43,.052,.106],brass,.061,.049);
    for(let j=0;j<6;j++)box([x+.117*(j-2.5),.400,2.782],[.020,.017,j%3?.037:.063],j%3?jade:lamp,.035,.020);
  }
  const light=V.norm([-.43,.83,.36]),view=V.norm([-.19,.61,.76]),half=V.norm(V.add(light,view));
  function draw(atlas,k){
    const now=subdivide(sequence[Math.min(54,k)]),normals=now.map((_,i)=>{
      const u=i%n,v=Math.floor(i/n);
      return V.norm(V.cross(V.sub(now[index(u+1,v)],now[index(u-1,v)]),
        V.sub(now[index(u,Math.min(rings,v+1))],now[index(u,Math.max(0,v-1))])));
    });
    for(let i=0;i<source.length;i++)atlas.vertices.set(now[source[i]],i*5);
    SpriteSurface.markGeometryDirty(atlas,{first:0,count:source.length});
    for(let y=0,i=0;y<dims[1];y++)for(let x=0;x<dims[0];x++,i+=4){
      const u=(x+.5)/dims[0],v=(y+.5)/dims[1],a=u*n,b=v*rings;
      const c=Math.floor(a),r=Math.min(rings-1,Math.floor(b));
      const n0=V.lerp(normals[index(c,r)],normals[index(c+1,r)],a-c);
      const n1=V.lerp(normals[index(c,r+1)],normals[index(c+1,r+1)],a-c);
      const normal=V.norm(V.lerp(n0,n1,b-r)),facing=V.dot(normal,view);
      const lit=facing<0?V.mul(normal,-1):normal;
      const tone=clamp(.31+.72*V.dot(lit,light));
      const rim=clamp((v-.91)*15),glint=clamp(V.dot(lit,half))**16;
      const hue=.48+.17*Math.cos(TAU*(u*8.0-.34*v))+.12*Math.sin(v*39+u*TAU);
      const tint=mix([24,73,82],[62,153,147],hue);
      const base=mix([20,30,50],tint,.30+.70*tone);
      const bright=mix(base,[150,215,186],.43*tone+.45*glint);
      const clay=mix([105,60,69],[249,184,127],.31+.60*tone+.17*glint);
      const edge=mix(bright,clay,rim);
      const speck=(x*19+y*29)%61===0?.115:0;
      image.set(mix(edge,[237,231,183],speck+.21*glint),i);
      image[i+3]=255;
    }
    SpriteSurface.update(atlas,region,{w:dims[0],h:dims[1],rgba:image});
  }
  return finish({target:[0,.86,.40],dist:13.91,fov:.568,yaw:-.22,pitch:.755,sway:0},draw);
}

function stroke(K,seed){
  const points=[],count=49;
  for(let i=0;i<count;i++){
    const t=i/(count-1)*2-1;
    points.push([2.41*Math.sin(Math.PI*1.1*t),.392,1.80*t]);
  }
  return K.procedural.growth.differential.curve({points,plane:'xz',pins:[0,count-1],clearance:.198,
    tether:.035,smooth:.058,stiffness:.91,bounds:{min:[-3.89,.392,-2.18],max:[3.89,.392,2.18]},
    splitLength:.247,perturbation:.035,iterations:4,seed,
    rate:({rest,tick})=>.014+.016*(.5+.5*Math.cos(rest[0]*2.5+rest[2]*3.1-.025*tick))+.005*Math.abs(rest[0])});
}

function labyrinth(set,seed){
  const {K,S,box,label,sprites,SpriteSurface,finish}=set,run=stroke(K,seed),frames=[];
  for(let i=0;i<=62;i++){
    if(i)run.step();
    frames.push(run.frame().points);
  }
  const plan=[8.22,4.55],dims=[262,146],cellX=plan[0]/dims[0],cellZ=plan[1]/dims[1];
  const left=-plan[0]/2,back=-plan[1]/2,region=sprites.reserve(...dims),rgba=new Uint8Array(dims[0]*dims[1]*4);
  sprites.faceRegion([left,.392,-back],[plan[0],0,0],[0,0,-plan[1]],region);
  box([0,-.055,.08],[4.42,.217,2.67],steel,.127,.112);
  box([0,.183,.043],[4.30,.069,2.55],iron,.099,.087);
  for(const side of [-1,1]){
    box([0,.38,side*2.366],[4.22,.079,.085],steel,.082);
    box([side*4.20,.380,0],[.092,.081,2.39],jade,.080);
    for(let j=0;j<13;j++)box([-3.91+j*.65,.477,side*2.369],[.023,.019,.031],j%4?steel:brass,.038,.026);
  }
  for(const [x,,z] of [frames[0][0],frames[0].at(-1)]){
    S.lathe([x,.407,z],.067,[.134,.119,.084],brass,{res:.050});
    S.ball([x,.492,z],.051,lamp,{res:.040});
  }
  box([0,.369,2.492],[1.37,.084,.172],iron,.075);
  label('INK LABYRINTH',[0,.521,2.617],2.23,0xffd9a3);
  const distance=new Float64Array(dims[0]*dims[1]),along=new Float64Array(distance.length),halo=.114;
  function draw(atlas,k){
    const nodes=frames[Math.min(62,Math.round(k*1.16))];
    distance.fill(Infinity);
    for(let j=0;j<nodes.length-1;j++){
      const [x,,z]=nodes[j],[u,,v]=nodes[j+1],dx=u-x,dz=v-z,length=dx*dx+dz*dz;
      const loX=Math.max(0,Math.floor((Math.min(u,x)-halo-left)/cellX)),hiX=Math.min(dims[0]-1,Math.floor((Math.max(u,x)+halo-left)/cellX));
      const loZ=Math.max(0,Math.floor((Math.min(v,z)-halo-back)/cellZ)),hiZ=Math.min(dims[1]-1,Math.floor((Math.max(v,z)+halo-back)/cellZ));
      for(let r=loZ;r<=hiZ;r++)for(let c=loX;c<=hiX;c++){
        const px=left+(c+.5)*cellX-x,pz=back+(r+.5)*cellZ-z;
        const at=length?clamp((px*dx+pz*dz)/length):0,dist=Math.hypot(px-at*dx,pz-at*dz),i=r*dims[0]+c;
        if(dist>=distance[i])continue;
        distance[i]=dist;along[i]=(j+at)/(nodes.length-1);
      }
    }
    for(let r=0,i=0;r<dims[1];r++)for(let c=0;c<dims[0];c++,i++){
      const p=distance[i],s=along[i],grid=(c%19===0||r%15===0);
      const ground=grid?[28,43,58]:[17,28,43],dim=mix(ground,[82,50,53],clamp((halo-p)*8.6));
      const heat=.59+.24*Math.sin(TAU*(s*3-.012*k))+.11*Math.cos(s*67);
      const ink=mix([126,62,61],[247,183,104],heat);
      const core=mix(ink,[255,226,151],clamp((.031-p)*25));
      rgba.set(mix(dim,core,clamp((.060-p)*62)),4*i);rgba[4*i+3]=255;
    }
    SpriteSurface.update(atlas,region,{w:dims[0],h:dims[1],rgba});
  }
  return finish({target:[0,.22,.23],dist:13.23,fov:.556,yaw:-.13,pitch:1.055,sway:0},draw);
}

module.exports=kit=>({
  id:'differential-growth-studies',name:'Glaze Bloom and Ink Labyrinth',seed:81,duration:DURATION,
  build(seed,{controls}={}){
    const study=controls?.study??'bloom';
    if(!['bloom','labyrinth'].includes(study))throw new RangeError('Choose bloom or labyrinth');
    const set=studio(kit,seed);
    return study==='bloom'?bloom(set):labyrinth(set,seed);
  }
});
