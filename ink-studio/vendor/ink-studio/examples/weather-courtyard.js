module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'weather-courtyard',
  name: 'Rain at the pass',
  seed: 38,
  build(seed) {
    const B = makeBuilder(seed, [
      0x354c64, 0x3c4645, 0x5d6965, 0x7d8679, 0xa7a28a,
      0x554c49, 0x85715e, 0xb89a71, 0xd3b78d, 0xe3cda7,
      0x55373b, 0x894e44, 0xb66b54, 0xd28866,
      0x334130, 0x586846, 0x748154, 0x989762,
      0x36586b, 0x61909c, 0x96b9c2, 0xcbdce1,
      0x485263, 0x616f82, 0x79879a,
      0x906440, 0xe3a867, 0xffd993
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.44,.74,.43]);
    S.amb = .32;
    S.sky = .19;
    const stone = { r:[1,2,3,4] }, timber = { r:[5,6,7] }, roof = { r:[10,11,12,13] };
    const moss = { r:[14,15,16,17] }, distant = { r:[22,23,24] };
    const wet = { type:'weather', channel:'wetness', low:.08, high:.69 };
    const paving = K.surface.material({ r:[5,6,7,8,9] }, { layers:{
      soak:{ type:'directionalColor', color:'#3b5260', crossColor:'#3b5260', strength:.8, mask:wet },
      shine:{ type:'reflection', source:'scene', strength:.69, f0:.51, mask:wet }
    } });
    for (const [x,z,w,h,d] of [[-32,-50,14,14,10],[-18,-48,10,10,7],[-6,-58,13,9,8],
      [8,-54,13,11,9],[22,-46,10,14,8],[34,-43,12,17,9],[-13,-29,7,7,6],
      [13,-33,8,7,6],[22,-25,9,8,6]]) {
      S.rock([x,-.65,z],[w,h,d],distant,{ res:.48 });
    }
    S.rock([-.3,-2.25,-1.2],[6.4,2.5,5.1],stone,{ res:.21 });
    S.box([0,-.15,.05],[4.1,.19,2.93],stone,{ rd:.19,res:.16 });
    for (let zi=0;zi<9;zi++) for (let xi=0;xi<13;xi++) {
      const x=(xi-6)*.586+(zi%2)*.05, z=(zi-4)*.59;
      S.box([x,.074+.017*Math.sin(xi*2.5+zi),z],[.286,.073,.283],paving,{ res:.092,rd:.059 });
    }
    for (const [x,z,a,b] of [[3.55,-2.64,.88,.48],[4.1,-.95,1.07,.59],[-4.14,.94,.65,.42],[2.97,2.67,.8,.3]]) {
      S.rock([x,.02,z],[a,b,a*.69],stone,{ res:.12 });
      S.rock([x,b*.70,z],[a*.76,b*.36,a*.54],moss,{ res:.10 });
    }

    const shelterX = -2.45, shelterZ = -.75;
    for (const x of [shelterX-1,shelterX+1]) for (const z of [shelterZ-.68,shelterZ+.68]) {
      S.box([x,.20,z],[.20,.135,.2],stone,{ res:.065,rd:.04 });
      S.lathe([x,.32,z],1.95,[.083,.078],timber,{ res:.064 });
    }
    S.box([shelterX,2.22,shelterZ],[1.19,.11,.83],timber,{ res:.075,rd:.044 });
    for (let i=0;i<5;i++) {
      const span=[1.26,1.18,1.00,.84,.68][i], depth=[.95,.82,.65,.49,.32][i];
      S.box([shelterX,2.36+i*.117,shelterZ],[span,.074,depth],roof,{ res:.076,rd:.057 });
    }
    const lantern = { r:[26,27],em:true };
    S.box([shelterX,1.86,shelterZ+.73],[.15,.19,.15],lantern,{ res:.045,rd:.037 });
    S.lathe([shelterX,2.01,shelterZ+.73],.18,[.19,.033],timber,{ res:.057 });

    for (const x of [.12,2.70]) {
      S.box([x,.24,-1.53],[.23,.13,.23],stone,{ res:.075,rd:.047 });
      S.lathe([x,.36,-1.53],2.93,[.063,.051],timber,{ res:.066 });
      S.ball([x,3.31,-1.53],.11,roof,{ res:.05 });
    }
    S.tube([[.12,2.94,-1.53],[1.41,2.80,-1.53],[2.70,2.94,-1.53]],.032,.032,timber,{ res:.056 });
    const breeze = K.procedural.airflow.pinned({ reach:.88, phase:1, frequency:3.2, phaseTravel:3 });
    S.bake();
    for (let row=0;row<14;row++) for (let col=0;col<23;col++) {
      const u=col/22, v=row/13;
      const y=2.91-.11*Math.sin(Math.PI*u)-v*(.8+.13*Math.sin(Math.PI*u));
      B.disc(.39+2.04*u,y,-1.54+.05*Math.sin(u*7+v*4),[0,0,1],.075,.012,
        B.P[row===0 || row>11 || col<2 || col>20 ? 17 : (row+col)%4===0 ? 19 : 18],3,breeze(u,v));
    }

    const underRoof = (x,z) => Math.abs(x-shelterX)<1.17 && Math.abs(z-shelterZ)<.82;
    K.weather.fall(B,{
      kind:'rain', profile:true, n:1040, seed, top:6.2, box:[-9,7,-11,5],
      ground:(x,z) => underRoof(x,z) ? 2.83 : .16, cols:[19,20,21], speed:8.9, len:.145, size:.016
    });
    const fine = {
      zenith:'#497cb3', horizon:'#e0cbb1', ground:'#526f76', overcast:0, sunStrength:.54,
      rain:0, humidity:.38, windX:.11, windZ:.05, airTemperature:15, fogDensity:.08, daylight:.82
    };
    const storm = {
      zenith:'#40506a', horizon:'#a3b5c1', ground:'#4c6775', overcast:.72, sunStrength:.18,
      rain:.52, humidity:.97, windX:2.9, windZ:-.64, airTemperature:8, fogDensity:1.45, daylight:.25
    };
    const clearing = {
      zenith:'#547ca4', horizon:'#c9cce0', ground:'#698280', overcast:.26, sunStrength:.33,
      rain:0, humidity:.66, windX:.42, windZ:.06, airTemperature:12, fogDensity:.27, daylight:.58
    };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ overcastColor:'#63778b', sunAltitude:.47, sunAzimuth:-.66 },
      profiles:{ fine, storm, clearing }, sequences:{ shower:{ duration:6, loop:false, keys:[
        { at:0, profile:'fine', ease:'hold' }, { at:.6, profile:'fine' }, { at:1.7, profile:'storm', ease:'hold' },
        { at:3.8, profile:'storm' }, { at:4.9, profile:'clearing' }
      ] } }, tracks:[{ id:'weather', sequence:'shower' }]
    });
    return B.finish({
      cam:{ target:[-.24,1.18,-1.23], dist:12.9, pitch:.24, yaw:.13,sway:0 },
      detail:21, radius:55, dither:0,
      skyEnvironment,
      weatherBinding:{ rainFull:.69, fogVolumes:['valley-mist'], surface:{
        width:32, height:24, cell:.27, origin:[-4.32,-3.24], step:.125,
        maxRunoff:.17, wetDiffusion:.009, evaporation:.50,
        forcing:(x,z) => ({ precipitationExposure:underRoof(x,z) ? .045 : 1, shelter:underRoof(x,z) ? .65 : 0 })
      } },
      atmosphere:[K.atmosphere.fog({ id:'valley-mist', bottom:-.9, top:2.22, near:10, far:41,
        density:.054, color:'#a9bcc7' })]
    });
  }
});
