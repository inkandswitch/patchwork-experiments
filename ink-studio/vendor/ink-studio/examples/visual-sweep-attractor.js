const colors=[
  0x111824,0x1c2836,0x29384a,0x415066,0x627688,0x9ba9ae,0xc9cfc0,
  0x122b35,0x13515d,0x1c7180,0x2b919b,0x4eb0af,0x7ad1c4,0xb5efe0,0xe3f8dd,
  0x262641,0x3b3c66,0x5b568f,0x8172b3,0xab98cb,0xd1c3e9,
  0x4f3043,0x815052,0xad7159,0xd99563,0xf8bd79,0xffdf99,0xfff0c4
];
const clamp=x=>Math.max(0,Math.min(1,x)), TAU=2*Math.PI, duration=2;
const spectral=colors.slice(7,15), shadow=colors.slice(15,21);
const sampleColor=(ramp,q)=>ramp[Math.min(ramp.length-1,Math.floor(clamp(q)*ramp.length))];
const phase=t=>TAU*(t-duration*Math.floor(t/duration))/duration;

module.exports=({KIT:K,makeBuilder,SpriteSurface})=>({
  id:'visual-sweep-attractor',name:'De Jong attractor study',seed:37,duration,
  build(seed,{controls}={}){
    const B=makeBuilder(seed,colors),P=K.procedural,V=K.V,sprites=SpriteSurface.make(512);
    const parameters={a:1.4,b:-2.3,c:2.4,d:-2.1,...controls?.parameters};
    const orbit=P.attractors.trace({family:'deJong',parameters,steps:98000,burnIn:180,
      start:[.12+.60*K.hash(seed,13,83),.08+.60*K.hash(seed,77,19)]});
    const w=274,h=174, bounds={min:[-3.45,-2.19],max:[3.45,2.19]},
      density=orbit.density({resolution:[w,h],bounds,exposure:.59});
    const ink=Float32Array.from({length:w*h},(_,i)=>density.bin(i%w,h-1-Math.floor(i/w)).density);
    const plot=sprites.reserve(w,h), frame=[-3.45,.05,.05], step=.093;
    function bezel(x,y,width,height){
      sprites.face([x,y,.017],[width,0,0],[0,height,0],24,21,(i,j)=>
        i===0||i===23||j===0||j===20?0x627688:(i+j)%7===0?0x29384a:0x1c2836);
    }
    bezel(frame[0]-step,frame[1]-step,6.90+2*step,4.38+2*step);
    sprites.faceRegion(frame,[6.90,0,0],[0,4.38,0],plot);
    const atlas=sprites.finish();
    let last;
    function drawDensity(t){
      const a=phase(t);
      if(a===last)return;
      const pixels=new Uint8Array(w*h*4);
      for(let j=0;j<h;j++)for(let i=0;i<w;i++){
        const q=i+j*w, density=ink[q], u=i/w,v=j/h, x=2*u-1,y=2*v-1;
        const sweep=.50+.50*Math.cos(a-3.3*x+4.8*y-.8*Math.sin(y*4.4+x*2));
        const halo=.24+.48*x*x+.27*y*y;
        let color=(i===137||j===87)?0x243145:i%17===0&&j%17===0?0x374454:0x111824;
        if(density>.001){
          const depth=clamp(.09+.94*density**.66+(sweep-.5)*.27-halo*.11);
          color=sampleColor(sweep>.31?spectral:shadow,depth);
        }
        const off=q*4;
        pixels[off]=color>>16;pixels[off+1]=(color>>8)&255;pixels[off+2]=color&255;pixels[off+3]=255;
      }
      SpriteSurface.update(atlas,plot,{w,h,rgba:pixels});
      last=a;
    }
    const inkHeads=K.frameSplats(B,46,(draw,_dt,t)=>{
      const a=phase(t), glide=(1-Math.cos(a))*.5;
      for(let i=0;i<8;i++){
        const sample=orbit.at(650*i+7.1*glide+2.8*i*Math.sin(a+i*.42)+31);
        const p=V.add(sample.p,[0,2.24,.085]);
        const color=i%3?[.43,.92,.84]:[1,.81,.46];
        draw.point(p,{rgb:color,width:.048,density:.91,depth:true});
        draw.point(p,{rgb:[.89,1,.87],width:.019,density:1.4,depth:true});
      }
    });
    const world=B.finish({spriteSurfaces:atlas,cam:{target:[0,2.24,.045],dist:8.8,yaw:0,pitch:0,fov:.59,sway:0},
      detail:21,radius:6,dither:.045,look:{pixelSize:1,splatCoverage:'continuous'}});
    const stage=K.stage(world);
    stage.stateful=false;
    stage.add({update(_dt,t){drawDensity(t);}});
    stage.add(inkHeads);
    stage.update(0,0);
    return world;
  }
});
