module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'light-cookies',
  name: 'The Lantern Archive',
  seed: 43,
  build(seed, { controls = {} } = {}) {
    const { design = 'rosette', cookie = true, cast = 1, scatter = 1, core = 1, glow = 1 } = controls ?? {};
    const tide = design === 'tide';
    const B = makeBuilder(seed, [
      0x101727,0x171f30,0x202b3e,0x2d3e50,0x425368,0x5c6c7a,0x75858a,
      0x242936,0x323b49,0x414c59,0x576173,0x697681,0x88938f,
      0x252637,0x392d40,0x543c49,0x704d51,0x946456,0xb88162,0xdba877,
      0x172b33,0x1e3b42,0x294f54,0x3b6865,0x508071,
      0xf48a49,0xffb65c,0xffdc8a,0xfff1ba,0x65e1dc,0xb4f9e7
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{ pixel:true, sun:K.V.norm([-.48,.79,.44]), amb:.27, sky:.14, sunK:.47, shLen:0 });
    const stone = { r:[1,2,3,4,5] }, ash = { r:[7,8,9,10,11] }, ashLight = { r:[8,9,10,11,12] };
    const iron = { r:[13,14,15,16] }, bronze = { r:[14,15,16,17,18,19] };
    const moss = { r:[20,21,22,23,24] };
    const glass = { r:tide ? [23,24,29,30] : [25,26,27,28], em:true, v:.7 };
    const box = (at,half,mat,res=.12,rd=.045,extra) => S.box(at,half,mat,{ res,rd,...extra });

    box([0,-.25,.16],[4.69,.24,2.79],stone,.17,.16);
    box([0,-.052,.09],[4.50,.075,2.53],ash,.16,.065);
    for (let row=0;row<6;row++) for (let column=0;column<11;column++) {
      const x = (column-5)*.79 + (row%2 ? .195 : -.03), z = -1.69+row*.74;
      box([x,.024+.008*Math.sin(row*1.23+column*3.6),z],[.378,.04,.349],
        (row+column*3)%7===3 ? ashLight : ash,.138,.044);
    }
    box([.1,1.83,-1.91],[4.42,1.90,.23],stone,.15,.075);
    for (let row=0;row<9;row++) for (let column=0;column<11;column++) {
      const x = (column-5)*.78 + (row%2 ? .26 : -.06);
      box([x,.208+row*.397,-1.633+.017*Math.sin(column*5+row*3)],
        [.374,.187,.090],(column*5+row*11)%13>9 ? ashLight : ash,.109,.041,{ bump:[.009,7] });
    }
    box([0,3.72,-1.59],[4.57,.122,.26],stone,.125,.069);
    box([0,3.85,-1.60],[4.68,.055,.28],ash,.14,.044);
    box([0,.174,-1.47],[4.40,.143,.16],stone,.111,.06);
    // Separate voussoirs preserve the seams around the carved alcove.
    const arch = .75;
    for (const x of [arch-1.81,arch+1.81]) {
      for (let i=0;i<5;i++) box([x,.42+i*.31,-1.409],[.16,.147,.159],ash,.086,.048);
      box([x,1.92,-1.411],[.24,.088,.172],ashLight,.092,.047);
    }
    for (let i=0;i<13;i++) {
      const a = (i+.5)*Math.PI/13, c = Math.cos(a), s = Math.sin(a);
      const ax = [[c,s,0],[-s,c,0],[0,0,1]];
      box([arch+1.81*c,1.94+1.47*s,-1.422],[.17,.202,.145],
        i===6 ? ashLight : ash,.084,.04,{ax});
    }
    for (const x of [-4.23,4.20]) {
      box([x,1.76,-1.36],[.225,1.54,.23],stone,.115,.064);
      box([x,.325,-1.36],[.31,.19,.29],ash,.10,.075);
      box([x,3.34,-1.39],[.34,.15,.29],ash,.10,.06);
      box([x,2.97,-1.108],[.245,.075,.04],bronze,.086,.038);
    }
    for (const [x,y] of [[-2.89,2.66],[3.38,2.54]]) {
      box([x,y,-1.496],[.275,.46,.061],iron,.067,.062);
      for (const side of [-1,1]) {
        box([x,y+side*.433,-1.409],[.264,.036,.029],bronze,.048,.021);
        box([x+side*.258,y,-1.410],[.035,.422,.035],bronze,.051,.026);
      }
      const diamond = [[.707,.707,0],[-.707,.707,0],[0,0,1]];
      box([x,y+.049,-1.415],[.135,.135,.055],bronze,.053,.023,{ax:diamond});
      box([x,y-.241,-1.414],[.081,.035,.035],bronze,.046,.024);
    }
    for (const [x,y,z,s] of [[-3.82,.4,-.68,.24],[-1.75,.18,-.97,.27],
      [2.89,.31,-.98,.33],[3.64,.21,1.36,.31],[3.99,.28,.92,.23],[-3.76,.19,1.34,.24]]) {
      S.rock([x,y,z],[s,s*.73,s*.78],moss,{res:.079});
      S.rock([x+.17,y-.07,z+.14],[s*.73,s*.44,s*.65],moss,{res:.076});
    }
    for (const [x,z] of [[-3.69,-.81],[3.29,-.69],[3.51,-.56]]) {
      S.lathe([x,.067,z],.36,t=>.13+.075*Math.sin(Math.PI*t),iron,{res:.057});
      S.lathe([x,.40,z],.08,[.14,.12],bronze,{res:.057});
      for (const side of [-1,1])
        S.tube([[x,.438,z],[x+side*.09,.57,z],[x+side*.14,.60,z+.035]],.024,.018,moss,{res:.048});
    }

    // The projector sits just past the brass carrier and follows its cut-paper wheel.
    const [lx,ly,lz] = [-2.59,2.06,2.04];
    box([lx,.11,lz],[.45,.118,.41],stone,.087,.065);
    S.lathe([lx,.18,lz],.47,[.26,.14],bronze,{res:.074});
    S.lathe([lx,.63,lz],.78,[.108,.075],iron,{res:.057});
    S.lathe([lx,1.38,lz],.24,[.14,.25],bronze,{res:.057});
    S.lathe([lx,ly-.44,lz],.14,[.29,.38],iron,{res:.049});
    S.lathe([lx,ly+.36,lz],.31,t=>.39-.31*t,bronze,{res:.050});
    S.ball([lx,ly+.69,lz],[.078,.101,.078],bronze,{res:.044});
    S.ball([lx,ly,lz],[.268,.343,.252],glass,{res:.041,ghost:true,objectId:'lantern-glass'});
    for (let i=0;i<8;i++) {
      const a = i*Math.PI/4, x = Math.sin(a)*.29, z = Math.cos(a)*.275;
      S.tube([[lx+x,ly-.32,lz+z],[lx+x*1.15,ly,lz+z*1.18],[lx+x,ly+.36,lz+z]],
        .027,.021,bronze,{res:.031});
    }
    S.torus([lx,ly+.35,lz],.32,.041,bronze,{res:.05});
    S.torus([lx,ly-.30,lz],.30,.038,bronze,{res:.05});
    S.bake();

    const width = 64, height = 64, duration = 6;
    const mask = Array.from({length:width*height},(_,i)=>{
      const x = 2*((i%width)+.5)/width-1, y = 2*(Math.floor(i/width)+.5)/height-1;
      const r = Math.hypot(x,y), a = Math.atan2(y,x);
      if (tide) {
        const bands = Math.sin(21*r+1.6*Math.sin(3*a)+1.2*x);
        return Math.round(255*K.clamp((bands-.18)*2.35,0,1)*K.clamp((.95-r)*4.9,0,1));
      }
      const outline = .43+.245*Math.cos(6*a);
      const petal = r<outline && r>.164+.053*Math.cos(6*a);
      const ring = Math.abs(r-(.78+.023*Math.cos(6*a)))<.047;
      const holes = Math.abs(r-.895)<.048 && Math.cos(12*a)>.71;
      return petal || ring || holes || r<.101 ? 255 : 0;
    });
    const fog = K.procedural.density.bounded({
      bounds:{ min:[-3.33,.11,-1.525], max:[3.59,3.76,2.74] },
      sample(x,y,z,t) {
        const wisp = .57+.26*Math.sin(x*1.9+z*2.0+t*Math.PI/3)*Math.sin(y*2.69-z*2.18);
        const fade = K.clamp((x+3.33)*1.9,0,1)*K.clamp((3.59-x)*2.4,0,1)*K.clamp((2.74-z)*1.8,0,1);
        const falloff = .26+.63*Math.exp(-1.5*y);
        return fade*wisp*falloff;
      }
    });
    const tint = tide ? '#63ece1' : '#ffb45e';
    return B.finish({
      cam:{target:[.02,1.73,-.18],dist:11.7,yaw:.13,pitch:.20,ortho:true,sway:0},
      radius:12, detail:24, dither:0, look:{splatCoverage:'continuous'},
      atmosphere:[K.atmosphere.field({field:fog, density:.57, step:.135, color:'#c3cee0', anisotropy:0})],
      volumeLighting:{ambient:.18, spots:[{
        at:[lx+.29,ly+.015,lz-.28],
        direction:t=>[2.72+.29*Math.sin(t*Math.PI/3),-.38+.12*Math.cos(t*Math.PI/3),-3.29],
        innerAngle:24, outerAngle:30, radius:10.5, color:tint,
        intensity:7*scatter, surfaceIntensity:46*cast, castsShadow:false,
        cookie:cookie && {width,height,mask,angle:22.5,filter:tide?'linear':'nearest',
          roll:t=>22+42*Math.sin(t*2*Math.PI/duration)}
      }]},
      emissiveFinishes:[{id:'archive-lantern',select:{object:'lantern-glass'},
        core:{color:tide?'#b6fff2':'#ffe39d',strength:1.42*core},
        glow:{color:tint,radius:3,strength:.67*glow,small:{belowPixels:110,radius:1,strength:.45*glow}}
      }]
    });
  }
});
