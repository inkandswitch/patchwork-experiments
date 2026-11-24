module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'sheltered-arch',
  name: 'Through the rain gate',
  seed: 83,
  build(seed) {
    const B = makeBuilder(seed, [
      0x648ba3, 0x263d49, 0x415b66, 0x64808c, 0x97aab0,
      0x3a4948, 0x576158, 0x778075, 0xb1ac8b,
      0x3c514b, 0x59715b, 0x82916d, 0xb0ab80,
      0x414143, 0x705845, 0xa57c53, 0xcaa97a,
      0x653b3d, 0x99704c, 0xbe893d, 0xeeb759,
      0xffa347, 0xffd27a, 0xfff3c4, 0xcde9eb, 0x7dbbdb,
      0x3b5768, 0x537686, 0x89aca9
    ]);
    const S = K.sculpt(makeSculpt(B));
    const stone = { r:[5,6,7,8] }, arch = { r:[2,3,4,8] }, slate = { r:[1,2,3,4] };
    const moss = { r:[9,10,11,12] }, mortar = { r:[5,6] }, iron = { r:[1,13,14] };
    const flame = { r:[21,22,23], em:true };
    S.amb = .5;
    S.sky = .22;
    S.sunK = .54;
    S.sun = K.V.norm([-.58,.61,.56]);

    S.box([.65,-.35,0],[11.8,.29,5.1],mortar,{res:.32,rd:.2});
    for (let i=0;i<32;i++) for (let j=0;j<9;j++) {
      const x = -8.6+i*.56+.05*(j%2), z = (j-4)*.49+.035*Math.sin(i*2+j);
      S.box([x,.018+.021*Math.sin(i*4+j*2),z],[.270,.065,.233],
        (i*17+j*7)%11 < 3 ? slate : stone,{res:.113,rd:.041});
    }

    // The fitted stone rings flank a roof with a passage open at both ends.
    for (const x of [.20,3.37,6.60])
      K.build.arch(S,[x,.08,0],{ span:3.55,height:3.96,depth:.42,thick:.44,block:.44,
        face:[-1,0],res:.09,mats:{stone:arch} });
    for (const side of [-1,1]) {
      for (let j=0;j<7;j++) for (let i=0;i<12;i++) {
        const x = .33+i*.56+.10*(j%2);
        const y = .25+j*.48;
        S.box([x,y,side*2.02],[.278,.237,.21+.033*Math.cos(i*4+j)],stone,{res:.125,rd:.041});
      }
      for (const [x,h,r] of [[-.2,4.09,.70],[1.35,4.19,.84],[3.90,4.22,.86],[5.70,4.11,.92],[6.7,3.92,.75]])
        S.rock([x,h,side*1.48],[r,.45,r*1.05],moss,{res:.19});
    }
    S.box([3.40,4.11,0],[3.54,.18,2.15],slate,{res:.175,rd:.12});

    const lights = [];
    for (const [x,z] of [[1.11,-1.71],[2.73,1.70],[4.75,-1.72],[5.58,1.72]]) {
      const sign = Math.sign(z), y = 2.22;
      S.box([x,y+.29,z+sign*.12],[.18,.055,.23],iron,{res:.066,rd:.025});
      S.lathe([x,y-.24,z],.08,[.14,.17],iron,{res:.059});
      S.lathe([x,y+.19,z],.13,[.18,.06],iron,{res:.061});
      S.ball([x,y,z],[.109,.19,.115],flame,{res:.052,ghost:true});
      for (const [dx,dz] of [[-.13,-.11],[-.13,.11],[.13,-.11],[.13,.11]])
        S.lathe([x+dx,y-.17,z+dz],.35,.018,iron,{res:.045});
      lights.push({ p:[x,y-.09,z-sign*.15], radius:2.65, intensity:1.32, color:[1,.64,.31], schedule:'dusk' });
    }

    for (const [x,z,w,h,d] of [
      [-1.1,-3.3,1.6,2.3,1.7],[.86,-4.0,1.3,3.6,1.4],[-.44,3.05,1.03,2.1,1.14],
      [8.93,-3.4,2.1,2.2,1.8],[12.8,3.5,3.1,3.5,2.1],[17,-3.8,3.65,5.4,2.7],[20.2,3.0,3.8,6,3.2]
    ]) {
      S.rock([x,-.24,z],[w,h,d],slate,{res:.21});
      S.rock([x,h*.48-.25,z],[w*.85,h*.52,d*.89],moss,{res:.17});
    }
    for (const [x,z,h] of [[-3.5,-2.9,2.2],[-3.7,2.8,2.8],[8.1,-2.6,2.2],[8.7,2.5,2.9],[12.7,-1.9,3.2]]) {
      S.lathe([x,0,z],h,[.105,.056],{r:[13,14,15]},{res:.085});
      for (let j=0;j<6;j++)
        S.lathe([x,.47*h+j*.088*h,z],h*.23,[h*.29*(1-j*.13),.025],moss,{res:.124});
    }
    S.bake();
    const swaying = K.procedural.airflow.pinned({ reach:.54, frequency:3.8, phaseTravel:4.8 });
    for (const [x,z] of [[-2.56,-1.1],[.90,1.13],[2.54,-1.18],[5.35,1.13],[8.2,-1.08]]) {
      B.stick(x,2.83,z,[0,0,1],.40,.029,B.P[16],3);
      for (let j=0;j<22;j++) for (let k=0;k<12;k++) {
        const u = j/21, v = k/11;
        if (j>16 && Math.abs(v-.5)<.42*(j-16)/5) continue;
        const border = k<2 || k>9 || j<2;
        B.disc(x+.047*Math.sin(v*6.5+u*2.1),2.78-.89*u,z+.40*(v-.5),[-1,0,0],.026,.013,
          B.P[border?20:(k+j)%5<2?18:17],3,swaying(u,u));
      }
    }
    K.weather.fall(B,{ kind:'rain',worldSpace:true,n:1460,seed,top:4.95,ground:()=>.03,
      box:[-8.6,13.7,-3.8,3.8],cols:[24,24,25],len:.136,size:.012,speed:7.2 });

    return B.finish({
      cam:{ target:[.26,1.66,.03], dist:6.1, pitch:.014, yaw:-1.545, sway:0 },
      detail:28, radius:29, dither:0,
      sceneExposure:K.weather.exposure({zones:[
        { min:[-.02,-1.5,-2.02],max:[6.81,4.29,2.02],fade:1.26,rain:0,fog:.04,light:.22,wind:.06 }
      ]}),
      windField:{ velocity:[.85,1.35],gust:{ amplitude:.29,period:2.12 } },
      skyEnvironment:{ defaults:{
        zenith:'#577f9c', horizon:'#a5c3ca', ground:'#648ba3', sunStrength:0
      } },
      atmosphere:[K.atmosphere.box({ min:[-12,.0,-5],max:[24,5.7,5],density:.093,color:'#8eb8ca' })],
      volumeQuality:{ scale:2 },
      lights
    });
  },
  animate(world) {
    // Keep the passage's local lanterns lit throughout the walkthrough.
    world.anim = { daylight:0, update() {} };
    return world;
  }
});
