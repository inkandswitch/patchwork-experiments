/* Height, sun, retained wetness and a painted sign all drive the same palette-field interface. */
module.exports = ({KIT:K, makeBuilder, makeSculpt}) => ({
  id:'palette-field-weather',name:'The rain-glazed terrace',seed:52,
  build(seed) {
    const B = makeBuilder(seed,[
      0x202a38,0x303f4a,0x455665,0x687476,0x8f9389,0xa9a58e,0xc0b198,0xcfb897,0xe6d1ad,0xf0dec0,
      0x4b3638,0x735046,0x9e6d56,0xc58a61,0xe5aa77,0xffd89b,
      0x2a4c44,0x46725a,0x729367,0x97a972,0x263b5c,0x34597a,0x5388a5,0x87bac2
    ]);
    const S = K.sculpt(makeSculpt(B));
    const sun = K.V.norm([-.46,.70,.55]);
    Object.assign(S,{sun,amb:.38,sky:.17,sunK:.50});
    const bedding = {r:[1,2,3,4]}, sill = {r:[3,4,5,6]}, stone = {r:[4,5,6,7,8,9]};
    const timber = {r:[0,1,10,11,12]}, roof = {r:[10,11,12,13,14]}, brass = {r:[11,12,13,14,15]};
    const pot = {r:[10,11,12,13,14]}, leaves = {r:[16,17,18,19]};
    const box = (p,h,m,res=.098)=>S.box(p,h,m,{res,rd:res*.56});

    const finishes = ['#777268','#928a7b','#ada396','#c0b5a4','#d9cdb8','#f1e3c9',
      '#1b424b','#245f66','#308184','#49a3a0','#68b9b0','#92cdc0',
      '#29476a','#315a85','#497d9f','#6296b0','#87b6c6','#a8cfd2'];
    const wall = K.surface.material({r:[4,5,6,7,8,9],materialId:'rain-glaze'},{
      signals:{
        course:{type:'axis',axis:'y',space:'world',range:[.43,3.26],interpolation:'linear'},
        sunlight:{type:'light',range:[.03,.59],interpolation:'linear'},
        damp:{type:'weather',channel:'wetness',range:[.012,.29],interpolation:'linear'}
      },
      layers:{
        glaze:{type:'projected',pattern:'hue-brightness',strength:.92,
          projection:{origin:[-4.28,.32,.27],along:[1,0,0],across:[0,1,0]},
          hueBrightness:{palette:finishes,size:[8.56,3.12]},
          axes:{hue:{signal:'course',range:[.43,.61]},brightness:{signal:'sunlight',range:[.57,.98]},
            saturation:{signal:'damp',range:[0,.94]}}},
        sheen:{type:'specular',color:'#c4e1df',roughness:.36,strength:0,drive:{strength:{signal:'damp',to:.33}}}
      }
    });
    box([0,-.33,.10],[4.65,.29,2.01],bedding,.14);
    box([0,1.79,-.13],[4.21,1.49,.20],bedding,.139);
    box([0,.27,.14],[4.27,.103,.39],sill,.089);
    box([0,3.355,.03],[4.30,.105,.39],sill,.072);
    for (let j=0;j<6;j++) for (let i=0;i<14;i++) {
      const x = (i-6.5)*.595, y = .625+j*.470;
      const front = .186+.015*Math.sin(i*3.86+j*1.57);
      box([x,y,front],[.289,.222,.121],wall,.064);
    }
    for (let z=0;z<5;z++) for (let i=0;i<15;i++) {
      const x = (i-7)*.609+(z%2)*.04;
      box([x,-.054,(z-1.18)*.72],[.294,.062,.348],(i+z*2)%7===0 ? stone : sill,.122);
    }
    const shelter = {min:[-4.41,-.72],max:[-.91,1.48],heightAt:()=>3.51};
    const cover = K.procedural.overheadCover.rasterize({surfaces:[shelter]},{spacing:.125});
    for (let ix=0;ix<9;ix++) {
      const x = -4.22+ix*.394;
      box([x,3.583,.41],[.184,.091,1.10],roof,.080);
      box([x,3.532,1.47],[.186,.051,.079],brass,.052);
    }
    box([-2.65,3.404,1.413],[1.77,.077,.103],timber,.062);
    for (const x of [-4.12,-1.11]) {
      box([x,1.67,1.38],[.068,1.64,.078],timber,.049);
      box([x,.17,1.38],[.123,.168,.137],bedding,.053);
      S.tube([[x,2.63,1.39],[x,3.27,.76],[x,3.44,.72]],.058,.059,timber,{res:.046});
    }

    const signAt = [1.50,2.16,.383], signSize = [2.37,.75], sw = 48, sh = 16;
    const motif = [];
    for (let y=0;y<sh;y++) for (let x=0;x<sw;x++) {
      const t = x/sw*2*Math.PI;
      const wave = Math.abs(y-5.4-2.5*Math.sin(t*1.66))<1.35;
      const sunMark = (x-31)**2+(y-10)**2<9;
      const ink = wave || sunMark ? 255 : 0;
      motif.push(ink,ink,ink);
    }
    const origin = [signAt[0]-signSize[0]/2,signAt[1]-signSize[1]/2,signAt[2]];
    const projection = {origin,along:[1,0,0],across:[0,1,0]};
    const sign = K.surface.material({r:[0,1],em:true},{signals:{
      painted:{type:'texture',channel:'red',projection,scale:signSize,interpolation:'linear',
        raster:{width:sw,height:sh,channels:3,frames:[motif]}}
    },layers:{
      pattern:{type:'projected',pattern:'hue-brightness',projection,
        hueBrightness:{palette:['#205760','#d8a65c'],brightness:[.83,.83],saturation:.75,size:signSize},
        axes:{hue:{signal:'painted',range:[.50,.10]}}}
    }});
    box([signAt[0],signAt[1],.355],[1.255,.433,.069],brass,.055);
    box(signAt,[signSize[0]/2,signSize[1]/2,.068],sign,.031);

    for (const [x,z,h] of [[-3.35,.91,.44],[3.57,1.53,.63],[3.16,1.69,.39]]) {
      S.lathe([x,-.015,z],h,[h*.55,h*.80],pot,{res:.066});
      S.lathe([x,h-.043,z],.060,[h*.85,h*.82],roof,{res:.051});
      S.lathe([x,h+.011,z],.027,[h*.67,h*.65],timber,{res:.045});
      for (let i=0;i<6;i++) {
        const a=i*2.399, u=Math.cos(a)*h*.59, v=Math.sin(a)*h*.54;
        S.tube([[x,h,z],[x+u*.73,h+.20+(.11*i%0.32),z+v*.77],[x+u,h+.16+(.14*i%0.36),z+v]],
          .026,.015,leaves,{res:.044});
        S.ball([x+u,h+.18+(.14*i%0.36),z+v],[.093,.068,.09],leaves,{res:.042});
      }
    }
    S.bake();

    const profiles = {dry:{rain:0},rain:{rain:.68},after:{rain:0}};
    const skyEnvironment = {
      defaults:{zenith:'#304e71',horizon:'#a9bbb7',ground:'#465465',sunStrength:.20,daylight:.52,
        humidity:.79,airTemperature:14,sunAltitude:Math.asin(sun[1]),sunAzimuth:Math.atan2(sun[0],sun[2])},
      profiles,sequences:{shower:{duration:5.6,keys:[
        {at:0,profile:'dry',ease:'hold'},{at:.25,profile:'rain',ease:'hold'},{at:2.45,profile:'rain'},
        {at:2.8,profile:'after'}
      ]}},tracks:[{id:'rain',sequence:'shower'}]
    };
    return B.finish({
      cam:{target:[0,1.75,.12],dist:9.74,pitch:.116,yaw:.057,sway:0},radius:14,detail:33,dither:0,
      look:{splatCoverage:'continuous'},skyEnvironment,
      weatherBinding:{rainFull:.70,surface:{
        width:42,height:20,cell:.24,origin:[-5.04,-1.20],step:.10,maxRunoff:.035,
        capacity:.36,wetDiffusion:.002,evaporation:.36,initial:()=>({temperature:14}),
        forcing:(x,z)=>{
          const exposure = K.procedural.overheadCover.exposure(cover,[x,.28,z]);
          return {precipitationExposure:exposure,shelter:1-exposure};
        }
      }}
    });
  }
});
