module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'weather-front',
  name:'From the headland to the valley',
  seed:96,
  build(seed) {
    const B = makeBuilder(seed, [
      0x304962, 0x3f4547, 0x5f6a68, 0x798480, 0x9ba19a,
      0x324739, 0x526d4d, 0x74865d, 0xa3a56e,
      0x615148, 0x92755e, 0xb89972, 0xdfc18f,
      0x4a373e, 0x87524a, 0xad705d, 0xd68e6b,
      0x174459, 0x266078, 0x46869a, 0x8eb9bf,
      0x4d6077, 0x667d8e, 0x81929c, 0xa7b2b0,
      0xebb368, 0xffdd97, 0xc7e1e3
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.57,.73,.38]);
    S.amb = .32;
    S.sky = .17;
    const base = { r:[1,2,3,4] }, turf = { r:[5,6,7,8] }, roof = { r:[13,14,15,16] };
    const wood = { r:[9,10,11] }, glow = { r:[25,26],em:true }, distant = { r:[21,22,23,24] };
    const wet = { type:'weather', channel:'wetness', low:.07, high:.58 };
    const paving = K.surface.material({ r:[9,10,11,12] },{ layers:{
      damp:{ type:'directionalColor', color:'#465962', crossColor:'#4c626b', strength:.82, mask:wet },
      shine:{ type:'reflection', source:'scene', strength:.39, f0:.37, mask:wet }
    } });
    for (const [x,z,w,h,d] of [
      [-30,-46,13,9,10],[-15,-53,11,12,7],[1,-56,15,13,9],[17,-49,12,9,7],[33,-45,11,12,9],
      [-14,-29,7,6.7,5],[2,-37,8,8.5,7],[14,-29,7,7.2,6],[27,-32,8,8.7,6]
    ]) S.rock([x,-1.6,z],[w,h,d],distant,{res:.53});
    S.box([0,-.73,-13],[32,.063,37],{ r:[17,18,19,20] },{res:.67,ghost:true});
    for (const [x,z,sx,sy,sz] of [
      [-8.5,-2.3,5.2,2.1,4.8],[-7.9,2.7,4.8,2.05,4.1],[-6.1,-.35,3.64,2.1,3.7],
      [-3.7,-1.2,2.6,1.41,2.88],[-4.1,1.4,2.52,1.37,3.12], [0,-4.1,3.9,1.42,3.31],
      [4.9,-4.0,5.5,1.31,3.7],[7.1,-1.2,5.1,1.25,3.8],[8.5,-4.5,5.29,2.1,4.34],
      [7.3,2.8,4.8,1.16,4.08],[4.8,1.65,3.8,.95,4.2]
    ]) {
      S.rock([x,-.48,z],[sx,sy,sz],base,{res:.22});
      S.rock([x,sy*.65-.48,z],[sx*.81,sy*.38,sz*.79],turf,{res:.19});
    }

    const tower = [-6.05,1.25,-.8];
    S.lathe(tower,.27,[.89,.77],base,{res:.102});
    S.lathe([-6.05,1.48,-.8],1.96,[.61,.47],paving,{res:.102});
    S.lathe([-6.05,3.37,-.8],.15,[.55,.72],base,{res:.080});
    S.lathe([-6.05,3.52,-.8],.47,[.49,.45],glow,{res:.075,ghost:true});
    for (const [x,z] of [[-.37,.24],[.37,.24],[-.34,-.22],[.34,-.22]])
      S.lathe([-6.05+x,3.52,-.8+z],.48,.051,wood,{res:.057});
    S.lathe([-6.05,3.96,-.8],.48,[.62,.038],roof,{res:.078});
    for (let j=0;j<5;j++) for (let i=0;i<7;i++) {
      const x=-8.10+i*.48,z=.26+j*.48;
      S.box([x,1.22,z],[.227,.084,.229],paving,{res:.092,rd:.035});
    }
    for (let i=0;i<8;i++)
      S.box([-4.96+i*.35,1.24-i*.12,1.30],[.183,.144,.39],paving,{res:.09,rd:.046});

    for (let j=0;j<3;j++) {
      const z=1.56-j*1.22, y=.38+j*.15;
      S.box([4.72,y-.27,z],[2.53,.29,.63],base,{res:.141,rd:.13});
      for (let i=0;i<10;i++)
        S.box([2.46+i*.49,y+.03,z],[.23,.085,.45],i%4===0 ? turf : paving,{res:.105,rd:.048});
    }
    for (const [x,z,y] of [[4.91,-1.64,.75],[7.48,-.65,.61]]) {
      S.box([x,y+.45,z],[.71,.45,.52],paving,{res:.093,rd:.057});
      S.box([x,y+.45,z+.52],[.12,.17,.045],glow,{res:.059,ghost:true});
      for (let j=0;j<5;j++)
        S.box([x,y+.94+j*.13,z],[.83-j*.044,.087,.64-j*.103],roof,{res:.090,rd:.038});
    }
    for (const [x,z,r] of [[8.43,1,.66],[7.95,2.45,.43],[1.72,-2.42,.63],[-8.1,2.86,.53],[4.1,3.4,.68]]) {
      S.rock([x,.47,z],[r,r*.83,r*.86],base,{res:.113});
      S.rock([x,.49+r*.59,z],[r*.82,r*.37,r*.70],turf,{res:.103});
    }
    const cut = K.atmosphere.occluder(S.modelSource().field.sdf,{bias:.017,step:.029,steps:32});
    S.bake();
    const flex = K.procedural.airflow.pinned({ reach:.58, frequency:3, phaseTravel:3 });
    for (const [x,y,z] of [[-4.76,1.22,.63],[3.19,.60,-.15],[6.03,.50,1.85]]) {
      B.stick(x,y+.56,z,[0,1,0],.58,.031,B.P[10],3);
      for (let i=0;i<9;i++) for (let j=0;j<5;j++)
        B.disc(x+.037+i*.063,y+1.07-j*.062-i*.009,z,[0,0,1],.040,.011,
          B.P[j===0||j===4 ? 25 : 16],3,flex(i/8));
    }
    K.weather.fall(B,{ kind:'rain', worldSpace:true, profile:true, seed, n:1470,
      box:[-16,16,-10,8], top:7.8, ground:() => -.69, cols:[19,20,27], len:.18, size:.015, speed:10.3 });

    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{
        zenith:'#4d79a2', horizon:'#edd3af', ground:'#4b6877', sunAltitude:.31, sunAzimuth:-.71,
        sunStrength:.58, rain:0, fogDensity:0, windX:.09, windZ:.04, airTemperature:12, humidity:.41, daylight:.75
      },
      profiles:{ squall:{ rain:.72, fogDensity:1.6, windX:1.95, windZ:.67, airTemperature:7, humidity:.97, daylight:.24 } }
    });
    const front = { id:'coastal-squall', profile:'squall', radius:[6,5.8], feather:.43, route:[
      { at:0, xz:[-14,.45] }, { at:2, xz:[-5.7,.22] }, { at:4.4, xz:[.20,-.85] },
      { at:6.2, xz:[5.6,-.15] }, { at:8.6, xz:[16,-2.3] }
    ] };
    return B.finish({
      cam:{ target:[.1,.98,-1.6],dist:22.4,pitch:.31,yaw:.045,sway:0 },
      radius:45, detail:22, dither:0, skyEnvironment,
      precipitation:{ occluder:cut, lightStrength:.46 },
      atmosphere:[K.atmosphere.fog({ id:'front-mist', density:.137, color:'#a7bfd2',
        bottom:-.65, top:6.05, near:5.5, far:40 })],
      lights:[{p:[-6.05,3.74,-.54],radius:3.5,intensity:2.1,color:[1,.71,.39]}],
      weatherBinding:{ fronts:[front], rainFull:.76, fogVolumes:['front-mist'], surface:{
        width:47, height:23, cell:.46, origin:[-10.8,-5.1], step:.125, maxRunoff:.06, wetDiffusion:.011,
        capacity:1, evaporation:.33
      } }
    });
  }
});
