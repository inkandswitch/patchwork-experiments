module.exports=({makeBuilder,makeSculpt,KIT:K})=>({
  id:'fluid-grids',
  name:'An ink basin and a terraced runoff model',
  seed:3,
  build(seed){
    const B=makeBuilder(31,[
      0x1a292f,0x344148,0x4a5756,0x647269,0x898e79,0xa4a38a,
      0x405043,0x5d6f53,0x83946a,0xaaa97a,0xcbba8f,
      0x273e54,0x365c77,0x4d859d,0x74acb3,0xa5c9bd,
      0x536a63,0x6f8980,0x899c8b,0xa5b39b,
      0x4d3b4b,0x67465d,0x8f6485,0xb48ca6,0xd7bac5,
      0x715347,0xa27a5c,0xc5a074,0xe5c28b
    ]),S=K.sculpt(makeSculpt(B)),M=K.procedural.motion,
      unit=0.067, width=56,height=43,left=-2.17,right=2.17,
      origin=[-width*unit/2,-height*unit/2],
      outer=(x,z)=>Math.max(Math.abs(x)-1.75,Math.abs(z)-1.34),
      stone=(x,z)=>Math.hypot(x-0.12,z+0.06)-0.27,
      t=0.49+0.205*((seed>>>0)%8), box={cell:unit,width,height,origin};
    const ink=M.stableFluid({...box,maxDt:0.04,pressureIterations:34,mask:(x,z)=>outer(x,z)<0&&stone(x,z)>0,
      initial(x,z){
        return {density:0.68*Math.exp(-((x+1.08)**2+(z-0.21)**2)*29),
          velocity:[-1.48*(z+0.06),1.48*(x-0.12)]};
      }
    }).step(t,{
      source:(x,z,t)=>(0.5+0.75*Math.exp(-t*1.6))*Math.exp(-((x+1.12)**2+(z-0.19)**2)*41)+
        0.95*Math.exp(-((x+0.92)**2+(z-0.45)**2)*34),
      force:(x,z,t)=>[-1.43*(z+0.06),1.34*(x-0.12)+0.4*Math.sin(x*3.4-t*2)*Math.cos(z*1.65)],
      viscosity:0.0005,diffusion:0.0007,dissipation:0.075
    });
    const base={r:[1,2,3,4,5]}, soil={r:[6,7,8,9,10]};
    for(const x of [left,right]) S.box([x,-0.082,0],[1.91,0.185,1.49],base,{rd:0.11,res:0.081});
    const inkSurface={r:[16,17,18,19],
      rf(x,y,z){
        const value=ink.sample(x-left,z)?.density??0;
        return value>0.023 ? value>0.32?[21,22,23,24]:value>0.13?[20,21,22,23]:[16,17,20,21,22]:null;
      },
      mod(x,y,z){return 0.16*(ink.sample(x-left,z)?.density??0);}
    };
    S.box([left,0.168,0],[1.746,0.066,1.35],inkSurface,{rd:0.027,res:0.052});
    S.rock([left+0.12,0.26,-0.06],0.30,base,{res:0.056});
    for(const x of [-1.8,1.8])S.box([left+x,0.20,0],[0.063,0.128,1.415],base,{rd:0.037,res:0.061});
    for(const z of [-1.42,1.42])S.box([left,0.20,z],[1.842,0.128,0.063],base,{rd:0.037,res:0.061});
    const terrain=(x,z)=>0.17-0.11*x+0.06*Math.sin(z*2.8+x*1.7)+
      0.20*Math.exp(-((x-0.17)**2)*25)*(1-0.9*Math.exp(-((z-0.31)**2)*16))+
      0.10*Math.exp(-((z+0.93)**2)*23)*Math.exp(-((x-0.67)**2)*4),
      wet=M.shallowWater({...box,terrain,mask:(x,z)=>outer(x,z)<0,
        initial:(x,z)=>x<-1.05&&Math.abs(z)<1.03?0.47:0
      }).step(t*0.77,{friction:0.24});
    S.implicitForm({
      bounds:{min:[right-1.75,-0.1,-1.34],max:[right+1.75,0.66,1.34]},
      sd(x,y,z){return Math.max(y-terrain(x-right,z),-y-0.1,outer(x-right,z));}
    },soil,{res:0.065});
    const water={r:[11,12,13,14,15],
      mod(x,y,z){
        const column=wet.sample(x-right,z);
        return column?0.045*Math.sin(x*29+(column.velocity[0]+column.depth)*6)-0.12*column.depth:0;
      }};
    const surface=(x,z)=>wet.sample(x-right,z);
    S.add({
      bc:[right,0.37,0],br:2.42,
      sd(x,y,z){
        const c=surface(x,z);
        if(!c)return Math.max(0.015,outer(x-right,z));
        return Math.max(0.019-c.depth,Math.max(c.bed-y,y-c.level),outer(x-right,z));
      },
      sample(f){
        for(let z=-1.31;z<=1.31;z+=this.res*0.84)for(let x=right-1.72;x<=right+1.72;x+=this.res){
          const c=surface(x,z);
          if(c&&c.depth>0.021) f(x,c.level,z);
        }
      }
    },water,{res:0.055});
    for(const [x,z] of [[-1.58,1.09],[-0.27,-1.03],[0.96,0.91],[1.55,-1.02]])
      S.rock([right+x,terrain(x,z),z],0.14,base,{res:0.053});
    S.bake();
    return B.finish({cam:{target:[0,0.12,0],dist:11.5,pitch:1.0,yaw:0.115},detail:23,radius:4.8,dither:0.16});
  }
});
