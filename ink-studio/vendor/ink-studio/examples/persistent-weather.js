module.exports=({makeBuilder,makeSculpt,KIT:K})=>({
  id:'persistent-weather',
  name:'A freeze and thaw courtyard',
  seed:3,
  build(seed){
    const B=makeBuilder(24,[
      0x19282f,0x343f43,0x525e5d,0x727c70,0x989b81,
      0x3a544a,0x5c745a,0x816d51,0xaa9571,0xc1ad82,
      0x526f76,0x77999a,0xa9bab2,0xd0d8c4,0xecedda,
      0x2b4e55,0x3d696d,0x63888a,0x8cb0a8,
      0x514137,0x7b5742,0x9c684b,0xc58e6b,
      0x475d4e,0x6e8766,0x9aa47b
    ]),S=K.sculpt(makeSculpt(B)),M=K.procedural.motion,
      width=42,height=35,cell=0.088,origin=[-width*cell/2,-height*cell/2],
      ground=(x,z)=>0.19+0.19*Math.exp(-((x+0.62)**2+(z+0.43)**2)*1.55)+
        0.12*Math.exp(-((x-0.90)**2+(z-0.43)**2)*3.5)+0.045*Math.cos(x*2-z*2.1),
      n=(x,z)=>K.V.norm([ground(x-0.016,z)-ground(x+0.016,z),0.032,ground(x,z-0.016)-ground(x,z+0.016)]),
      shadow=(x,z)=>Math.max(0,0.83-0.48*Math.hypot(x+0.62,z+0.68)),
      weather=M.surfaceWeather({width,height,cell,origin,maxRunoff:0.23,normal:n,
        initial:(x,z)=>({wetness:0.23+0.05*Math.sin(x*2.3+z*3.5),temperature:-3.8}),heatDiffusion:0.008,wetDiffusion:0.012
      }), cold=weather.step(2.3,{
        forcing:(x,z)=>({air:-6.3+7.3*Math.max(0,x-0.15),light:0.34,shelter:shadow(x,z),
          snowfall:0.29*(0.8+0.18*Math.sin(x*3.1-z*4.1)),rain:0.021,wind:0.16})
      }), thaw=weather.step(2.0+0.19*((seed>>>0)%6),{
        forcing:(x,z)=>({air:8.6+4*Math.max(0,x),light:0.84,shelter:shadow(x,z)*0.74,
          rain:x<-0.2?0.095:0,runoff:[0.11,0.075],wind:0.45,humidity:0.48})
      }),
      shell={r:[1,2,3,4]}, paved={r:[7,8,9,13]}, moss={r:[23,24,25]};
    const machine={initial:'dry',states:{dry:{r:[7,8,9,14]},wet:{r:[15,16,17,18]},
      muddy:{r:[19,20,21,22]},cracked:{r:[8,9,12,13]}},transitions:[
      {id:'rain',from:'dry',event:'rain',to:'wet',when:({payload})=>payload.wet>0.16},
      {id:'track',from:'wet',event:'walk',to:'muddy'},
      {id:'dry',from:'muddy',event:'sun',to:'cracked',minAge:0.8}
    ]}, tiles=M.materialStateGraph(machine,[{id:'a'},{id:'b'},{id:'c'},{id:'d'}]),
      wet=thaw.sample(-0.48,0.2).wetness;
    tiles.advance(3.8,[
      {at:0.6,type:'rain',target:['b','c','d'],payload:{wet}},
      {at:1.3,type:'walk',target:['c','d']},{at:3.8,type:'sun',target:'d'}
    ]);
    for(const [i,data] of [cold,thaw].entries()){
      const at=i?2.0:-2.0, surface=(x,z)=>data.sample(x-at,z),
        grass={r:[5,6,7,8],rf(x,y,z){
          const s=surface(x,z);
          if(!s)return null;
          if(s.snow>0.25)return [10,11,12,13,14];
          if(s.frost>0.16)return [10,11,12,13];
          if(s.wetness>0.36)return [5,15,16,17];
          if(s.wetness>0.19)return [5,6,16,23,24];
          return [6,7,8,24,25];
        },mod(x,y,z){return (B.n3(x*9,y*9,z*9)-0.5)*0.23;}};
      S.box([at,-0.144,0],[1.87,0.22,1.62],shell,{rd:0.12,res:0.072});
      S.implicitForm({
        bounds:{min:[at-1.77,-0.03,-1.5],max:[at+1.77,0.53,1.5]},
        sd(x,y,z){
          const a=x-at,s=surface(x,z),top=ground(a,z)+0.13*Math.min(0.72,s?.snow??0);
          return Math.max(Math.abs(a)-1.77,Math.abs(z)-1.5,-y-0.03,y-top);
        }
      },grass,{res:0.061});
      for(const [x,z,r] of [[-0.84,-0.7,0.32],[-0.45,-0.82,0.24],[-1.37,0.72,0.18],[0.97,-0.68,0.30]]){
        const sample=surface(at+x,z),y=ground(x,z)+r*0.26;
        S.rock([at+x,y,z],r,sample?.snow>0.26?{r:[2,10,11,12,13]}:shell,{res:0.06});
      }
      for(const [j,x] of [-1.06,-0.36,0.36,1.06].entries()){
        const id='abcd'[j],y=ground(x,1.16)+0.067+(data.sample(x,1.16)?.snow??0)*0.035,
          mat=i?tiles.get(id).material:paved;
        S.box([at+x,y,1.16],[0.298,0.072,0.223],mat,{rd:0.034,res:0.049});
        if(i&&tiles.get(id).state==='cracked'){
          S.tube([[at+x-0.23,y+0.072,1.08],[at+x-0.02,y+0.072,1.13],[at+x+0.04,y+0.072,1.28]],
            0.018,0.014,{r:[19,20,21]},{res:0.049});
        }
      }
      for(const [x,z] of [[1.38,-1.06],[1.27,-0.95],[0.85,0.73],[-0.96,0.65]]) {
        if((surface(at+x,z)?.snow??0)>0.27)continue;
        S.tube([[at+x,ground(x,z),z],[at+x+0.12,ground(x,z)+0.24,z-0.06]],0.035,0.018,moss,{res:0.051});
      }
    }
    S.bake();
    return B.finish({cam:{target:[0,0.29,0],dist:10.3,pitch:0.96,yaw:0.15},detail:23,radius:4.45,dither:0.18});
  }
});
