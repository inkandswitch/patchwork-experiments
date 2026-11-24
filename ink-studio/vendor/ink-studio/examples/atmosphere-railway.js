module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'atmosphere-railway',
  name:'Last train through Alder Gorge',
  seed:31,
  build(seed) {
    const B = makeBuilder(seed, [
      0x1b2638,0x242c3f,0x334456,0x455660,0x647982,0x89a0a0,
      0x213d40,0x2e5250,0x4c6f61,0x788b6e,0x9ba583,
      0x1e2b45,0x294963,0x3a6b88,0x669ea9,0x9fc5c6,0xe0efde,
      0x2d232e,0x4e2c39,0x743b48,0xa45858,0xc77d5a,
      0x5e4945,0x8b6c50,0xc19764,0xf3b971,0xffe7b1,0xfff2d6
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.46,.60,.59]); S.amb=.43; S.sky=.27; S.sunK=.58;
    const rock={r:[1,2,3,4,5]}, moss={r:[6,7,8,9,10]}, far={r:[0,1,2,3]};
    const water={r:[11,12,13,14]}, current={r:[12,13,14,15,16]};
    const iron={r:[17,1,2,3]}, paint={r:[17,18,19,20,21]};
    const brass={r:[22,23,24,25]}, lamp={r:[25,26,27],em:true};
    for (const [x,y,z,w,h,d] of [
      [-12,-.1,-16,8,7,5],[-7.5,-.1,-18,6,4,6],[11,-.2,-14,7,7,5],
      [7.4,-.5,-15,5,5.8,4.1],[10,-.33,-6,5.1,4.7,4],[-10,-.32,-6,4.5,4.0,3.5],
      [-7.3,-.69,1.9,3.4,1.9,3.7],[7.8,-.46,1.5,3.7,2.2,2.7]
    ]) S.rock([x,y,z],[w,h,d],z < -14 ? far : rock,{res:.26});
    for (const [x,z,w,h] of [[-6.1,-4.8,3,2.2],[-8.4,-3.1,4,1.4],[7.3,-3.8,3.3,2.8],[6.6,1.8,2.8,1.1]])
      S.rock([x,0,z],[w,h,2.3],moss,{res:.22});
    for (const [x,z,h] of [[-6.7,-2.9,2.55],[-8.2,-4.3,3.7],[6.5,-4.5,3.6],[8.4,-4.7,4.0],[-7.3,1.7,2.3]]) {
      S.lathe([x,.58,z],h*.97,[.11,.047],rock,{res:.085});
      for(let i=0;i<5;i++)
        S.lathe([x+.038*i,.58+h*(.23+.14*i),z],h*.28,[h*(.24-i*.024),.024],moss,{res:.09});
    }
    const fallX=3.62, fallZ=-5.20, floor=-1.58;
    for (const [x,y,z,w,h,d] of [[2.9,.14,-7.12,2.5,2.13,1.7],[4.6,.5,-8.64,2.6,2.55,2.4],[.77,.28,-7.52,1.3,2.2,1.3]])
      S.rock([x,y,z],[w,h,d],rock,{res:.15});
    for (let i=0;i<9;i++) {
      const wx=fallX-.75+i*.17;
      S.box([wx,.35+.053*Math.sin(i*7.3),fallZ+.055*Math.sin(i*2)],[.096,1.94,.076],
        i%3 ? current : {r:[13,14,15,16]},{res:.076,rd:.04,ghost:true});
    }
    S.box([0,floor-.12,-7],[16,.13,21],water,{res:.47,ghost:true});
    const ring=K.ripple.field({amplitude:.15,scale:.55,speed:2,width:.62,damping:.32,
      drops:[{at:[fallX,floor,fallZ+.26],start:.1,repeat:.60},{at:[fallX-.44,floor,fallZ+.15],start:.50,repeat:.84}]});
    const shallows=K.surface.preset('rippling-water',{r:[11,12,13,14],materialId:'water'},
      {normal:ring.normal,layers:{sun:false,sky:{source:'scene',strength:.59,f0:.45},ripples:{strength:.045}}});
    S.box([0,floor+.005,-7],[12,.028,17],shallows,{res:.53,ghost:true});
    const railY=.42, railZ=-.62;
    for (const x of [-7.7,-3.9,0,3.9,7.7]) {
      S.box([x,-.85,railZ],[.35,1.01,.68],rock,{res:.15,rd:.055});
      S.box([x,.06,railZ],[.54,.15,.93],rock,{res:.14,rd:.07});
      S.box([x-.5,-.45,railZ],[.18,.69,.30],iron,{res:.12,rd:.046,ax:B.frame(0,0,-.55)});
    }
    S.box([0,.22,railZ],[10.6,.19,.82],rock,{res:.19,rd:.1});
    for (let i=0;i<52;i++) S.box([(i-25.5)*.402,railY,railZ],[.13,.072,.72],i%5 ? rock : brass,{res:.093,rd:.032});
    for(const z of [railZ-.43,railZ+.43])
      S.box([0,railY+.113,z],[10.5,.05,.045],{r:[2,3,4,5]},{res:.104,rd:.032});

    const lx=-4.8, lz=2.3;
    S.box([lx,-.72,lz],[1.08,.55,.78],rock,{res:.12,rd:.08});
    S.lathe([lx,-.28,lz],1.63,[.114,.073],iron,{res:.05});
    S.lathe([lx,1.32,lz],.16,[.20,.15],brass,{res:.049});
    S.ball([lx,1.55,lz],[.159,.203,.157],lamp,{res:.045,ghost:true});
    S.lathe([lx,1.75,lz],.15,[.225,.032],iron,{res:.053});
    S.bake();

    const T = K.sculpt(makeSculpt(B)), rig=K.rig(B,T);
    T.sun=S.sun; T.amb=.5; T.sky=.22; T.sunK=.68;
    const tag={tag:'engine',res:.076}, fine={...tag,res:.055};
    T.box([-.15,.85,railZ],[1.62,.16,.55],iron,{...tag,rd:.058});
    T.box([-.93,1.45,railZ],[.62,.53,.49],paint,{...tag,rd:.078});
    T.box([-.97,1.49,railZ+.493],[.242,.175,.018],lamp,{...fine,rd:.036});
    T.box([-.94,2.03,railZ],[.72,.115,.65],iron,{...tag,rd:.082});
    T.tube([[-.54,1.34,railZ],[1.10,1.34,railZ]],.35,.36,paint,tag);
    T.tube([[1.06,1.34,railZ],[1.28,1.34,railZ]],.37,.32,iron,tag);
    T.lathe([.78,1.57,railZ],.62,[.12,.098],iron,fine);
    T.lathe([.78,2.13,railZ],.11,[.157,.139],brass,fine);
    T.lathe([.02,1.65,railZ],.29,[.16,.105],brass,fine);
    T.ball([1.33,1.42,railZ],[.109,.13,.12],lamp,{...fine,ghost:true});
    for (const x of [-1.09,-.36,.64,1.20]) {
      for(const z of [railZ-.43,railZ+.43]) {
        T.tube([[x,.72,z-.072],[x,.72,z+.072]],.23,.23,iron,fine);
        T.tube([[x,.72,z-.082],[x,.72,z+.082]],.122,.122,brass,fine);
      }
    }
    T.box([-2.5,.91,railZ],[.73,.24,.48],paint,{...tag,rd:.06});
    T.box([-2.5,1.20,railZ],[.58,.13,.38],iron,{...tag,rd:.08});
    for (const x of [-2.12,-2.93]) for(const z of [railZ-.40,railZ+.40])
      T.tube([[x,.68,z-.065],[x,.68,z+.065]],.183,.183,iron,fine);
    T.bake();
    const emitters = {
      sockets:{
        'cascade-lip':{p:[fallX,2.19,fallZ+.15],dir:[.10,.24,1]},
        'cascade-base':{p:[fallX,floor+.15,fallZ+.55],dir:[.12,1,.8]},
        'lantern-vent':{p:[lx,1.88,lz+.07],dir:[.2,1,.38]},
        'river-bank':{p:[-.22,floor+.24,-3.98],dir:[.95,.06,.54]}
      },
      emitters:[
        {id:'locomotive-smoke',preset:'smoke',socket:'smokestack',
          life:{rate:13,lifetime:[1.43,2.4]},motion:{speed:.87,spread:.29,drift:[-.55,.14,0]},
          style:{size:.252,growth:3.1,density:2.24,color:'#9ca7ad'}},
        {id:'waterfall-lip',preset:'spray',socket:'cascade-lip',life:{start:-1,rate:166,lifetime:[.54,1.17]},
          motion:{sourceRadius:.73,spread:.83,speed:1.04,gravity:[0,-8.1,0]},
          style:{size:.024,stretch:3.05,opacity:.72}},
        {id:'waterfall-splash',preset:'spray',socket:'cascade-base',life:{start:-1,rate:104},
          motion:{sourceRadius:.58,spread:1.06,speed:1.54},style:{size:.019,stretch:2.4,opacity:.64}},
        {id:'lantern-wisp',preset:'steam',socket:'lantern-vent',life:{start:.4,end:5.4},
          motion:{speed:.72,spread:.21,wind:.44},style:{size:.19,growth:2.37,density:2.55,color:'#dbbfac'}},
        {id:'river-mist',preset:'fog',socket:'river-bank',life:{start:-3,rate:9},
          motion:{speed:.33,spread:.47,sourceRadius:1.28},style:{size:.52,growth:2.8,density:.53,color:'#92b9c9'}}
      ]
    };
    const world = B.finish({
      cam:{target:[-.14,1.62,-1.98],dist:15.8,yaw:.085,pitch:.104,sway:0}, radius:42,detail:21,dither:0,
      skyEnvironment:{defaults:{zenith:'#273b60',horizon:'#927e87',ground:'#213953',sunStrength:0}},
      atmosphereEmitters:emitters, windField:{velocity:[.39,.11],gust:{amplitude:.27,period:2.8}},
      volumeQuality:{scale:2,steps:58},
      volumeLighting:{ambient:.79, sun:{direction:[-.36,.7,.54],intensity:.45,color:'#a9b9d4'},
        points:[{at:[lx,1.56,lz+.14],radius:2.45,color:'#ffd792',intensity:1.83}]}
    });
    const stage=K.stage(world);
    rig.bind(stage);
    stage.socket('smokestack',[.78,2.29,railZ],'engine',[0,1,0]);
    stage.add({update(_dt,t) {
      rig.set('engine',K.M.id(),[0,0,0],[-7.25+2.35*t,.014*Math.sin(t*13),0]);
      rig.apply();
    }});
    return world;
  }
});
