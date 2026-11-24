module.exports = ({makeBuilder,makeSculpt,KIT:K}) => ({
  id:'adaptive-surface',
  name:'A continuous form with two voxel levels',
  seed:0,
  build(seed){
    const B=makeBuilder(20,[
      0x17252b,0x313e42,0x4c5a59,0x65706a,0x8e9280,
      0x514443,0x7b574e,0xa6755e,0xbd8968,0xe9b78a,
      0x29464c,0x406b70,0x5d9394,0x82af9e,0xb3c7a8,
      0x6d4c35,0x9d714b,0xca9a62,0xefd69c
    ]),S=K.sculpt(makeSculpt(B)),G=K.procedural.geometry,
      center=[0,0.83,0],
      sd=(x,y,z)=>Math.hypot(Math.hypot(x,z)-1.2,(y-center[1])*(0.95+0.08*Math.cos(z*2.9)))-0.44,
      bounds={min:[-1.8,0.23,-1.85],max:[1.8,1.43,1.85]},
      extracted=G.adaptiveSurface(sd,bounds,{
        minDepth:2,maxDepth:5,surfaceDepth:([x])=>x<0?5:3,tolerance:0.09,variation:0.75
      }),line=seed%2===1;
    S.box([0,-0.05,0],[1.91,0.21,1.93],{r:[1,2,3,4]},{rd:0.14,res:0.089});
    S.add({bc:center,br:2.04,sd,sample(emit){
      for(const p of extracted.points)emit(...p);
      for(const {indices} of extracted.faces){
        if(indices.every(i=>extracted.cells[i].depth>=5))continue;
        emit(...indices.reduce((p,i)=>K.V.mad(p,extracted.points[i],1/indices.length),[0,0,0]));
      }
    }},{
      r:[10,11,12,13,14],
      rf(x,y,z){return extracted.tree.lookup(x,y,z)?.depth>=5?[5,6,7,8,9]:null;}
    },{res:0.118,reach:0.075});
    if(line)for(const {indices,transition} of extracted.faces){
      if(!transition)continue;
      for(const [i,a] of indices.entries()){
        const b=indices[(i+1)%indices.length];
        if(extracted.cells[a].depth===extracted.cells[b].depth)continue;
        const u=K.V.mad(extracted.points[a],extracted.normals[a],0.035),
          v=K.V.mad(extracted.points[b],extracted.normals[b],0.035);
        if(K.V.dist(u,v)<0.015)continue;
        S.tube([u,v],0.016,0.016,{r:[15,16,17,18]},{res:0.039});
      }
    }
    S.bake();
    return B.finish({cam:{target:[0,0.61,0],dist:6.4,pitch:0.83,yaw:0.16},detail:20,dither:0.16,radius:2.72});
  }
});
