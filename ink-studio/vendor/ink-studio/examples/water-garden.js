/* Live scene captures on the existing column water; optional atlas terrain among SDF splats. */
function waterGarden({makeBuilder,makeSculpt,KIT:K,TexturedSurface,SpriteSurface}){
  return {id:'water-garden',name:'The three reflecting gardens',seed:61,build(seed){
    const {V}=K,palette=[0x101e25,0x263e3c,0x3d5e4c,0x648369,0x99af86,0xd1d7ac,
      0x263c47,0x4b6470,0x829296,0xc4c4ae,0x423d36,0x776143,0xb68e59,0xe6bf76,0xffd591,0xfff2c6,
      0x183e4c,0x24596a,0x4a8890,0x87b9b4,0x724c49,0xac7461];
    const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B));
    S.pixel=true;S.pixelSize(22);S.sun=V.norm([-.65,.8,.35]);S.amb=.32;S.sky=.23;S.sunK=.78;S.aoK=.3;
    const pools=[{id:'west',x:-3.05,z:.35,rx:2.4,rz:2.05,y:0},{id:'east',x:2.8,z:.6,rx:1.95,rz:1.65,y:.3},
      {id:'spring',x:1.9,z:-3.15,rx:1.15,rz:.9,y:.95}];
    const radial=(p,x,z)=>Math.hypot((x-p.x)/p.rx,(z-p.z)/p.rz);
    const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
    const height=(x,z)=>{
      let y=.5+.16*Math.sin(x*.65)*Math.cos(z*.63)+.56*Math.exp(-((x-1.3)**2+(z+3.6)**2)/6);
      for(const p of pools){const q=radial(p,x,z);if(q<1.18){const bed=p.y-.74+1.05*smooth((q-.38)/.8);y=bed+(y-bed)*smooth((q-1.02)/.16);}}
      return y;
    };
    const terrain=TexturedSurface.heightfield({bounds:[-6.4,6.4,-5,4.2],segments:[100,76],height});
    const atlas=SpriteSurface.make(256);
    atlas.mesh(terrain,256,184,(i,j)=>{
      const x=-6.4+12.8*i/255,z=4.2-9.2*j/183,h=terrain.height(x,z),n=K.hash(i,j,seed);
      const p=pools.find(p=>radial(p,x,z)<1.13);
      if(p){const wet=h<p.y;return palette[wet?(n>.87?9:n>.45?7:6):(n>.8?9:n>.45?8:7)];}
      const path=Math.abs(x+.25+.25*Math.sin(z*.7))<.47;
      if(path)return palette[i%5===0||j%6===0?6:n>.75?9:8];
      return palette[n>.97?5:n>.80?4:n>.4?3:2];
    });
    for(const [a,b]of [[[-6.4,-5],[6.4,-5]],[[6.4,-5],[6.4,4.2]],[[6.4,4.2],[-6.4,4.2]],[[-6.4,4.2],[-6.4,-5]]]){
      atlas.mesh(TexturedSurface.grid({segments:[60,1],point:(u,v)=>{const x=a[0]+(b[0]-a[0])*u,z=a[1]+(b[1]-a[1])*u;return[x,height(x,z)*(1-v)-1.1*v,z];}}),192,12,(i,j)=>palette[j>8?0:j%3===0?6:1]);
    }
    const stone=K.pixel.masonry({r:[6,7,8,9],joint:1,stone:[7,5],seed}),wood={r:[10,11,12]};
    for(const p of pools)for(let i=0;i<34;i++){
      const a=i*Math.PI*2/34,x=p.x+Math.cos(a)*p.rx*1.05,z=p.z+Math.sin(a)*p.rz*1.05;
      S.rock([x,terrain.height(x,z)+.03,z],[.18+.06*K.hash(i,3,seed),.12,.14],stone,{res:.08});
    }
    const trees=[[-5.4,-2.5,2.8],[-3.8,-3.8,3.2],[-.8,-4.2,3.1],[4.9,-2.3,2.8],[5.3,2.9,2.3],[-5.6,3,2.1]];
    const crowns=trees.map(([x,z,h],i)=>{const tree=K.grow.branch({at:[x,terrain.height(x,z)-.03,z],len:h*.57,r:h*.046,depth:2,forks:3,segs:4,spread:.7,shrink:.68,droop:.07,seed:seed+i*17});K.grow.limbs(S,tree,wood,{res:.08});return {tree,h};});
    // A raised footbridge is actual geometry in both the view and the captures.
    for(let j=0;j<17;j++){const z=-1.75+j*.19,y=.65+.25*Math.sin(j/16*Math.PI);S.box([-.15,y,z],[.58,.07,.082],wood,{res:.07,rd:.025});}
    for(const x of [-.73,.43])for(let j=0;j<5;j++){const z=-1.7+j*.76,y=.68+.25*Math.sin(j/4*Math.PI);S.box([x,y+.37,z],[.055,.4,.055],wood,{res:.07});}
    for(const [x,z]of [[-4.8,-.3],[-1.4,-2.5],[4.3,-.7],[3.8,2.9]]){
      const y=terrain.height(x,z);S.box([x,y+.85,z],[.045,.85,.045],wood,{res:.07});
      S.box([x+.22,y+1.62,z],[.26,.035,.04],wood,{res:.07});S.box([x+.42,y+1.28,z],[.16,.2,.15],{r:[12,13,14],em:true},{res:.055,rd:.06});
      S.box([x+.42,y+1.51,z],[.2,.035,.19],stone,{res:.06});
    }
    S.bake();
    function leaf(a,b,width,color){const d=V.sub(b,a),len=V.len(d),dir=V.norm(d),normal=V.perp(dir);for(let j=0;j<3;j++){const t=(j+.5)/3,q=V.lerp(a,b,t);B.dab(...q,normal,dir,len*.20,width*Math.sin(Math.PI*t),.005,B.P[color],2.5);}}
    for(const {tree,h}of crowns)for(const [i,tip]of tree.tips.entries())for(const f of K.grow.arrange('spiral',21,{r:h*.18,dome:.75})){
      const q=K.grow.put(f,tip.p,i*.91,1),out=V.norm(V.add(f.dir,V.mul(tip.dir,.6))),size=h*(.12+K.hash(i,Math.round(f.t*30),3)*.05);
      leaf(q.p,V.add(V.mad(q.p,out,size),[0,-size*.15,0]),size*.23,V.dot(out,S.sun)>.2?4:3);
    }
    for(let i=0;i<1300;i++){
      const x=-6.2+K.hash(i,1,seed)*12.4,z=-4.8+K.hash(i,2,seed)*8.8,y=terrain.height(x,z);
      if(pools.some(p=>radial(p,x,z)<1.15)||Math.abs(x+.25+.25*Math.sin(z*.7))<.6)continue;
      for(let j=0;j<3;j++){const a=i*2.399+j*2.1,h=.13+.15*K.hash(i,j,7);leaf([x,y,z],[x+Math.cos(a)*h*.3,y+h,z+Math.sin(a)*h*.3],.023,j===1?4:3);}
      if(i%29===0)for(let j=0;j<5;j++){const a=j*Math.PI*2/5;B.dab(x+.045*Math.cos(a),y+.21,z+.045*Math.sin(a),[0,1,0],[Math.cos(a),0,Math.sin(a)],.05,.035,.005,B.P[j%2?14:15],2.6);}
    }
    const boatStart=B.count();
    for(let i=0;i<9;i++)B.disc(-.36+i*.09,.06,0,[0,1,0],.105,.022,B.P[i%3?12:11],2.6);
    for(let i=0;i<11;i++)B.iso(0,.08+i*.055,0,.022,B.P[11],2.6);
    for(let j=0;j<7;j++)for(let i=0;i<6;i++)B.iso(-.12+i*.048,.44+j*.045,0,.032,B.P[(i+j)%4?14:15],2.6,{em:true});
    const boatEnd=B.count();
    function water(distortion=2.5){return K.procedural.waterBodies.scene(pools.map(p=>K.procedural.waterBodies.create({id:p.id,
      bounds:{min:[p.x-p.rx*1.12,p.z-p.rz*1.12],max:[p.x+p.rx*1.12,p.z+p.rz*1.12]},resolution:[64,64],
      sample:(x,z)=>{const bed=terrain.height(x,z);return bed<p.y?{bed,surface:p.y,current:[.08,.03]}:null;},
      optics:{optical:{reflection:.24,scattering:.08,absorption:.28,scatteringColor:'#315c66',reflectionColor:'#e1efdd'},
        deepTint:[.08,.21,.27],depthRange:[.15,.9],surface:.65,foam:.20,refraction:1,caustics:.18,
        reflection:{plane:p.id,distortion,blur:.4}}})));}
    const W=B.finish({water:water(),reflections:pools.map(p=>K.reflection.plane({id:p.id,at:[0,p.y,0]})),spriteSurfaces:atlas.finish(),
      cam:{target:[0,.8,-.25],dist:23,yaw:.48,pitch:.62,ortho:true},radius:11,detail:24,dither:.08,look:{pixel:true,native:true}});
    const boatBase=W.data.slice(boatStart*16,boatEnd*16);
    W.waterDemo={pools,terrain,setDistortion(value){W.water=water(value);},update(t){const p=pools[0],a=t*.28,x=p.x+.85*Math.cos(a),z=p.z+.65*Math.sin(a),angle=-a+.3;
      for(let i=boatStart;i<boatEnd;i++){const o=i*16,b=(i-boatStart)*16,c=Math.cos(angle),s=Math.sin(angle);W.data[o]=x+boatBase[b]*c;W.data[o+1]=p.y+.05+boatBase[b+1]+.015*Math.sin(t*2);W.data[o+2]=z-boatBase[b]*s;}
    }};W.waterDemo.update(0);return W;
  }};
}
if(typeof module!=='undefined')module.exports=waterGarden;
