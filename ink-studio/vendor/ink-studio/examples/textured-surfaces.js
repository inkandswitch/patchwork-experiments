// Optional textured patches alongside SDF architecture and splat vegetation.
module.exports=({makeBuilder,makeSculpt,KIT:K,TexturedSurface,SpriteSurface})=>({
  id:'textured-surfaces',name:'Terrace and waterway',seed:37,
  build(seed,{textured=true}={}){
    const pal=[0x182b36,0x213b38,0x345347,0x55794e,0x7c9c58,0xb0bd79,
      0x354b60,0x567785,0x8cb9b7,0xe4dfbd,0x385458,0x6f9687,0x365b73,0x528ca2,0xa4dbd1,
      0x713d32,0xa36b45,0xe8b96f];
    const B=makeBuilder(seed,pal),S=K.sculpt(makeSculpt(B)),atlas=SpriteSurface.make(512);
    S.pixel=true;S.pixelSize(18);S.sun=K.V.norm([-.6,.9,.35]);S.amb=.34;S.sunK=.8;S.sky=.24;
    const height=TexturedSurface.heightfield({bounds:[-6,6,-5,5],segments:[48,40],
      height:(x,z)=>.32+.63*Math.exp(-((x+3)**2+(z+1.8)**2)/7)+.12*Math.sin(x*.55)*Math.cos(z*.41)});
    const stone=K.pixel.masonry({r:[6,7,8,9],joint:1,stone:[7,9],seed});
    // A coarse SDF ground carries the solid mass. Its optional painted face
    // uses the identical triangle sampler for planting and collision heights.
    S.ground({r:[1,2,3,4,5]},{rad:7,zs:.85,h:(x,z)=>height.height(x,z)-.06,res:textured?.38:.12});
    if(textured)atlas.mesh(height,192,160,(i,j)=>{
      const x=-6+(i+.5)/192*12,z=5-(j+.5)/160*10;
      if(Math.hypot(x/6,z/5)>1)return;
      const path=Math.abs(z-.7*Math.sin(x*.45));
      const seams=i%9===0||(j+(Math.floor(i/9)%2)*4)%8===0;
      return pal[path<.58?seams?6:K.hash(Math.floor(i/9),Math.floor(j/8),seed)>.5?8:7:
        K.hash(i,j,seed)>.93?5:B.n3(x*.65,z*.8,4)>.5?4:3];
    });
    for(const [x,z] of [[-3,-2],[-2.4,-2],[3.5,1.4],[4.1,1.8],[-4,2.1]]){
      const y=height.height(x,z);
      S.rock([x,y+.13,z],.35,stone,{res:.10});
      for(let k=0;k<11;k++){
        const a=k*2.4,h=.22+.25*K.hash(k,x,z),p=[x+.45*Math.cos(a),height.height(x+.45*Math.cos(a),z+.45*Math.sin(a)),z+.45*Math.sin(a)];
        B.stick(p[0],p[1]+h*.45,p[2],[.16*Math.cos(a),1,.16*Math.sin(a)],h*.5,.019,B.P[k%3?4:5],2.2);
      }
    }
    const x=1.4,z=-2.8,y=height.height(x,z);
    S.box([x,y+.82,z],[1.25,.82,.85],stone,{res:.10,rd:.035});
    for(const side of [-1,1])S.box([x,y+1.78,z+side*.45],[1.45,.08,.54],K.pixel.tiles({r:[15,16,17],seed:3}),
      {res:.10,ax:B.frame(0,side*.35,0)});
    if(textured){
      const wall=TexturedSurface.grid({segments:[1,1],point:(u,v)=>[x-1.22+u*2.44,y+.04+(1-v)*1.52,z+.867]});
      atlas.mesh(wall,80,48,(i,j)=>{
        const window=Math.abs(i-18)<10&&j>12&&j<34||Math.abs(i-59)<10&&j>12&&j<34;
        const seams=(i+Math.floor(j/7)%2*6)%13===0||j%7===0;
        return pal[window?i%17===0||j===23?9:(i+j)%19<2?14:12:seams?6:K.hash(Math.floor(i/13),Math.floor(j/7),seed)>.55?9:8];
      });
      const route=K.anim.path([[-4,.75,2.5],[-2,1.3,2.7],[.4,1.7,2.55],[3.6,1.0,1.9]],{steps:20});
      const channel=TexturedSurface.sweep({path:route,segments:80,profile:[[-.42,.12],[-.31,.12],[-.27,0],[.27,0],[.31,.12],[.42,.12]]});
      atlas.mesh(channel,48,192,(i,j)=>pal[i<6||i>41?j%14===0?6:9:i<11||i>36?7:
        Math.sin(j*.27+i*.4)>.85?14:13]);
      for(const t of [.15,.45,.8]){
        const p=channel.sample(.5,t).point;
        for(const side of [-1,1])S.tube([[p[0]+side*.32,height.height(p[0]+side*.32,p[2]),p[2]],
          [p[0]+side*.32,p[1]-.04,p[2]]],.055,.045,stone,{res:.10});
      }
    }
    S.bake();
    return B.finish({spriteSurfaces:textured?atlas.finish():undefined,detail:18,radius:9,dither:.12,
      cam:{target:[0,.85,0],dist:20,yaw:.47,pitch:.59},look:{pixel:true,native:true,clean:false}});
  }
});
