module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'stable-dithering',
  name:'Dither study at the tidal observatory',
  seed:52,
  build(seed) {
    const B=makeBuilder(seed,[
      0x192438,0x252a3f,0x37374d,0x524b63,0x766b80,0x998998,0xc5b0a9,
      0x213b46,0x31535d,0x4d7277,0x71928d,0x9eb3a0,
      0x3c333d,0x554750,0x826367,0xa68678,0xc9a48d,
      0x274438,0x4c6559,0x688a76,0x87a68e,0xb4c3a5,
      0x664433,0x8e6547,0xbc8b59,0xe3ad72,0xffd09b,0xffedc6
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.42,.77,.47]); S.amb=.38; S.sky=.24; S.sunK=.57;
    const basalt={r:[1,2,3,4,5],materialId:'basalt'}, stone={r:[12,13,14,15,16],materialId:'stone'};
    const shore={r:[7,8,9,10],materialId:'shore'}, moss={r:[17,18,19,20]}, brass={r:[22,23,24,25]};
    const light={r:[25,26,27],em:true};
    S.box([0,-.49,-.55],[4.9,.45,3.55],basalt,{res:.153,rd:.19});
    for(const [x,y,z,w,h,d] of [
      [-5.7,-.29,-3.1,2.8,2.2,2.1],[5.6,-.29,-3.8,3.2,2.7,3.2],
      [-10,-.64,-10,4.9,3.6,4.2],[9.6,-.54,-12,4.3,3.27,3.7],
      [-3.6,-.55,2.5,1.97,.61,1.31],[4.2,-.48,1.85,1.41,.82,1.87]
    ]) {
      S.rock([x,y,z],[w,h,d],basalt,{res:.20});
      S.rock([x-.07,y+h*.64,z-.16],[w*.84,h*.41,d*.88],moss,{res:.191});
    }
    S.box([-.03,-.045,-.26],[3.26,.16,2.47],stone,{res:.106,rd:.066});
    for(let j=0;j<8;j++) for(let i=-4;i<=4;i++) {
      S.box([i*.65+.07*(j%2),.131,2.01-j*.58],[.313,.035,.28],(j+i)%5 ? stone : basalt,
        {res:.096,rd:.025});
    }
    S.box([0,-.24,2.75],[1.45,.14,.44],basalt,{res:.095,rd:.047});
    S.box([0,-.38,3.16],[1.60,.11,.38],stone,{res:.095,rd:.051});
    S.box([0,-.52,3.5],[1.67,.105,.37],basalt,{res:.096,rd:.056});
    S.box([0,-.75,-7.35],[17,.055,21],shore,{res:.54,ghost:true});
    for(const [x,z,h] of [[-2.75,-.82,2.12],[2.21,-1.66,2.64],[-2.54,1.61,.91],[2.58,1.22,.85]]) {
      S.lathe([x,.16,z],.19,[.32,.29],basalt,{res:.072});
      S.lathe([x,.35,z],h-.31,[.23,.19],stone,{res:.068});
      S.lathe([x,h+.05,z],.137,[.30,.25],basalt,{res:.066});
      S.ball([x,h+.21,z],[.092,.128,.096],light,{res:.035,ghost:true});
      S.lathe([x,h+.35,z],.16,[.142,.025],brass,{res:.037});
    }
    K.build.arch(S,[0,.18,-2.54],{span:2.64,height:2.81,thick:.34,depth:.43,block:.37,res:.09,mats:{stone}});
    for(let i=0;i<5;i++) for(const side of [-1,1])
      S.box([side*(1.81+.235*i),.5,-2.57],[.126,.35,.21],basalt,{res:.084,rd:.039});
    S.lathe([-.02,.156,.22],.23,[.97,.85],basalt,{res:.087});
    S.lathe([-.02,.38,.22],.15,[.87,.71],stone,{res:.066});
    S.lathe([-.02,.53,.22],.15,[.39,.22],brass,{res:.052});
    S.bake();

    const T=K.sculpt(makeSculpt(B)), rig=K.rig(B,T);
    T.sun=S.sun; T.amb=.52; T.sky=.19; T.sunK=.56;
    const body={r:[17,18,19,20,21],materialId:'bronze-glass'};
    const frame={r:[22,23,24,25],materialId:'bronze'};
    const tag={tag:'survey-lantern',res:.055};
    T.lathe([0,.68,0],.17,[.4,.36],frame,tag);
    T.box([0,1.27,0],[.385,.428,.385],body,{...tag,rd:.149});
    T.lathe([0,1.69,0],.14,[.43,.48],frame,tag);
    T.lathe([0,1.83,0],.29,[.48,.095],frame,tag);
    T.ball([0,2.131,0],[.082,.108,.081],light,{...tag,res:.031});
    for(const n of [-1,1]) {
      T.box([n*.27,1.30,.366],[.032,.32,.048],frame,{...tag,res:.033,rd:.015});
      T.box([.366,1.30,n*.27],[.048,.32,.03],frame,{...tag,res:.033,rd:.015});
      T.ball([n*.112,1.34,.386],[.059,.093,.022],light,{...tag,res:.028});
      T.ball([-.386,1.35,n*.115],[.021,.093,.051],light,{...tag,res:.029});
    }
    T.bake();
    const policy=(material,palette)=>({material,palette,dither:{pattern:'bayer',strength:1}});
    const settings={
      dither:'world',spacing:.112,origin:[.012,.021,-.006],
      targets:[{object:'survey-lantern',dither:'object',spacing:.082,origin:[-.013,.009,.017]}]
    };
    const world=B.finish({
      cam:{target:[-.02,1.16,-.21],dist:11.2,pitch:.293,yaw:.28,sway:0},radius:19,detail:21,dither:.55,
      skyEnvironment:{defaults:{zenith:'#303c61',horizon:'#6c667c',ground:'#243a53',sunStrength:0}},
      look:{stable:settings,paletteConstraints:{targets:[
        policy('basalt',['#28314c','#43445e','#665978','#86738c','#a996a4']),
        policy('stone',['#493c58','#74556b','#a27682','#c49a94','#e2b8a6']),
        {...policy('shore',['#24404d','#365969','#537786','#819a9d']),dither:{pattern:'blue-noise',strength:.72,seed}},
        policy('bronze-glass',['#324640','#4b6759','#739484','#95b2a0','#b9cbab']),
        policy('bronze',['#65444a','#956451','#c99160','#e1aa68'])
      ]}}
    });
    const st=K.stage(world);
    rig.bind(st);
    st.add({update(_dt,t) {
      const turn=.24+.41*t, c=Math.cos(turn),s=Math.sin(turn);
      rig.set('survey-lantern',[c,0,s,0,1,0,-s,0,c],[0,0,0],[-.02,.016*Math.sin(t*2.6),.22]);
      rig.apply();
    }});
    return world;
  }
});
