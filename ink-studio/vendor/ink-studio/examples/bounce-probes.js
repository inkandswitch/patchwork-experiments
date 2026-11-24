module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'bounce-probes',
  name:'Market at the grotto',
  seed:52,
  build(seed) {
    const B=makeBuilder(seed,[
      0x1b2a38,0x2b3e4a,0x40535a,0x556667,0x7b8580,0x9f9f90,0xc5bfaa,0xe4d8b8,
      0x48343e,0x67404a,0x934649,0xbe5650,0xdb785e,0xffa479,
      0x665648,0x8e6f50,0xb78e5b,0xd3ab73,
      0x485745,0x687c53,0x9aa664,0xb8bd7c,0xdccf93,
      0x577c93,0x7398ab,0xabc0ca,0xd9dfd7,0xe7d4aa
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{captureAlbedo:true,pixel:true,amb:.38,sky:.17,sunK:.35});
    const slate={r:[1,2,3,4],albedo:'#87958a'}, paving={r:[3,4,5,6,7],albedo:'#b6b09d'};
    const pale={r:[4,5,6,7,26],albedo:'#dcdac5'}, cave={r:[1,2,3,4,5],albedo:'#7f8d8c'};
    const red={r:[8,9,10,11,12,13],albedo:'#df5246'}, timber={r:[8,14,15,16,17],albedo:'#ad845e'};
    const produce=[{r:[15,16,17,22],albedo:'#d9ba78'}, {r:[18,19,20,21],albedo:'#a9ba6e'},
      {r:[4,6,7,27],albedo:'#e2dabc'}];
    const box=(p,h,m,id,res=.13,rd=.05)=>S.box(p,h,m,{res,rd,objectId:id});
    box([0,-.36,0],[4.12,.26,2.2],slate,'plinth',.165,.115);
    box([0,-.12,0],[3.97,.08,2.12],paving,'paving',.125,.04);
    for(let x=0;x<13;x++) for(let z=0;z<7;z++)
      box([(x-6)*.592,-.024,(z-3)*.568],[.287,.037,.274],paving,'paving',.117,.019);

    for(const x of [-3.70,-.79]) for(const z of [-1.42,.83])
      box([x,.97,z],[.069,.97,.075],timber,'awning frame',.086,.025);
    box([-2.24,1.92,-1.39],[1.53,.072,.078],timber,'awning frame',.094);
    const rail=[-2.24,1.82,.85];
    box(rail,[1.53,.048,.05],timber,'awning frame',.086,.021);
    for(let i=0;i<12;i++) {
      const x=-3.67+i*.261;
      const fabric=i%4===3 ? {r:[8,9,10,12],albedo:'#c74641'} : red;
      for(let z=0;z<8;z++)
        box([x,1.91-.018*z,-1.42+z*.326],[.135,.034,.171],fabric,'red awning',.092,.022);
      box([x,1.699,.896],[.132,.127,.036],fabric,'red awning',.078,.043);
    }
    box([-2.25,1,-1.52],[1.44,.76,.043],red,'red awning',.113,.023);
    for(const x of [-3.18,-1.29]) for(const z of [-.78,.16])
      box([x,.29,z],[.07,.29,.075],timber,'table',.081,.024);
    box([-2.23,.55,-.29],[1.22,.07,.58],timber,'table',.095);
    for(let n=0;n<3;n++) {
      const x=-3.02+n*.79;
      box([x,.636,-.24],[.347,.046,.37],timber,'basket',.071,.047);
      for(let j=0;j<3;j++) for(let k=0;k<2;k++)
        S.ball([x+(j-1)*.17,.755,-.38+k*.24],[.095,.105,.104],produce[n],{res:.058,objectId:'produce'});
      S.ball([x,.875,-.27],.106,produce[n],{res:.059,objectId:'produce'});
    }

    box([2.04,.84,-1.65],[1.83,.86,.195],cave,'grotto stone',.128,.12);
    box([.28,.845,-.63],[.19,.89,1.03],pale,'pale wall',.112,.092);
    box([3.74,.87,-.61],[.23,.92,1.01],cave,'grotto stone',.116,.10);
    box([2.01,1.811,-.62],[1.95,.27,1.14],cave,'grotto stone',.128,.21);
    for(const [x,y,z,a,b,c] of [[.19,.53,.53,.38,.54,.38],[.45,1.37,.49,.42,.48,.33],
      [1,1.91,.45,.77,.28,.34],[2.47,1.99,.48,.75,.27,.41],[3.65,1.18,.50,.4,.81,.41],[3.73,.43,.69,.38,.51,.44]])
      S.rock([x,y,z],[a,b,c],cave,{res:.117,objectId:'grotto stone'});
    box([.88,.32,-.87],[.22,.36,.36],pale,'pale wall',.097,.068);
    box([2.40,.18,-.42],[.59,.19,.48],pale,'grotto statue',.084,.066);
    S.lathe([2.40,.32,-.42],.86,[.31,.21,.25],pale,{res:.075,objectId:'grotto statue'});
    S.ball([2.40,1.22,-.42],[.19,.22,.17],pale,{res:.066,objectId:'grotto statue'});
    const moss={r:[18,19,20],albedo:'#96ae72'};
    for(const [x,z] of [[.69,1.18],[1.01,1.42],[3.39,1.21],[3.52,1.49]])
      S.rock([x,.09,z],[.20,.10,.17],moss,{res:.073,objectId:'moss'});
    S.bake();

    return B.finish({
      cam:{target:[0,.77,-.03],dist:11.65,yaw:.135,pitch:.31,sway:0},
      radius:8,detail:20,dither:0,look:{pixel:true,coverageAware:true,splatCoverage:'continuous'},
      liveSun:{direction:[-.43,.81,.34],ambient:.17,intensity:.51,shadows:true,mapSize:512,
        skyBounce:{color:'#94afc8',intensity:.16},groundBounce:{color:'#c8ae8d',intensity:.09}},
      skyEnvironment:{
        profiles:{
          day:{zenith:'#5c85d4',horizon:'#b4d0f5',ground:'#344559',sunStrength:0},
          amber:{zenith:'#ba7080',horizon:'#ffbf87',ground:'#43343e',sunStrength:0}
        },
        sequences:{ cycle:{duration:8,keys:[{at:0,profile:'day'},{at:4,profile:'amber'}]} },
        tracks:[{id:'sky',sequence:'cycle'}]
      },
      bounceProbes:{samples:144,reach:5.8,bounceStrength:1.35,skyStrength:.36,
        cast:{exclude:[{object:'produce'},{object:'grotto statue'},{object:'basket'}]},
        probes:[
          {id:'market-table',at:[-2.27,.99,-.05],radius:2.62,bounds:{min:[-4.1,-.1,-2],max:[-.28,1.64,1.77],feather:.25}},
          {id:'grotto-mouth',at:[2.06,.66,.56],radius:2.27,bounds:{min:[.12,-.2,-1.52],max:[4.11,1.72,2],feather:.32}},
          {id:'grotto-fill',at:[1.69,.83,-.68],radius:1.92,bounds:{min:[.32,.08,-1.6],max:[3.72,1.58,.66],feather:.22}},
          {id:'walkway',at:[-.01,.36,1.38],radius:1.66,bounds:{min:[-1.81,-.12,.84],max:[1.72,.65,2.16],feather:.23}}
        ]}
    });
  }
});
