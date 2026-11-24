/* Three ceramic studies glazed with complementary and desaturation fields. */
const copper = require('./complementary-field.json');
const ash = require('./desaturation-field.json');

module.exports = ({KIT:K, makeBuilder, makeSculpt}) => ({
  id:'chroma-glazes', name:'Glaze firing trials', seed:23,
  build(seed) {
    const B = makeBuilder(seed,[
      0x16232a,0x223239,0x30434a,0x45535a,0x5b6666,0x79847e,0xa3ab9a,0x38303b,
      0x58414a,0x826253,0xac8263,0xc39f7e,0xe0c6a1,0x331d2c,0x815043,0xc48258,
      0xe5ab75,0xf5d8a3,0x154955,0x2b6771,0x689185,0xa2b9a2
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.57,.67,.53]),amb:.34,sky:.22,sunK:.50});
    const wood={r:[7,8,9,10,11]}, trim={r:[8,9,10,11,12]}, stone={r:[1,2,3,4]},
      clay={r:[13,14,15,16]}, brass={r:[14,15,16,17]}, dark={r:[0,1,7]}, white={r:[10,12,17]};
    const box = (at,half,mat,res=.095)=>S.box(at,half,mat,{res,rd:res*.58});
    const glaze=(id,chromaField,origin,size,along=[1,0,0],across=[0,1,0])=>K.surface.material({
      r:[2,3,4,5,6,12],materialId:id
    },{
      layers:{
        pigment:{type:'projected',pattern:'chroma-field',strength:.9,projection:{origin,along,across},
          chromaField:{...chromaField,size}},
        gleam:{type:'specular',color:'#ffe9c4',strength:.48,roughness:.24}
      }
    });
    const profile = radii=>t=>{
      const x = t*(radii.length-1), i = Math.min(radii.length-2,Math.floor(x));
      return radii[i]+(radii[i+1]-radii[i])*(x-i);
    };
    const board = (x,y,z,h)=>{
      box([x,y,z],[.86,h,.72],stone,.081);
      box([x,y+h+.032,z],[.89,.039,.76],wood,.060);
    };

    box([0,-.24,.08],[4.9,.19,2.02],stone,.14);
    box([0,-.039,.08],[4.82,.042,2.04],wood,.096);
    box([0,-.071,2.14],[4.94,.11,.105],trim,.091);
    box([0,-.208,2.15],[4.94,.035,.123],dark,.080);
    for (const x of [-3.75,-1.28,1.22,3.70])
      box([x,-.176,2.205],[.06,.075,.064],brass,.041);

    const lx=-2.58, z=-.03;
    board(lx,.13,z,.15);
    const copperGlaze = glaze('neutral-glaze',copper,[lx-.93,.33,z],[1.86,2.53]);
    S.lathe([lx,.33,z],2.48,profile([.47,.55,.74,.83,.84,.76,.62,.43,.27,.27,.34]),copperGlaze,{res:.051});
    S.lathe([lx,.337,z],.105,[.49,.56],clay,{res:.043});
    S.lathe([lx,2.79,z],.084,[.34,.36,.315],copperGlaze,{res:.040});
    S.lathe([lx,2.868,z],.022,[.255,.26],dark,{res:.032});
    S.tube([[lx-.355,2.30,z],[lx-.88,2.16,z],[lx-1.00,1.87,z],[lx-.87,1.61,z],[lx-.68,1.44,z]],
      .095,.072,clay,{res:.044});

    const mx=-.02, mz=.43, mx0=mx-.93;
    const spin = {...copper,opposite:'#6d81ac',route:'decreasing'};
    delete spin.neutralLightness;
    const curvedGlaze = glaze('hue-arc-glaze',spin,[mx0,.05,mz],[1.95,1.80]);
    S.lathe([mx,.027,mz],.23,[.41,.47,.61],clay,{res:.043});
    S.lathe([mx,.18,mz],1.65,profile([.55,.72,.88,.93,.89,.73,.48,.44,.57]),curvedGlaze,{res:.045});
    S.lathe([mx,1.836,mz],.065,[.57,.55],curvedGlaze,{res:.036});
    S.lathe([mx,1.892,mz],.024,[.466,.47],dark,{res:.036});
    for (const dx of [-.68,.68]) S.ball([mx+dx,.99,mz], [.21,.14,.26],curvedGlaze,{res:.039});

    const rx=2.63, rz=-.45;
    board(rx,.29,rz,.30);
    const ashGlaze = glaze('ash-glaze',ash,[rx-.84,.61,rz],[1.68,2.57]);
    S.lathe([rx,.64,rz],2.40,profile([.44,.53,.69,.68,.61,.49,.38,.32,.35,.44]),ashGlaze,{res:.046});
    S.lathe([rx,.639,rz],.102,[.48,.51],clay,{res:.044});
    S.lathe([rx,3.026,rz],.088,[.436,.457,.42],ashGlaze,{res:.039});
    S.lathe([rx,3.107,rz],.023,[.36,.365],dark,{res:.039});
    S.tube([[rx+.27,2.87,rz],[rx+.70,2.75,rz],[rx+.84,2.38,rz],[rx+.74,2.04,rz],[rx+.52,1.90,rz]],
      .084,.072,ashGlaze,{res:.042});

    for (const [x,z0,material] of [[-3.86,1.48,copperGlaze],[1.29,1.56,ashGlaze],[3.79,1.25,white]]) {
      S.lathe([x,.016,z0],.11,[.21,.247,.245],material,{res:.039});
      S.lathe([x,.119,z0],.015,[.178,.178],clay,{res:.035});
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.27,.17],dist:9.03,pitch:.15,yaw:.016,sway:0},radius:14,detail:31,dither:0,
      look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#354b54',horizon:'#40565c',ground:'#2b3942',sunStrength:0}}
    });
  }
});
