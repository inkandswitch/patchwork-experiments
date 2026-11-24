module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'windbreak',
  name:'Gusts at the windbreak',
  seed:31,
  build(seed) {
    const B = makeBuilder(seed, [
      0x344b65, 0x364449, 0x536165, 0x718280, 0x92a099, 0xb8bd9e,
      0x354932, 0x527048, 0x769279, 0xa5b389,
      0x56463e, 0x7e6652, 0xa58b69, 0xccb28a,
      0x1b586a, 0x2f8194, 0x83b5c0, 0xcce5de,
      0x70483a, 0x9a5648, 0xce765d, 0xeab67c,
      0x506681, 0x6d8192, 0x8a9c9e, 0xf0d48d, 0xb6ccb0
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.49,.71,.50]); S.amb = .33; S.sky = .20;
    const rock = { r:[1,2,3,4,5] }, grass = { r:[6,7,8,9] }, cut = { r:[10,11,12,13] };
    const water = K.surface.preset('rippling-water',{ r:[14,15,16,17] },{
      normal:{ amplitude:.029, scale:.42, speed:.82 },
      layers:{ sky:{ source:'scene', strength:.59, f0:.42 } }
    });
    for (const [x,z,w,h,d] of [
      [-31,-42,13,12,9],[-16,-48,12,10,7],[0,-50,14,12,8],[15,-46,11,8,6],[30,-39,12,11,8]
    ]) S.rock([x,-1.4,z],[w,h,d],{ r:[22,23,24] },{res:.49});
    S.rock([.12,-1.97,.40],[8.0,2.11,5.3],rock,{res:.22});
    S.box([0,-.15,.45],[6.64,.17,3.41],rock,{res:.17,rd:.26});
    S.box([0,-.009,1.28],[6.1,.116,2.25],grass,{res:.128,rd:.17});
    for (const sign of [-1,1]) {
      const x=sign*3.6;
      S.box([x,.124,.78],[1.71,.101,1.64],cut,{res:.110,rd:.13});
      S.box([x,.22,1.19],[1.10,.070,.74],water,{res:.080,rd:.23,ghost:true});
      for (const z of [.39,2.02]) for (let i=0;i<5;i++)
        S.box([x+(i-2)*.44,.24,z],[.212,.097,.117],rock,{res:.073,rd:.045});
      S.box([x,.29,-1.08],[.55,.21,.53],rock,{res:.08,rd:.095});
      S.lathe([x,.42,-1.08],.47,[.19,.24],cut,{res:.073});
      S.ball([x,.89,-1.08],.11,{r:[20,21],em:true},{res:.048,ghost:true});
    }
    for (let j=0;j<6;j++) for (let i=0;i<7;i++) {
      const z=(i-3)*.66-.13+(j%2)*.19, y=.33+j*.42;
      if (j===5 && Math.abs(z)>1.92) continue;
      S.box([.036*Math.sin(i*4+j),y,z],[.30+.055*Math.cos(i+j),.235,.357],rock,{res:.10,rd:.057});
    }
    S.rock([-.14,.36,2.54],[.94,.73,.87],rock,{res:.095});
    S.rock([.23,.26,-2.52],[.74,.66,1.17],rock,{res:.125});
    const blocker = K.atmosphere.occluder(S.modelSource().field.sdf,{bias:.015,step:.027,steps:42});
    S.bake();

    const fabric = K.procedural.airflow.pinned({reach:1.88, frequency:3, phaseTravel:4.2});
    const reed = K.procedural.airflow.pinned({reach:.95, frequency:3.5, phaseTravel:1.1});
    for (const side of [-1,1]) {
      const x=side*2.7, z=-.03;
      B.stick(x,1.32,z,[0,1,0],1.25,.046,B.P[12],3);
      B.iso(x,2.50,z,.09,B.P[21],3);
      for (let j=0;j<12;j++) for (let i=0;i<17;i++) {
        const u=i/16, v=j/11;
        B.disc(x+.10+1.12*u,2.23-.64*v-.42*u*u,z+.044*Math.sin(u*8+v*2),[0,0,1],.055,.014,
          B.P[j===0||j===11||i===16?21:20],3,fabric(u,u));
      }
      for (let i=0;i<11;i++) {
        const rx=side*(1.12+i*.11), rz=2.16+.25*Math.sin(i*2.6);
        for (let j=0;j<7;j++) {
          const f=j/6;
          B.disc(rx+.044*f,.113+f*(.31+.21*Math.abs(Math.sin(i*1.1))),rz,[0,0,1],.037,.025,
            B.P[j>4?26:8],3,reed(f));
        }
      }
      for (let i=0;i<36;i++) {
        const rx=side*3.59+.49*(B.R()-.5), rz=1.02+.42*(B.R()-.5), a=B.R();
        B.iso(rx,.30,rz,.046+.029*a,B.P[i%3===0?17:16],.90,
          {k:3, wind:true, ph:B.R(), sp:1.84+.41*a, rg:.68+.38*a, ex:.17, nd:true});
      }
      for (let i=0;i<38;i++) {
        const rx=side*3.6+.23*(B.R()-.5), rz=-1.08+.27*(B.R()-.5), a=B.R();
        B.iso(rx,.91,rz,.112+.076*a,B.P[i%3===0?5:24],.43,
          {k:3, wind:true, ph:B.R(), sp:.55+.14*a, rg:.54+.45*a, ex:1.23, nd:true});
      }
    }
    const D = K.procedural.density;
    const smoke = D.fromSdf({
      bounds:{min:[-4.05,.79,-1.62], max:[4.09,2.62,-.60]},
      field:(x,y,z) => Math.min(...[-3.6,3.6].map(c =>
        Math.hypot((x-c)/(.28+.27*(y-.8)), (y-1.55)/.78, (z+1.08)/.42)-1)),
      feather:.24, breakup:.82, windInfluence:1.0,
      noise:(x,y,z,t) => .53+.43*Math.sin(x*8.6+y*4.4-t*1.8)*Math.cos(z*6.3-y*2.5)
    });
    const profiles = {
      breeze:{ windX:.91, windZ:.15, windGust:.74 },
      gust:{ windX:2.82, windZ:.25, windGust:1.18 }
    };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ zenith:'#5287b7', horizon:'#c9dee1', ground:'#4c7488', sunAltitude:.54, sunAzimuth:-.74 },
      profiles, sequences:{ wind:{ duration:6.8, keys:[
        { at:0, profile:'breeze' }, { at:2.20, profile:'gust' }, { at:3.87, profile:'gust' }, { at:5.55, profile:'breeze' }
      ] } }, tracks:[{ id:'wind', sequence:'wind' }]
    });
    const lumps = [[-10,-8,4,3],[-4,-12,4.8,3],[-7,-14,4.3,3],[7,-22,5.6,4],[1,-23,4.8,3.4],[13,-33,6,4],
      [-15,-29,5,5],[-10,-36,5,4],[2,-9,2.6,2],[10,-5,2.8,2],[14,-4,4,3]];
    const cloudField = K.clouds.compile({
      bounds:{ min:[-23,-44], max:[23,12] }, resolution:[70,70], height:6.3, color:'#f2f0df',
      opacity:.85, repeat:true, coverage:(x,z) => {
        let a=0;
        for (const [cx,cz,rx,rz] of lumps) a=Math.max(a,1.22-Math.hypot((x-cx)/rx,(z-cz)/rz));
        return Math.min(1,a*1.65);
      }
    });
    return B.finish({
      cam:{ target:[.1,1.10,-.72], dist:15.25, pitch:.197, yaw:.152, sway:0 },
      radius:47, detail:22, dither:0, skyEnvironment, weatherBinding:true, cloudField,
      cloudShadows:{ strength:.37, softness:.7 },
      atmosphere:[K.atmosphere.field({ field:smoke, density:.34, step:.19, color:'#b0c5c4', lit:false })],
      volumeQuality:{ scale:2 },
      windField:{ gust:{ amplitude:.22, period:1.68 },
        shelter:{ occluder:blocker, reach:7.9, strength:.92, spread:.25, spacing:.26 } }
    });
  }
});
