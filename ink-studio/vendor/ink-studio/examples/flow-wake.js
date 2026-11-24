module.exports=({makeBuilder,makeSculpt,KIT:K})=>({
  id:'flow-wake',
  name:'Streamlines around a river stone',
  seed:3,
  build(seed){
    const B=makeBuilder(28,[
      0x19282f,0x253f49,0x365862,0x487477,0x66918b,0x8ca99b,
      0x4c5345,0x69705b,0x888570,0xa99f80,0xc5b58a,
      0x354044,0x5e6961,0x80897b,0xaeb19a,
      0x6a5449,0x947358,0xbd9062,0xdeaf74,0xf4d49b,
      0x31514b,0x53766b,0x73947c,0x9eae88,
      0x8ab9a8,0xb1d1b8,0xcadbd0,0xe4e1bc
    ]),S=K.sculpt(makeSculpt(B)),{motion}=K.procedural,
      bed={r:[6,7,8,9,10]}, wet={r:[1,2,3,4,5]}, stone={r:[11,12,13,14]},
      canvas={min:[-4.26,-0.13,-1.77],max:[4.26,0.10,1.77]},
      rock=(x,y,z)=>Math.hypot(x+1.04,z-0.026)-0.64,
      lake=(x,y,z)=>Math.hypot(x/4.25,z/1.76)-1,
      time=0.61*seed,
      wake=motion.obstacleWake(rock,{origin:[-1.04,0.06,0.026],radius:0.64,
        flow:[0.88,0,0.045],length:4.66,width:0.55,circulation:1.17,eddies:5,period:3.8}),
      bounds={min:[-4.22,-0.2,-1.77],max:[4.22,0.2,1.77]};
    S.ground(bed,{rad:4.43,zs:2.1,edge:0.1,h:(x,z)=>-0.15+Math.max(0,Math.abs(z)-1.39)*0.57,res:0.094});
    S.implicitForm({bounds:canvas,sd:(x,y,z)=>Math.max(lake(x,y,z)*1.76,y-0.083,-y-0.13)},wet,{res:0.088});
    S.rock([-1.04,0.34,0.026],0.67,stone,{res:0.07});
    for(const [x,z] of [[-3.48,1.44],[1.22,-1.63],[3.02,1.51],[2.73,1.67],[-2.82,-1.62]]) {
      S.rock([x,0.12,z],0.24,bed,{res:0.072});
    }
    for(let i=0;i<15;i++){
      const z=-1.38+i*0.193, radius=4.25*Math.sqrt(1-(z/1.76)**2),
        x=-Math.min(i%3===1?3.32:2.98,radius-0.28),
        trail=motion.streamline((x,y,z)=>wake.velocity(x,y,z,time),[x,0.091,z],{
          bounds,obstacle:rock,clearance:0.081,step:0.085,minStep:0.016,
          maxLength:i%4===0?5.2:6.9,tolerance:0.001,mask:(x,y,z)=>lake(x,y,z)<-0.024,maxSteps:125
        });
      if(trail.points.length<2)continue;
      const mask=i%3===1?{r:[4,5,24,25]}:{r:[3,4,5,24]},
        sampled=trail.points.filter((_,j)=>j%2===0);
      for(let j=0;j<sampled.length-1;j+=4){
        const path=sampled.slice(j,j+4);
        if(path.length<2)continue;
        S.tube(path,0.016+0.006*(i%3),0.011,mask,{res:0.052});
      }
    }
    const orbit=motion.loopTrajectory([
      [-1.91,0.123,-0.56],[-0.91,0.12,-0.9],[-0.21,0.124,-0.5],[-0.14,0.12,0.63],[-1.22,0.12,0.93],[-1.87,0.122,0.54]
    ],{period:3.8,tension:0.18}), sp=orbit.sample(time);
    const reed={r:[20,21,22,23]}, drift={r:[15,16,17,18,19]};
    for(const [x,z] of [[-2.51,1.52],[2.28,1.6],[1.36,-1.7],[-3.27,-1.47]])for(let j=0;j<4;j++){
      const u=x+0.06*j,y=0.32+0.08*K.hash(j,seed,4);
      S.tube([[u,0.1,z],[u+0.08*(j-1.4),y,z+0.07]],0.025,0.012,reed,{res:0.053});
    }
    S.ball(sp.point,[0.118,0.036,0.076],drift,{res:0.046});
    S.bake();
    return B.finish({cam:{target:[0,0.22,0],dist:10.1,pitch:0.88,yaw:0.144},detail:23,radius:4.5,dither:0.16});
  }
});
