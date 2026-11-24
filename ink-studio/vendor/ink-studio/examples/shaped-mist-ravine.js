module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'shaped-mist-ravine',
  name:'Mist at the ravine crossing',
  seed:64,
  build(seed,{ controls }={}) {
    const B=makeBuilder(seed,[
      0x7893aa, 0x293d51, 0x435364, 0x616d76, 0x84898c, 0xac9b83,
      0x303c38, 0x465343, 0x617053, 0x878959, 0xa7a16a,
      0x4c3837, 0x755244, 0xa47752, 0xcf9c69, 0xefcd93,
      0x274b63, 0x396784, 0x548e9c, 0x83babf, 0xc6d2c8,
      0x9d452e, 0xb8694d, 0xd08969, 0xf1b883, 0xffd67d, 0xffedbf
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.46,.52,.72]);
    S.sunK=.62;
    S.sky=.24;
    S.amb=.37;
    const clamp=K.clamp, V=K.V;
    const bank={r:[6,7,8,9,10]}, shale={r:[1,2,3,4,5]}, wood={r:[11,12,13,14,15]};
    const roof={r:[21,22,23,24]}, ember={r:[25,26],em:true};
    const bend=z=>1.18*Math.sin(.41*z)+.51*Math.sin(.21*z-.7)+.023*z;
    const heightAt=(x,z)=>{
      const r=Math.abs(x-bend(z));
      const bankRise=clamp((r-.75)/2.8,0,1);
      const ripple=.49*Math.sin(x*.92+z*.37)+.29*Math.sin(z*.73-x*.23);
      return -.42 + bankRise*bankRise*(3-2*bankRise)*(2.85+ripple) +
        clamp((r-3)/5,0,1)*.7*Math.sin(.53*z+.61*x);
    };
    const min=[-11,-1.45,-22],max=[11,4.4,9.8];
    const riverBed={r:bank.r,rf(x,y,z,ny) {
      return Math.abs(x-bend(z))<1.0 || ny<.68 ? shale.r : bank.r;
    }};
    S.implicitForm({bounds:{min,max},sd:(x,y,z)=>Math.max((y-heightAt(x,z))*.65,min[1]-y,
      min[0]-x,x-max[0],min[2]-z,z-max[2])},riverBed,{res:.185});
    const water=K.surface.preset('rippling-water',{r:[16,17,18,19,20]},{
      normal:{ type:'noise', amplitude:.024,scale:.8,speed:.7 },
      layers:{ sky:{ source:'scene',f0:.44,strength:.52 },sun:false,ripples:{strength:.08} }
    });
    S.box([0,-.28,-5.5],[6.3,.042,15.8],water,{res:.30,ghost:true});
    for (const [x,z,sx,sy,sz] of [
      [-18,-31,11,7,7],[-8,-41,11,7.8,8],[2,-43,9,5,8],[15,-33,11,7.4,7],[24,-29,9.1,7.7,8]
    ]) S.rock([x,.15,z],[sx,sy,sz],{r:[1,2,3]}, {res:.47});
    for (const [x,z,sx,sy,sz] of [[-4.6,5,1.84,1.05,1.5],[3.44,3.92,1.27,1.02,1.13],
      [-4.8,-2.9,1.74,1.93,1.68],[4.51,-5.4,2.14,1.50,1.75],[-5.3,-10,1.6,1.42,3.24],
      [5.0,-15.4,2.42,1.72,3.1],[-2.4,-16.4,.99,.41,1.2]])
      S.rock([x,heightAt(x,z)-.48,z],[sx,sy,sz],shale,{res:.165});
    for (const [x,z,h] of [[-4.1,3.1,2.7],[-4.92,5.5,2.05],[3.65,4.72,2.3],[-4.3,-2.1,2.82],
      [-5.68,-4.66,3.15],[5.3,-7.1,2.55],[-5.2,-12.1,2.4],[4.5,-13.3,2.9],[-4.0,-16.1,2.6]]) {
      const y=heightAt(x,z)-.12;
      S.lathe([x,y,z],h,[.09,.045],wood,{res:.083});
      for (let j=0;j<6;j++)
        S.lathe([x,y+h*(.37+j*.104),z],h*.31,[h*.234*(1-j*.141),.025],bank,{res:.105});
    }

    const bz=-.65, bx=bend(bz);
    for (let i=0;i<17;i++){
      const x=bx+(i-8)*.254, rise=.33-.045*(i-8)**2/8;
      S.box([x,rise,bz],[.126,.063,.46],wood,{res:.070,rd:.035});
      if (i%4===0) for (const z of [bz-.43,bz+.43]) {
        S.lathe([x,rise-.31,z],.94,[.038,.049],wood,{res:.049});
        if (i===4||i===12) S.ball([x,rise+.63,z],.065,ember,{res:.04,ghost:true});
      }
    }
    for (const z of [bz-.43,bz+.43]) {
      S.box([bx,.91,z],[2.13,.034,.036],wood,{res:.055,rd:.022});
      S.box([bx,.25,z],[2.11,.047,.048],wood,{res:.055,rd:.023});
    }

    const hx=3.07,hz=-7.15, floor=heightAt(hx,hz)-.14;
    S.box([hx,floor+.47,hz],[.89,.65,.76],wood,{res:.097,rd:.052});
    for (const sign of [-1,1]) S.box([hx+sign*.46,floor+1.17,hz],[.60,.07,.88],roof,
      {res:.075,rd:.033,ax:B.frame(0,0,-sign*.45)});
    S.box([hx-.21,floor+.62,hz+.774],[.16,.21,.031],ember,{res:.059});
    const chimney=[hx-.36,floor+1.72,hz+.17];
    S.box([chimney[0],chimney[1]-.27,chimney[2]],[.137,.28,.137],shale,{res:.066});
    S.box(chimney,[.178,.056,.178],shale,{res:.061});
    S.bake();

    const mistNoise=(x,y,z,t)=>clamp(.64+.19*Math.sin(2.9*x+1.64*z-t*.76)*Math.sin(z*1.27-y*2.1)+
      .17*Math.sin(4.7*x-3.0*z+y*2.2+t*.18),0,1);
    const points=Array.from({length:14},(_,i)=>{
      const z=8.1-i*2.07;
      return [bend(z),.16+.09*Math.sin(z*.69),z];
    });
    const river=K.atmosphere.shaped({ id:'river', source:{type:'path',path:K.anim.path(points,{steps:3}),
      radius:[1.30,.95],aspect:.48,feather:.38,noise:mistNoise,breakup:.59,drift:[.18,-.5]},
      color:'#d8e9e4',density:1.16,step:.17,lit:false });
    const ravine=K.atmosphere.shaped({ id:'ravine', source:{type:'terrain',bounds:{min:[-7,-.55,-21],max:[7,1.02,8.8]},
      terrain:heightAt,depth:2.6,ceiling:.99,feather:.39,noise:mistNoise,breakup:.59,drift:[.09,.17]},
      color:'#b0d2e4',density:.92,step:.22,lit:false });

    // Sculpt the plume as geometry and pass its signed field into the cloud asset without baking visible splats.
    const P=K.sculpt(makeSculpt(B)), [cx,cy,cz]=V.add(chimney,[0,.1,0]);
    for (const [dx,dy,dz,rx,ry,rz] of [
      [0,.11,0,.12,.27,.13],[.10,.40,-.07,.20,.25,.20],[.22,.73,-.15,.32,.33,.28],
      [.52,1.07,-.27,.40,.42,.38],[.86,1.41,-.40,.52,.43,.47],
      [1.20,1.72,-.56,.63,.39,.53],[1.52,1.91,-.66,.58,.39,.50]
    ]) P.ball([cx+dx,cy+dy,cz+dz],[rx,ry,rz],shale,{ blend:.18 });
    const smoke=K.procedural.density.fromSdf({
      field:P.modelSource().field,bounds:{min:[cx-.29,cy-.19,cz-1.32],max:[cx+2.18,cy+2.45,cz+.27]},
      feather:.19,noise:mistNoise,breakup:.54
    });
    const plume=K.clouds.asset({ field:smoke,density:5.0,opacity:.92,resolution:[24,24],
      densityResolution:[44,44,30],color:'#bfcccf',lighting:{color:'#f1e2ca',ambient:.36,strength:.48} });
    const effect=controls?.effect ?? 'all';
    if (!['river','plume','ravine','all','off'].includes(effect)) throw new RangeError('Unknown shaped mist example effect');
    const cam=effect==='plume'
      ? { target:[hx+.37,floor+1.75,hz], dist:8.5,pitch:.14,yaw:-.57,sway:0 }
      : { target:[.2,1.08,-5.24],dist:15.65,pitch:.42,yaw:.13,sway:0 };
    return B.finish({
      cam,radius:63,detail:23,dither:0,
      shapedAtmosphere:[river,ravine].filter(v=>effect==='all'||v.id===effect),cloudField:effect==='all'||effect==='plume'?plume:false,
      skyEnvironment:{ defaults:{ zenith:'#4f7299',horizon:'#c8b497',ground:'#637b87',
        sunAltitude:.37,sunAzimuth:-2.53,sunStrength:.28 }},
      aerialPerspective:{start:15,density:.015,contrast:.29}, volumeQuality:{ steps:60, scale:2 }
    });
  }
});
