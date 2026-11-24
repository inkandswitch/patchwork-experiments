const { spriteAtlas }=require('../cli/sprite-atlas.js');

function camera(t) {
  const p=Math.max(0,Math.min(1,t/6));
  return { target:[0,1.08,0],dist:7.0,yaw:-.06+4.86*p,pitch:.13+.77*Math.sin(Math.PI*p)**2,sway:0 };
}

module.exports=({KIT:K,makeBuilder,makeSculpt})=>({
  id:'relightable-impostor',
  name:'Survey drone atlas on the observatory roof',
  seed:46,
  build(seed) {
    const B=makeBuilder(seed,[
      0x233044,0x28384d,0x3b5265,0x627d8b,0x87959a,0xa6acad,
      0x483b50,0x624c59,0x826465,0xa67f6c,0xbb967c,0xd1ad8e,
      0x306069,0x4e7e82,0x80a5a0,0xa5bbae,
      0x64566b,0x94707c,0xbb8585,0xe0aa91,
      0xc88d57,0xffc665,0xffe9a7,0x5ed8d0,0xb1fff0
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.48,.71,.42]); S.amb=.41; S.sky=.24; S.sunK=.63;
    const slab={r:[1,2,3,4,5]}, brick={r:[6,7,8,9,10,11]}, inlay={r:[12,13,14,15]};
    S.lathe([0,-.58,0],.37,[3.0,3.0],slab,{res:.18});
    S.lathe([0,-.24,0],.22,[3.02,2.96],brick,{res:.163});
    for (let j=-8;j<=8;j++) for (let i=-8;i<=8;i++) {
      const x=i*.36+(j%2)*.17,z=j*.358;
      if (Math.hypot(x,z)>2.79) continue;
      S.box([x,-.019+.009*Math.sin(i*4+j),z],[.174,.043,.173],
        Math.abs(i)<3&&Math.abs(j)<3 ? inlay : (i*13+j*2)%7===0 ? slab : brick,{res:.105,rd:.034});
    }
    const lamp={r:[20,21,22],em:true};
    for (let k=0;k<12;k++) {
      const theta=(k+.5)*Math.PI/6,x=2.66*Math.sin(theta),z=2.66*Math.cos(theta);
      S.lathe([x,.019,z],k%3===0?.40:.16,[.18,.134],slab,{res:.073});
      if (k%3===0) {
        S.ball([x,.462,z],.083,lamp,{res:.044,ghost:true});
        S.lathe([x,.52,z],.09,[.108,.048],brick,{res:.047});
      } else S.box([x,.124,z],[.24,.048,.115],brick,{res:.065,rd:.027,ax:B.frame(theta,0,0)});
    }
    for (const [x,z,s,h] of [[-26,12,13,7.2],[-18,-21,13,11],[-3,-36,16,13],
      [17,-31,12,11],[30,-13,12,10],[27,19,15,8.8],[-8,30,12,8.7]]) {
      S.rock([x,-6,z],[s,h,s*.68],{r:[1,2,3,4]},{res:.56});
      S.rock([x+.32,h*.51-5.15,z+.26],[s*.64,2.2,s*.54],{r:[3,4,5]},{res:.48});
    }
    S.bake();

    const D=makeBuilder(seed,[
      0x21324b,0x24354e,0x405065,0x537589,0x77a0a4,0xa2bec0,
      0x613d37,0x965841,0xbd8459,0xe1ab74,0xffd08c,
      0x276879,0x428c97,0x71b9b0,0xc9e5cf,
      0x359598,0x48d7c8,0x98ffee,0xffad57,0xffdf7f,0xfff4d1,
      0x9c5849,0xc47e5b,0xdfa179,0xf4cb99
    ]);
    const A=K.sculpt(makeSculpt(D));
    A.amb=.88; A.sunK=.10; A.sky=.10;
    const alloy={r:[1,2,3,4,5]}, shell={r:[6,7,8,9,10]}, glass={r:[11,12,13,14]};
    const teal={r:[15,16,17],em:true}, orange={r:[18,19,20],em:true};
    A.box([0,-.005,-.045],[.64,.27,.59],alloy,{res:.043,rd:.128});
    A.box([-.10,.22,-.06],[.54,.16,.52],shell,{res:.043,rd:.117});
    A.box([0,.045,.528],[.51,.209,.094],shell,{res:.036,rd:.075});
    A.box([0,.058,.611],[.377,.147,.045],alloy,{res:.025,rd:.047});
    A.box([0,.058,.661],[.286,.088,.022],glass,{res:.020,rd:.019});
    for (const sign of [-1,1]) {
      A.ball([sign*.121,.058,.682],[.044,.039,.022],teal,{res:.017,ghost:true});
      A.box([sign*.56,-.077,-.21],[.165,.094,.246],shell,{res:.032,rd:.049});
      A.box([sign*.670,-.029,-.23],[.054,.081,.173],alloy,{res:.028,rd:.027});
      for (let i=0;i<3;i++) A.box([sign*.728,-.030,-.33+i*.10],[.015,.023,.030],teal,{res:.017,ghost:true});
      A.lathe([sign*.47,-.279,-.24],.158,[.157,.133],shell,{res:.032});
      A.ball([sign*.47,-.303,-.24],[.110,.046,.110],orange,{res:.027,ghost:true});
    }
    for(let x=-2;x<=2;x++){
      A.box([x*.129,-.011,-.638],[.039,.093,.032],alloy,{res:.023,rd:.019});
      A.ball([x*.129,-.017,-.668],[.027,.053,.013],orange,{res:.019,ghost:true});
    }
    A.lathe([-.34,.365,-.17],.26,[.06,.036],alloy,{res:.032});
    A.ball([-.34,.657,-.17],.055,orange,{res:.020,ghost:true});
    A.box([.327,.28,-.13],[.255,.032,.274],{r:[21,22,23,24]},{res:.029,rd:.029});
    for(let i=0;i<4;i++) A.box([.29+i*.061,.319,-.13],[.018,.018,.22],glass,{res:.016,rd:.011});
    A.bake();
    const source=D.finish({cam:{target:[0,.075,0],dist:2.87,yaw:0,pitch:0,sway:0},radius:2.5,dither:0});
    const atlas=K.sprite.atlas(spriteAtlas(source,{width:58,height:58,directions:12,pitches:[.14,.48,.84],
      maps:['depth','normal','emission'],view:{raw:true}}));
    return B.finish({cam:camera(0),radius:51,detail:24,dither:0,
      spriteAtlases:[K.sprite.placeAtlas({atlas,at:[0,1.14,0],scale:1.29})],
      liveSun:{direction:t=>K.V.norm([-.62+.33*Math.sin(t*.82),.67,.66]),ambient:.44,intensity:.74,shadows:false},
      skyEnvironment:{defaults:{zenith:'#4d789d',horizon:'#dfb9a1',ground:'#526c84',
        sunAzimuth:2.38,sunAltitude:.36,sunStrength:.24}},
      aerialPerspective:{start:9,density:.019,contrast:.37}
    });
  },
  camera,
  animate(world) {
    world.anim={update(_dt,t){ Object.assign(world.cam,camera(t)); }};
    return world;
  }
});
