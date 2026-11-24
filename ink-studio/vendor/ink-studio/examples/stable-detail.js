module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'stable-detail',
  name: 'Detail at a distance',
  seed: 41,
  build(seed) {
    const B = makeBuilder(seed, [
      0x122231, 0x253944, 0x394f58, 0x657876, 0x8b9e92, 0x385f64, 0x6b8e79,
      0x654937, 0xa06e4b, 0xbf9060, 0xeac487, 0xffefc3, 0xadc9b4
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{amb:.38,sky:.2,sunK:.54,sun:K.V.norm([-.32,.56,.77])});
    const frame={r:[1,2,3,4]}, wood={r:[7,8,9]};
    const enamel=K.surface.material({r:[1,5,6]},{layers:{
      softLight:{type:'specular',roughness:.45,color:'#a5c9bb',strength:.24},
      flecks:{type:'specular',roughness:[.16,.21],color:'#ffebc2',strength:1,detailSize:.093,
        mask:{type:'checker',axis:'x',cross:'y',scale:.098}}
    }});
    for (const x of [-1.8,0,1.8]) {
      S.box([x,0,0],[.825,.925,.185],frame,{res:.115,rd:.10});
      S.box([x,-.87,.14],[.68,.04,.10],wood,{res:.097,rd:.04});
    }
    for (const x of [-1.8,0,1.8])
      S.box([x,.02,.197],[.67,.70,.028],x===1.8 ? enamel : {r:[5,6]},{res:.108,rd:.03});
    S.bake();

    const tileRow = cs => cs.reduce((sum,c,i)=>sum+c*64**i,0);
    const light=tileRow([12,5,12,5]), dark=tileRow([5,12,5,12]);
    for (let j=-3;j<=3;j++) for (let i=-3;i<=3;i++) {
      B.fineTile(light,dark,light,dark,.101,0,0,0,.101,0,B.P[5]);
      B.disc(-1.8+i*.172,j*.176,.247,[0,0,1],.102,.018,B.P[5],3);
      B.disc(i*.18,j*.18,.255,[0,0,1],.038,.020,B.P[(i+j)%3===0?11:10],2,{nd:true});
    }
    return B.finish({
      cam:{target:[0,.02,0],dist:14.4,yaw:.02,pitch:.015,sway:0},
      surfaceLight:[[0,.06,.09,1]],radius:5,detail:23,dither:0,look:{fine:true,stableDetail:true}
    });
  }
});
