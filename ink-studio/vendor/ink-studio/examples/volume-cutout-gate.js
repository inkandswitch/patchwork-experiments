module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'volume-cutout-gate',
  name:'Clear passage through the mist gate',
  seed:48,
  build(seed) {
    const B=makeBuilder(seed,[
      0x142238,0x26374d,0x35485b,0x4d5e68,0x647879,0x75918c,
      0x312b39,0x55414c,0x7d5960,0xa2766e,
      0x443b42,0x69514d,0x977466,0xc39476,0xdeb88e,
      0x244854,0x366d76,0x68a59e,0x9ad0b1,
      0x653c2d,0xa6633b,0xd79955,0xffcf79,0xffefbc
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.5,.67,.52]); S.sunK=.72; S.amb=.39; S.sky=.23;
    const slate={r:[1,2,3,4]}, stone={r:[2,3,4,5]}, trim={r:[6,7,8,9]};
    const clay={r:[10,11,12,13,14]}, foliage={r:[15,16,17,18]}, brass={r:[19,20,21,22]};
    const glow={r:[21,22,23],em:true};
    for (const [x,z,w,h,d] of [
      [-13,-18,7.3,7.7,6.1],[-9,-17,5.7,5.5,5.3],[12,-16,6.2,6.3,5.9],
      [9,-9,3.9,5.8,4.5],[-7.6,-5.7,3.3,3.9,4.2],[7.3,-3.7,3.5,3.0,3.3],
      [-4.1,3.7,1.25,1.84,1.55],[4.6,3.3,1.36,1.8,1.86]
    ]) S.rock([x,-.45,z],[w,h,d],slate,{res:.19});
    S.box([0,-.42,-2.8],[5.5,.38,9.8],stone,{res:.225,rd:.181});

    const walk=K.anim.path([[-1.74,.49,6],[-1.05,.49,2.72],[.3,.49,.21],[0,.49,-2.77],[.08,.49,-7.25]],{steps:5});
    for(let i=0;i<=24;i++){
      const u=walk.at(walk.length*i/24), yaw=Math.atan2(u.tan[0],u.tan[2]);
      for (let j=-1;j<=1;j++) S.box([u.p[0]+j*.46*Math.cos(yaw),.047,u.p[2]-j*.46*Math.sin(yaw)],
        [.222,.077,.287],i%3===0?clay:stone,{res:.082,rd:.034,ax:B.frame(yaw,0,0)});
    }
    K.build.arch(S,[0,.10,-2.60],{span:2.60,height:3.28,depth:.68,thick:.38,block:.37,res:.071,mats:{stone:trim}});
    K.build.arch(S,[0,.10,-6.33],{span:2.35,height:3.02,depth:.54,thick:.31,block:.35,res:.079,mats:{stone:stone}});
    for(const side of [-1,1]) {
      for(let i=0;i<9;i++) for(let j=0;j<5;j++)
        S.box([side*1.56,.20+j*.47,-2.9-i*.45],[.22,.234,.226],stone,{res:.092,rd:.030});
      S.box([side*1.28,2.76,-4.76],[.32,.17,1.93],trim,{res:.102,rd:.040});
      for(let i=0;i<8;i++) {
        const x=side*(2.34+.52*Math.sin(i*1.2)),z=5.4-i*.95;
        S.rock([x,-.04,z],[.38,.29,.46],foliage,{res:.101});
      }
    }
    S.box([0,2.99,-4.74],[1.76,.14,1.93],slate,{res:.12,rd:.10});
    const points=[];
    for(const [x,y,z] of [[-2.09,1.03,3.5],[1.36,1.79,-2.18],[-1.35,1.79,-2.18],
      [-.91,1.43,-4.31],[.83,1.43,-5.56]]) {
      S.lathe([x,.02,z],y-.12,[.058,.071],brass,{res:.05});
      S.ball([x,y,z],[.115,.164,.115],glow,{res:.041,ghost:true});
      S.lathe([x,y+.14,z],.105,[.147,.050],brass,{res:.046});
      points.push({at:[x,y,z+.11],color:'#ffdba3',radius:2.24,intensity:1.36});
    }
    S.bake();

    const walker=K.sculpt(makeSculpt(B));
    walker.sun=S.sun;walker.amb=.58;walker.sky=.21;walker.sunK=.65;
    const first=B.count();
    const coat={r:[15,16,17,18]}, face={r:[10,11,13,14]}, hat={r:[19,20,21,22]};
    for(const side of [-1,1]) {
      walker.box([side*.105,.24,.01],[.073,.21,.086],trim,{res:.048,rd:.029});
      walker.box([side*.111,.065,.043],[.085,.056,.124],slate,{res:.043,rd:.025});
      walker.ball([side*.248,.65,.036],[.079,.208,.081],coat,{res:.044});
    }
    walker.lathe([0,.40,0],.54,[.247,.205],coat,{res:.047});
    walker.box([0,.55,-.18],[.178,.24,.09],clay,{res:.048,rd:.06});
    walker.ball([0,1.062,.028],[.153,.183,.157],face,{res:.040});
    walker.box([0,1.077,.170],[.127,.061,.028],{r:[1,2,3]},{res:.024,rd:.020});
    for (const x of [-.059,.059]) walker.ball([x,1.086,.196],[.019,.019,.014],glow,{res:.013,ghost:true});
    walker.lathe([0,1.195,.02],.073,[.203,.185],hat,{res:.043});
    walker.ball([0,1.273,.021],[.141,.084,.142],hat,{res:.038});
    walker.ball([.249,.485,.14],[.046,.060,.044],glow,{res:.025,ghost:true});
    walker.bake();
    const end=B.count();
    const station=t=>K.V.add(walk.at(walk.length*(.15+.193*(.5-.5*Math.cos(t*.92)))).p,
      [.019*Math.sin(t*3.2),-.40+.018*Math.sin(t*7.1),0]);
    const volumeCutouts=K.atmosphere.cutouts({zones:[
      {type:'path',points:walk.points.map(([x,y,z])=>[x,y+.57,z]),radius:.89,aspect:1.60,feather:.61,affects:'fog'},
      {type:'box',min:[-1.18,.06,-3.13],max:[1.18,2.13,-2.19],feather:.43,affects:'fog'},
      {type:'box',min:[-1.19,-.12,-6.67],max:[1.19,2.27,-3.13],feather:.31,affects:'fog'},
      {type:'sphere',at:t=>K.V.add(station(t),[0,1.018,.40]),radius:.73,feather:.59,affects:'fog'}
    ]});
    const fog=K.procedural.density.bounded({ bounds:{min:[-7,-.48,-10.25],max:[7,3.28,9.9]},
      sample(x,y,z,t) {
        const edge=K.clamp((3.28-y)*.74,0,1)*K.clamp((9.9-z)*.70,0,1)*K.clamp((z+10.25)*.73,0,1);
        return edge*(.75+.20*Math.sin(x*1.33+z*.75+t*.23)*Math.cos(y*2.0-z*.38));
      }
    });
    const world=B.finish({
      cam:{target:[-.20,1.17,-1.43],dist:12.35,pitch:.248,yaw:.06,sway:0},radius:42,detail:29,dither:0,
      volumeCutouts, atmosphere:[K.atmosphere.field({field:fog,density:.52,step:.18,color:'#96b8cc',anisotropy:.09})],
      volumeQuality:{scale:2,steps:64},
      volumeLighting:{ambient:.64,points},
      skyEnvironment:{defaults:{zenith:'#254563',horizon:'#607b8e',ground:'#3c6171',sunStrength:0}}
    });
    const initial=world.data.slice(first*16,end*16);
    world.anim={update(_dt,time) {
      const offset=station(time);
      for(let i=first;i<end;i++) for(let axis=0;axis<3;axis++) world.data[i*16+axis]=initial[(i-first)*16+axis]+offset[axis];
    }};
    world.anim.update(0,0);
    return world;
  }
});
