module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'sdf-gatehouse',
  name:'Gatehouse at the tidal canal',
  seed:18,
  build(seed) {
    const B = makeBuilder(seed, [
      0x30465c,0x1c2e42,0x304453,0x496472,0x607c83,0x8ca29d,
      0x543e43,0x805248,0xac7359,0xca9572,0xe3b38d,0xf7d7ac,
      0x294b52,0x416e6d,0x679594,0xa2bdb0,0x274049,0x355a62,0x547e87,
      0x7e544d,0xb68567,0xc6a777,0xffc17a,0xffdf9a,0xffefc4,0x66896f
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{amb:.38,sky:.21,sunK:.68,sun:K.V.norm([-.62,.68,.38])});
    const paving={r:[2,3,4,5],materialId:'slate'};
    const stone={r:[6,7,8,9,10,11],a:1.38,fat:.40,materialId:'sandstone'};
    const trim={r:[12,13,14,15],materialId:'copper'};
    const water={r:[16,17,18],materialId:'canal'};
    const glow={r:[22,23,24],em:true};
    S.box([0,-.37,.22],[3.63,.15,2.8],water,{res:.17,rd:.16,ghost:true});
    S.box([-.12,-.08,.5],[2.88,.17,1.48],paving,{rd:.12,res:.145,objectId:'quay'});
    for(let i=0;i<13;i++)for(let j=0;j<8;j++) {
      const x=(i-6)*.411,z=(j-3.5)*.37+.5;
      S.box([x,.115,z],[.196,.048,.176],paving,{rd:.034,res:.105,objectId:'quay'});
    }
    S.box([.45,1.45,.04],[2.02,1.30,.40],stone,{rd:.055,res:.225,objectId:'gatehouse'});
    // A rectangular lower cut joins the round upper cut to leave a true arched passage.
    S.box([.56,.54,.04],[.82,.72,.68],stone,{neg:true,res:.19,objectId:'gatehouse'});
    S.ball([.56,1.22,.04],[.82,.72,.74],stone,{neg:true,res:.19,objectId:'gatehouse'});
    for(const x of [-1.57,2.48]) {
      for(let j=0;j<6;j++)S.box([x,.35+j*.412,.065],[.245,.208,.52],stone,{rd:.042,res:.17,objectId:'gatehouse'});
      S.box([x,2.87,.06],[.32,.095,.62],trim,{rd:.045,res:.1,objectId:'roof'});
    }
    S.box([.455,2.793,.04],[2.33,.10,.55],stone,{rd:.043,res:.171,objectId:'gatehouse'});
    S.box([.455,2.956,.03],[2.36,.079,.60],trim,{rd:.044,res:.103,objectId:'roof'});
    for(let j=0;j<4;j++)for(let i=0;i<10;i++) {
      const x=-1.36+i*.402+(j%2)*.018,y=3.04+j*.081,z=.45-j*.263;
      S.box([x,y,z],[.202,.061,.157],trim,{rd:.038,res:.108,objectId:'roof'});
    }
    for(const x of [-.9,1.99]) {
      S.lathe([x,2.21,.495],.27,.040,trim,{res:.048,objectId:'ironwork'});
      S.box([x,2.103,.495],[.105,.136,.091],glow,{ghost:true,rd:.032,res:.046});
      S.lathe([x,2.239,.495],.1,[.143,.060],trim,{res:.052,objectId:'ironwork'});
    }
    const boards={r:[19,20,21]};
    for(let i=0;i<6;i++)
      S.box([.57+(i-2.5)*.285,.047,-1.60],[.136,.08,1.10],boards,{rd:.023,res:.094,objectId:'walkway'});
    S.keepRenderSdf = true;
    S.bake();
    return B.finish({
      cam:{target:[.37,1.21,-.06],dist:9.05,pitch:.25,yaw:.23,sway:0},
      radius:8,detail:26,dither:0,look:{sdfAssist:{rules:[{select:{object:'gatehouse'}}]}},
      skyEnvironment:{defaults:{zenith:'#315674',horizon:'#e1a68c',ground:'#496879',sunStrength:0}}
    });
  }
});
