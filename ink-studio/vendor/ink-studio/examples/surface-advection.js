module.exports=({makeBuilder,makeSculpt,KIT:K})=>({
  id:'surface-advection',
  name:'Pigment on a moving banner',
  seed:2,
  build(seed){
    const B=makeBuilder(26,[
      0x1c2a30,0x34434a,0x53615d,0x717c6d,0x94927a,
      0x485a4d,0x677a64,0x889478,0xa9ab82,
      0x463842,0x694951,0x945d55,0xb5725f,0xc78b70,0xdba983,
      0x563f36,0x806047,0xa78158,0xc7a674,0xe2c493,
      0x446065,0x659292,0x8bb8a8,0xb5ccb0,0xd8d7a9
    ]),S=K.sculpt(makeSculpt(B)),{motion}=K.procedural,V=K.V,
      time=0.41*((seed>>>0)%10), width=3.83,height=2.12, originY=3.04,
      profile=(u,v,t)=>0.09+0.23*Math.sin(Math.PI*u)*Math.sin(u*6.1+v*1.3-t*2.62)+
        0.066*Math.sin(v*6+u*2.4-t*1.5);
    const chart=t=>({
      sample([u,v]){
        const wave=u*6.1+v*1.3-t*2.62, curl=v*6+u*2.4-t*1.5,
          du=0.23*Math.PI*Math.cos(Math.PI*u)*Math.sin(wave)+
            0.23*Math.sin(Math.PI*u)*6.1*Math.cos(wave)+0.066*2.4*Math.cos(curl),
          dv=0.23*Math.sin(Math.PI*u)*1.3*Math.cos(wave)+0.066*6*Math.cos(curl),
          a=[width,0,du],b=[0,-height,dv];
        return {p:[width*(u-0.5),originY-v*height,profile(u,v,t)],n:V.norm(V.cross(b,a)),
          tangent:V.norm(a),du:a,dv:b};
      }
    }), particles=[];
    for(const [j,y] of [0.28,0.34,0.50,0.56,0.70].entries())for(let i=0;i<44;i++){
      const u=0.052+i*0.0134,v=y+0.074*Math.sin(u*12+0.77*j);
      particles.push({id:j+'/'+i,uv:[u,v],data:{pale:j===0||j===4}});
    }
    const engine=motion.surfaceAdvection(chart,particles,{step:0.033,
      velocity(x,y,z,t,{uv:[u,v]}){return [0.31+0.12*Math.sin(v*9.3-t),0.06*Math.sin(u*8.1+t*0.7),0.022];}
    }), moved=engine.advance(time), cloth={r:[9,10,11,12,13,14],wear:{from:0.8,to:2.9,t:0.14}},
      oak={r:[15,16,17,18,19]}, base={r:[1,2,3,4]}, fringe={r:[17,18,19]};
    S.box([0,-0.015,0],[2.39,0.16,0.62],base,{rd:0.13,res:0.083});
    for(const x of [-2.09,2.09]){
      S.tube([[x,0.12,0],[x,3.22,0]],0.073,0.067,oak,{res:0.065});
      S.ball([x,3.27,0],[0.13,0.112,0.119],fringe,{res:0.055});
      S.box([x,0.25,0],[0.22,0.15,0.22],base,{rd:0.046,res:0.069});
    }
    S.tube([[-2.13,3.145,0],[2.13,3.145,0]],0.069,0.069,oak,{res:0.064});
    for(let u=0.04;u<0.99;u+=0.115){
      const x=width*(u-0.5);
      S.tube([[x,3.165,0.016],[x,3.025,profile(u,0,time)]],0.021,0.019,fringe,{res:0.055});
    }
    const carrier={bounds:{min:[-width/2,originY-height,-0.35],max:[width/2,originY,0.50]},
      sd(x,y,z){
        const u=x/width+0.5,v=(originY-y)/height,w=profile(u,v,time);
        return Math.max(Math.abs(x)-width/2,originY-height-y,y-originY,Math.abs(z-w)-0.038);
      }};
    S.implicitForm(carrier,cloth,{res:0.058,cell:0.045});
    for(const p of moved.particles){
      const x=V.mad(p.position,p.normal,0.051),size=p.data.pale?0.040:0.050,
        color=p.data.pale?[181,204,176]:[122,176,164];
      B.disc(...x,p.normal,size,0.014,color,3);
    }
    S.bake();
    return B.finish({cam:{target:[0,1.57,0],dist:8.3,pitch:0.25,yaw:0.2},detail:24,dither:0.18,radius:3.48});
  }
});
