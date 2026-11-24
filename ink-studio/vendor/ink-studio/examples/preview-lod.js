module.exports=({makeBuilder,makeSculpt,SplatProvenance,KIT:K})=>({
  id:'preview-lod',
  name:'Original and reduced splat shields',
  seed:11,
  build(seed){
    const palette=[
      0x17262c,0x303c42,0x4b5656,0x6d7367,0x929181,
      0x263e44,0x385b61,0x568184,0x7a9f96,0xa0b8a2,
      0x503a39,0x7d5144,0xad7454,0xd5a16d,0xecc18a,
      0x56604e,0x87866b,0xa0a186
    ], B=makeBuilder(16,palette),S=K.sculpt(makeSculpt(B)),L=K.procedural.lod,V=K.V;
    const samples=[], step=0.038, direction=V.norm([0.57,0.44,0.92]),
      rgb=(hex)=>[hex>>16,(hex>>8)&255,hex&255].map(v=>v/255),
      outline=(x,y)=>Math.hypot(x/(0.92-0.25*Math.max(0,-y)**1.6),y/1.05);
    for(let iy=0;iy<56;iy++)for(let ix=0;ix<52;ix++){
      const x=(ix-25.5)*step,y=(iy-27.5)*step,d=outline(x,y);
      if(d>1)continue;
      const z=0.27+0.38*(1-x*x)-0.116*y*y,
        n=V.norm([0.76*x,0.232*y,1]),
        motif=Math.abs(x*1.3)+Math.abs(y-0.24)*0.91,
        band=d>0.86||(motif>0.255&&motif<0.38)||Math.abs(x)<0.134&&y<-0.14&&y>-0.61,
        shade=0.54+0.38*Math.max(0,V.dot(n,direction)),
        pick=palette[(band?10:5)+Math.min(4,Math.floor(shade*4.3))],
        tex=0.92+0.07*K.hash(ix,iy,seed);
      samples.push({id:'stroke/'+ix+'/'+iy,position:[x,y+1.16,z],normal:n,radius:0.041,
        color:rgb(pick).map(v=>v*tex),opacity:0.71,owner:'shield',material:band?'clay':'glaze',surface:'shield-face',protect:d>0.948});
    }
    const options={maxDistance:0.091,maxRadius:0.14,minNormal:0.96,maxColor:0.1,
      viewDirections:[[0,0.21,1]],lockSeams:true},
      left=L.mergeSplats(samples,{...options,ratio:1}),
      right=L.mergeSplats(samples,{...options,ratio:0.46});
    const row=[];
    for(const [i,{splats}] of [left,right].entries()){
      const x=i?1.37:-1.37;
      S.box([x,-0.015,0],[1.08,0.11,0.78],{r:[1,2,3,4]},{rd:0.087,res:0.074});
      S.box([x,0.153,0.14],[0.61,0.082,0.41],{r:[15,16,17]},{rd:0.034,res:0.071});
      const owner=i?'reduced-shield':'original-shield';
      for(const p of splats)row.push({...p,id:owner+'/'+p.id,owner,position:[p.position[0]+x,p.position[1],p.position[2]]});
    }
    S.bake();
    const world=B.finish({cam:{target:[0,1.03,0],dist:7.45,pitch:0.23,yaw:0.075},detail:20,radius:3.3,dither:0.13});
    return SplatProvenance.join([world,L.packSplats(row)],world);
  }
});
