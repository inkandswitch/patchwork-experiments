module.exports=({makeBuilder,makeSculpt,KIT:K})=>({
  id:'transport-morph',
  name:'A pressed leaf opens into a flower',
  seed:0,
  build(seed){
    const B=makeBuilder(19,[
      0x1b282e,0x374449,0x54615f,0x717a6d,0x969982,
      0x294f4d,0x47776b,0x72a28f,0xa6ba96,0xc9c485,
      0x674759,0x98617b,0xb98596,0xd0a1a1,0xe8c3a6,
      0x694d3e,0xa27751,0xc9a371,0xe6c698
    ]),S=K.sculpt(makeSculpt(B)),
      stands=[-2.04,0,2.04], shell={r:[1,2,3,4]};
    for(const x of stands)S.box([x,-0.03,0],[0.88,0.115,0.62],shell,{rd:0.072,res:0.068});
    S.bake();
    const lists=[];
    for(const x of stands){
      const ids=[[],[]];
      for(let iy=0;iy<28;iy++)for(let ix=0;ix<26;ix++){
        const u=(ix-12.5)*0.059,v=(iy-13.5)*0.063,
          a=u+0.43*v,b=v-0.18*u,
          leaf=Math.abs(a)/(0.45-0.19*Math.abs(b))+(b/0.81)**2,
          radius=Math.hypot(u,v-0.052),angle=Math.atan2(v-0.052,u),
          bloom=0.48+0.17*Math.cos(5*angle-0.11)+0.026*Math.cos(10*angle-0.22),
          dice=K.hash(ix,iy,seed+71);
        if(leaf<1){
          const line=Math.abs(a-0.02*Math.sin(v*13))<0.032||Math.sin(b*29-Math.abs(a)*20)>0.89,
            color=line?[162,185,139]:[54+Math.round(dice*29),123+Math.round(dice*28),107+Math.round(dice*20)];
          ids[0].push(B.count());
          B.disc(x+u,1.06+v,0.22+0.10*(1-leaf),[0,0,1],0.044,0.017,color,2.75);
        }
        if(radius<bloom){
          const inner=radius<0.129,
            color=inner?[214,174,107]:[155+Math.round(dice*29),91+Math.round(dice*27),132+Math.round(dice*31)];
          ids[1].push(B.count());
          B.disc(x+u,1.06+v,0.24+0.095*Math.cos(7*radius),[0,0,1],0.045,0.018,color,2.75);
        }
      }
      lists.push(ids);
    }
    const W=B.finish({cam:{target:[0,0.9,0],dist:7.95,pitch:0.23,yaw:0.057},detail:23,radius:3.48,dither:0.12}),
      stage=K.stage(W);
    for(const [i,[a,b]] of lists.entries()){
      const track=K.morph(B,stage,a,b,{dur:1,loop:[0,1],correspondence:'transport',
        transport:{epsilon:0.028,iterations:45,tolerance:0.00003,colorWeight:0.06}});
      track.update(0,[0,0.53,1][i]);
    }
    delete W.anim;
    return W;
  }
});
