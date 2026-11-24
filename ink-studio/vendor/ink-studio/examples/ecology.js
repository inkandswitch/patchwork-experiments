/* One habitat state drives textured terrain, splat plants, lights and recovery. */
function ecologyScene({makeBuilder,makeSculpt,KIT:K,TexturedSurface,SpriteSurface}){
  return {id:'ecology',name:'The remembering garden',seed:83,build(seed){
    const {V}=K,palette=[0x112a2d,0x21443f,0x39634c,0x62874e,0x91a45b,0xc6c98b,
      0x3b4442,0x65736b,0x9eaa97,0xd4d7b8,0x57452d,0x8d7045,0xc79d5c,0xf0ce83,
      0x174b55,0x287381,0x69a6a1,0xb1c8ae,0xe78c39,0xffcb60,0x6f3733,0xa65c44];
    const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B)),trees=[[-4.8,-2.7,2.8],[-5.2,1.4,2.2],[-2.3,2.8,2.6],[2.4,2.1,2.5],[5.1,.2,2.9],[4.7,3.3,2.0]];
    const terrain=TexturedSurface.heightfield({bounds:[-7,7,-5,5],segments:[40,30],height:(x,z)=>.18+.36*Math.exp(-((x+4)**2+(z+2)**2)/9)+.08*Math.sin(x*.5)*Math.cos(z*.7)});
    const pond=(x,z)=>Math.hypot((x-3.6)/1.5,(z+2.3)/1.25)<1;
    const material=(x,z)=>Math.abs(x)<.9?'stone':pond(x,z)?'water':trees.some(([a,b])=>Math.hypot(x-a,z-b)<.8)?'wood':'meadow';
    S.pixel=true;S.pixelSize(18);S.sun=V.norm([-.62,.82,.5]);S.amb=.35;S.sky=.24;S.sunK=.78;S.aoK=.3;
    S.terrain({r:[0,1,2]},{x0:-7,x1:7,z0:-5,z1:5,h:(x,z)=>terrain.height(x,z)-.08,res:.3});
    const atlas=SpriteSurface.make(192);atlas.mesh(terrain,192,144,(i,j)=>{
      const x=-7+14*i/191,z=5-10*j/143,kind=material(x,z),noise=K.hash(i,j,seed);
      if(kind==='stone'){const joint=(i%5===0)||(j%8===0);return palette[joint?6:noise>.8?8:7];}
      if(kind==='water')return palette[(i+j*3)%17===0?16:noise>.6?15:14];
      const tone=noise>.92?5:noise>.68?4:noise>.36?3:2;return palette[tone];
    });
    for(const [a,b]of [[[-7,-5],[7,-5]],[[7,-5],[7,5]],[[7,5],[-7,5]],[[-7,5],[-7,-5]]]){
      const edge=TexturedSurface.grid({segments:[28,1],point:(u,v)=>{const x=a[0]+(b[0]-a[0])*u,z=a[1]+(b[1]-a[1])*u;return [x,terrain.height(x,z)*(1-v)-.6*v,z];}});
      atlas.mesh(edge,192,10,(i,j)=>palette[j>7?0:j%3===0?6:1]);
    }
    const groundAtlas=atlas.finish();
    const stone=K.pixel.masonry({r:[6,7,8,9],joint:1,stone:[7,5],seed:31}),bark={r:[6,10,11,12]};
    for(const x of [-.75,.75])for(let j=0;j<11;j++)S.box([x,terrain.height(x,-4.7+j*.91)+.1,-4.7+j*.91],[.13,.13,.34],stone,{res:.10,rd:.04});
    for(let i=0;i<13;i++){
      const a=i*Math.PI*2/13,x=3.6+1.56*Math.cos(a),z=-2.3+1.3*Math.sin(a);
      S.rock([x,terrain.height(x,z)+.09,z],[.25,.17,.22],{r:[6,7,8]},{res:.09});
    }
    const trunks=[],leaves=[];
    const previous=S.emit;S.emit=(pr,first,end)=>{previous?.(pr,first,end);if(pr.tag==='wood')for(let i=first;i<end;i++)trunks.push(i);};
    const crowns=trees.map(([x,z,h],i)=>{const tree=K.grow.branch({at:[x,terrain.height(x,z)-.03,z],len:h*.58,r:h*.055,depth:2,forks:3,segs:4,spread:.67,shrink:.68,droop:.09,seed:seed+i*31});K.grow.limbs(S,tree,bark,{res:.085,tag:'wood'});return {x,z,h,tree};});
    S.bake();
    function leaf(a,b,width,tone){const before=B.count(),dir=V.norm(V.sub(b,a)),normal=V.norm(V.cross(dir,V.perp(dir))),length=V.dist(a,b);
      for(let j=0;j<3;j++){const t=(j+.5)/3,p=V.lerp(a,b,t);B.dab(...p,normal,dir,length*.18,width*Math.sin(Math.PI*t),.006,B.P[Math.min(5,tone+(j===2?1:0))],2.4);}
      for(let i=before;i<B.count();i++)leaves.push(i);
    }
    for(const {h,tree}of crowns)for(const [j,tip]of tree.tips.entries())for(const f of K.grow.arrange('spiral',23,{r:h*.18,dome:.74})){
      const q=K.grow.put(f,tip.p,j*.83,1),out=V.norm(V.add(f.dir,V.mul(tip.dir,.6))),size=h*(.10+K.hash(j,Math.round(f.t*27),17)*.045);
      const end=V.add(V.mad(q.p,out,size),[0,-size*.25,0]);leaf(q.p,end,size*.23,V.dot(out,S.sun)>.1?4:3);
    }
    for(let i=0;i<1150;i++){
      const x=-6.7+K.hash(i,1,9)*13.4,z=-4.7+K.hash(i,3,8)*9.4;if(['stone','water'].includes(material(x,z)))continue;
      const y=terrain.height(x,z)+.02;
      for(let j=0;j<4;j++){const a=i*2.399+j*1.67,h=.11+K.hash(i,j,7)*.19,tip=[x+Math.cos(a)*h*.35,y+h,z+Math.sin(a)*h*.35];leaf([x,y,z],tip,.026,j>1?3:2);}
      if(i%37===0){const id=B.count();for(let k=0;k<5;k++){const a=k*Math.PI*2/5;B.dab(x+Math.cos(a)*.045,y+.23,z+Math.sin(a)*.045,[0,1,0],[Math.cos(a),0,Math.sin(a)],.048,.032,.008,B.P[k%2?13:12],2.5);}for(let j=id;j<B.count();j++)leaves.push(j);}
    }
    const foliage=new Set([...trunks,...leaves]),scenery=Array.from({length:B.count()},(_,i)=>i).filter(i=>!foliage.has(i));
    const sim=K.ecology.create({width:28,height:20,cellSize:.5,origin:[-7,-5],heightAt:terrain.height,
      materials:{meadow:{fuel:.65},wood:{fuel:1},stone:{fuel:0},water:{fuel:0,moisture:1}},materialAt:material,
      environment:{wx:.45,wz:.14},processes:[K.ecology.processes.fire({seed}),K.ecology.processes.diffusion({id:'soil-water',field:'moisture',rate:.12}),
        {id:'new-growth',channels:{growth:{}},step(ctx,h){for(let i=0;i<ctx.count;i++)if(ctx.initial('fuel',i)>0&&ctx.read('moisture',i)>.35&&ctx.read('burning',i)<.1){
          ctx.add('growth',i,h*.06);ctx.add('char',i,-h*.065);ctx.set('fuel',i,Math.min(ctx.initial('fuel',i),ctx.read('fuel',i)+h*.035));}}}]});
    const flames=K.frameSplats(B,360,(draw,dt,time)=>{
      let count=0;
      for(let i=0;i<sim.count&&count<120;i++)if(sim.read('burning',i)>.5){
        const p=sim.point(i),phase=time*7+i*2.4,h=.2+.23*(.5+.5*Math.sin(phase));
        for(let j=0;j<3;j++){const a=j*2.4,q=V.add(p,[Math.cos(a)*.08,.03,Math.sin(a)*.08]),tip=V.add(q,[.055*Math.sin(phase+j),h*(1-j*.18),.02]);
          draw.streak(q,tip,{width:.017+j*.004,color:j===0?19:18,density:1.7,emissive:true,depth:true});}count++;
      }
    });
    const W=B.finish({spriteSurfaces:groundAtlas,cam:{target:[0,1.0,0],dist:24,yaw:.49,pitch:.57},detail:20,dither:.1,radius:11,look:{pixel:true,native:true}}),stage=K.stage(W);
    stage.add(sim);
    const char={field:'char',color:[.055,.07,.065]},wet={field:'moisture',color:[.10,.24,.22],weight:.26};
    const binding=stage.add(K.ecology.bind(stage,sim,{lights:{max:6,radius:2.5,intensity:.85},
      splats:[{ids:scenery,style:[wet]},{ids:trunks,style:[char,wet]},{ids:leaves,style:[{...char,opacity:.07},wet,{field:'growth',color:[.38,.57,.27],weight:.2}]}],
      textures:[{atlas:groundAtlas,style:[char,wet,{field:'growth',color:[.24,.39,.23],weight:.2}]}]}));
    stage.add(flames);stage.update(0,0);
    let saved;
    W.ecologyDemo={sim,binding,terrain,material,ignite(){sim.contact({type:'ignite',p:[-4.25,0,1.25],radius:.65});},
      water(){sim.contact({type:'water',p:[-3.5,0,.5],radius:3.8,values:{moisture:1,heat:0}});},
      seedMoss(){sim.contact({type:'plant',p:[-3.5,0,.5],radius:3.8,values:{moisture:.8,growth:.5}});},
      reset(){sim.reset();stage.update(0,stage.time);},save(){saved=JSON.parse(JSON.stringify(sim.snapshot()));},restore(){if(saved){sim.restore(saved);stage.update(0,stage.time);}},
      advance(seconds){for(let t=0;t<seconds-1e-8;t+=.05)stage.update(.05,stage.time+.05);}
    };
    return W;
  }};
}
if(typeof module==='object')module.exports=ecologyScene;
