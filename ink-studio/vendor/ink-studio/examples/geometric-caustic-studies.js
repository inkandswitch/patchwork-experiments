const DURATION=6.4, TAU=2*Math.PI;
const palette=[0x101929,0x263548,0x405268,0x647780,0x9eaba7,0xc9c7b6,
  0x311f37,0x654355,0x9c6156,0xca8d62,0xf1bf84,0xffe8b1,
  0x0d303c,0x225566,0x367d84,0x65b6a6,0xaeecd1,0x553e67,0x7d688c,0xb19bb3,
  0xe1859b,0x6fbbd9,0x4b4460,0xa9856a];
const iron={r:[0,0,1,2]}, slate={r:[1,2,3,4]}, stone={r:[2,3,4,5]};
const bronze={r:[6,7,8,9,10]}, jade={r:[12,13,14,15]}, gold={r:[8,9,10,11],em:true};
const mint={r:[13,14,15,16],em:true}, plaster={r:[1,2,3,4]}, silver={r:[2,3,4,5]};
const wave=t=>TAU*t/DURATION;

function setup({KIT:K,makeBuilder,makeSculpt,SpriteSurface},seed) {
  const B=makeBuilder(seed,palette), S=K.sculpt(makeSculpt(B)), sprites=SpriteSurface.make(1024);
  const font=K.inspection.font({});
  Object.assign(S,{pixel:true,amb:.25,sky:.12,sunK:.58,sun:K.V.norm([-.56,.73,.54]),shLen:0});
  const box=(p,r,mat,res=.091,rd=.055,opts={})=>S.box(p,r,mat,{res,rd,...opts});
  function label(text,[x,y,z],span,vertical,color) {
    const columns=text.length*6, h=span*7/columns, letters=[...text].map(c=>font.get(c));
    sprites.face([x-span/2,y,z],[span,0,0],vertical?[0,h,0]:[0,0,-h],columns,7,
      (u,v)=>letters[Math.floor(u/6)]?.[v*6+u%6]?color:undefined);
  }
  function finish(cam,extras) {
    S.bake();
    return B.finish({cam,radius:7,detail:23,dither:.045,spriteSurfaces:sprites.finish(),
      look:{pixelSize:1,splatCoverage:'continuous'},...extras});
  }
  return {K,B,S,box,label,finish};
}

function prismArch(set) {
  const {K,S,box,label,finish}=set;
  const floor=.19, w=4.43, source=[0,3.59,3.62], dir=K.V.norm([.04,-.58,-1]), mount=K.V.mad(source,dir,1.53);
  const cookie=K.lightEmitters.caustic({width:184,height:144,angle:25,focus:6.24,samples:[156,144],period:DURATION,
    blur:2,exposure:1.49,lens:{size:[2.18,2.05],distance:1.53,thickness:.74,sagLimit:.33,ior:[1.42,1.49,1.57],
      rotation:t=>.52*Math.sin(wave(t))+.11*Math.sin(2*wave(t)),
      front:(x,y,t)=>.076*(x*x+y*y)+.041*Math.cos(7.1*x+.89*Math.sin(5.1*y)+.22*Math.sin(wave(t)))+
        .038*Math.cos(8.4*y+.56*Math.sin(4.9*x))+.028*x,
      back:(x,y,t)=>-.054*(x*x+y*y)+.028*Math.cos(4.4*x-5.2*y+.38*Math.cos(wave(t))) }});
  box([0,-.115,.11],[w+.16,.225,3.42],slate,.137,.107);
  box([0,.121,.01],[w,.072,3.23],plaster,.109,.084);
  box([0,.224,1.63],[w,.136,1.59],slate,.110,.086);
  for (const x of [-3.87,3.87]) {
    box([x,.341,-1.46],[.48,.145,1.43],stone,.110,.090);
    box([x,.471,-1.46],[.462,.045,1.37],jade,.096,.065);
  }
  for (const x of [-3.37,3.37]) box([x,.31,-1.53],[.076,.134,1.49],bronze,.068,.059);
  box([0,.345,-3.033],[w,.217,.188],slate,.110,.087);
  box([0,1.29,-3.142],[w,1.09,.127],stone,.111,.099);
  for (const x of [-3.2,-1.6,0,1.6,3.2]) {
    box([x,1.39,-2.986],[.707,.745,.038],plaster,.090,.040);
    for (const y of [.56,2.18]) box([x,y,-2.961],[.72,.031,.045],bronze,.062,.040);
  }

  const z=.37, half=1.72, spring=1.72;
  for (const side of [-1,1]) {
    const x=side*half;
    box([x,(spring+.35)/2,z],[.205,(spring-.35)/2,.293],stone,.078,.065);
    box([x,.424,z],[.304,.112,.392],bronze,.069,.060);
    box([x,spring,z],[.269,.086,.343],bronze,.070,.061);
    box([side*2.20,.884,z],[.306,.531,.218],slate,.090,.078);
    for (let j=0;j<6;j++) box([x,.56+j*.165,z+.307],[.173,.023,.032],j%3?slate:bronze,.056,.030);
  }
  const arch=Array.from({length:48},(_,i)=>{
    const a=Math.PI*i/47;
    return [half*Math.cos(a),spring+1.34*Math.sin(a),z];
  });
  S.tube(arch,.229,.229,stone,{res:.074});
  S.tube(arch.map(([x,y,z])=>[x,y,z+.253]),.046,.046,bronze,{res:.049});
  for (let j=0;j<11;j++) {
    const a=(j+.5)*Math.PI/11;
    S.ball([half*Math.cos(a),spring+1.34*Math.sin(a),z+.262],j===5?.082:.051,j===5?mint:jade,{res:.044});
  }
  for (const side of [-1,1]) {
    const end=K.V.mad(mount,K.V.norm(K.V.cross(dir,[0,1,0])),side*1.16);
    S.tube([end,[side*2.56,2.42,2.46],[side*2.58,.39,2.49]],.052,.064,bronze,{res:.074});
  }
  S.tube(K.curve.circle(mount,1.102,90,dir),.042,.042,jade,{res:.055});
  S.tube(K.curve.circle(K.V.mad(mount,dir,-.035),1.129,90,dir),.025,.025,bronze,{res:.052});
  S.ball(mount,[1.085,1.00,.028],K.look.glass([13,14,15,16],{a:.024}),{res:.091,ghost:true});
  box([0,.351,3.22],[1.45,.078,.205],iron,.083);
  label('PRISM ARCH',[0,.499,3.36],2.1,false,0xffdfa4);

  const water=K.procedural.waterBodies.scene([K.procedural.waterBodies.create({
    id:'prism-basin',bounds:{min:[-3.30,-2.86],max:[3.30,.02]},resolution:[55,30],
    sample:(x,z)=>Math.abs(x)<3.22 && z> -2.83 && z< -.04 ? {bed:.197,surface:.302,current:[.03,-.02]} : null,
    optics:{deepTint:[.13,.29,.36],depthRange:[.10,1],surface:.26,foam:0,refraction:.52,caustics:0,
      optical:{reflection:.04,absorption:.10,scattering:.02,scatteringColor:'#346b71'}}
  })]);
  const shadow=K.atmosphere.occluder((x,y,depth)=>{
    const xx=Math.abs(x), d=Math.abs(depth-z);
    const arch=Math.max(d-.232,spring-y,Math.abs(Math.hypot(x/half,(y-spring)/1.34)-1)*1.34-.226);
    const post=Math.max(Math.abs(xx-half)-.218,.34-y,y-spring,d-.286);
    const buttress=Math.max(Math.abs(xx-2.20)-.310,.36-y,y-1.42,d-.224);
    return Math.min(arch,post,buttress);
  },{step:.066,steps:38});
  const world=finish({target:[-.04,1.04,.16],dist:15.0,fov:.60,yaw:-.39,pitch:.60,sway:0},{
    water,volumeLighting:{ambient:.12,shadow,spots:[{at:source,direction:dir,innerAngle:30,outerAngle:41,radius:15,
      color:'#ffffff',intensity:0,surfaceIntensity:22,castsShadow:true,cookie}]}
  });
  return world;
}

function walker(set) {
  const {K,B,S,box,label,finish}=set, rig=K.rig(B,S);
  const wall=-.89;
  box([0,-.053,.43],[4.04,.232,1.79],slate,.126,.101);
  box([0,.182,.41],[3.91,.066,1.69],plaster,.103,.086);
  box([0,2.58,wall-.20],[4.01,2.59,.19],slate,.125,.100);
  box([0,2.62,wall-.04],[3.89,2.45,.119],{r:[0,1,2,3]},.104,.096);
  for (const x of [-3.62,3.62]) {
    box([x,2.57,wall+.149],[.128,2.52,.134],bronze,.087);
    for (let j=0;j<13;j++) box([x,.51+.353*j,wall+.304],[.049,.020,.022],j%5?slate:mint,.040,.031);
  }
  for (const y of [.47,4.69]) {
    box([0,y,wall+.135],[3.55,.070,.107],jade,.088);
    for (let i=0;i<16;i++) box([-3.31+.441*i,y,wall+.256],[.020,.017,.014],i%5?plaster:gold,.034,.027);
  }
  box([0,.291,2.046],[1.34,.111,.139],iron,.076);
  label('GLASS WALKER',[0,.237,2.238],2.15,true,0xffdea9);

  const coat={r:[1,2,3,4]}, seam={r:[6,7,8,9]}, trim={r:[2,3,4,5]}, enamel={r:[1,2,3,4]};
  const tag='walker', limb='arm', left='left-leg', right='right-leg', at=(x,y,z)=>[x,y+.253,z+.24];
  const rb=(p,r,mat,res=.059,rd=.069,part=tag)=>box(at(...p),r,mat,res,rd,{tag:part});
  const ball=(p,r,mat,res=.059)=>S.ball(at(...p),r,mat,{res,tag});
  rb([-.274,.14,.065],[.194,.13,.252],seam,.051,.040,left);
  rb([.273,.14,.183],[.184,.129,.247],seam,.051,.042,right);
  rb([-.259,.62,.04],[.127,.445,.141],coat,.059,.069,left);
  rb([.264,.64,.107],[.126,.455,.142],coat,.059,.069,right);
  rb([0,1.21,.033],[.415,.303,.248],coat,.060,.093);
  rb([0,1.76,.024],[.528,.435,.284],enamel,.060,.148);
  rb([0,1.46,.235],[.450,.065,.107],seam,.046,.040);
  rb([0,1.46,.353],[.137,.082,.035],bronze,.037,.032);
  ball([0,2.168,.039],[.287,.103,.233],seam,.045);
  ball([0,2.516,.042],[.322,.349,.283],silver,.050);
  rb([0,2.537,.281],[.245,.134,.078],iron,.049,.059);
  rb([0,2.582,.360],[.171,.030,.019],mint,.032,.019);
  rb([-.529,1.97,.01],[.145,.177,.239],seam,.057,.073);
  ball([.49,1.98,.026],[.198,.163,.226],bronze,.047);
  S.tube([at(-.525,1.983,.02),at(-.69,1.615,.103),at(-.59,1.35,.269)],.134,.105,coat,{res:.054,tag});
  ball([-.585,1.35,.282],[.100,.105,.114],silver,.043);
  const shoulder=at(.54,1.99,.025);
  S.tube([shoulder,at(.771,1.722,.156),at(.96,1.669,.305)],.137,.103,coat,{res:.050,tag:limb});
  S.ball(at(.976,1.676,.312),[.113,.093,.113],silver,{res:.047,tag:limb});
  for (const x of [-.31,.31]) for (let j=0;j<5;j++) ball([x,1.57+j*.085,.307],.038,trim,.035);
  const cookie=K.lightEmitters.caustic({width:184,height:152,angle:28,focus:4.88,period:DURATION,samples:[158,140],
    blur:2,exposure:.98,lens:{size:[2.03,1.86],distance:1.49,thickness:.69,sagLimit:.29,ior:[1.40,1.49,1.62],
      rotation:t=>-.26+.55*Math.sin(wave(t)+.23),center:t=>[.05*Math.sin(wave(t)),.035*Math.cos(wave(t))],
      front:(x,y,t)=>.08*(x*x+y*y)+.050*Math.cos(6.4*x+3.5*y+.75*Math.cos(4*y)+.31*Math.sin(wave(t)))+
        .024*Math.cos(9.6*y-.9*x),
      back:(x,y)=>-.041*(x*x+y*y)+.031*Math.cos(4.8*x-4.1*y)}});
  const white=[0,3.30,4.63], aim=K.V.norm([0,-.28,-1]);
  const world=finish({target:[0,2.05,.10],dist:12.99,fov:.526,yaw:-.124,pitch:.087,sway:0},{
    volumeLighting:{ambient:.07,spots:[{at:white,direction:aim,innerAngle:30,outerAngle:41,radius:13,
      color:'#ffffff',intensity:0,surfaceIntensity:22,castsShadow:false,cookie}]}
  });
  const stage=K.stage(world);
  rig.bind(stage);
  stage.add({update(_dt,t) {
    const angle=wave(((t%DURATION)+DURATION)%DURATION);
    const x=1.79*Math.sin(angle), lift=.026*(1-Math.cos(4*angle)), yaw=.22*Math.cos(angle);
    rig.set(tag,K.M.rot([0,1,0],yaw),[0,.253,.24],[x,.253+lift,.24]);
    rig.child(limb,tag,K.M.rot([0,0,1],.23*Math.sin(2*angle+.2)),shoulder);
    const stride=.16*Math.sin(4*angle)*Math.abs(Math.cos(angle));
    rig.child(left,tag,K.M.rot([1,0,0],stride),at(-.259,1.04,.04));
    rig.child(right,tag,K.M.rot([1,0,0],-stride),at(.264,1.05,.107));
    rig.apply();
  }});
  stage.stateful=false;
  stage.update(0,0);
  return world;
}

module.exports=kit=>({
  id:'geometric-caustic-studies',name:'Prism Arch and Glass Walker',seed:76,duration:DURATION,
  build(seed,{controls}={}) {
    const study=controls?.study??'arch';
    if (!['arch','walker'].includes(study)) throw new RangeError('Choose arch or walker');
    const set=setup(kit,seed);
    return study==='arch'?prismArch(set):walker(set);
  }
});
