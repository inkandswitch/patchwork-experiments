const wave = (u, frequency, phase = 0) => Math.sin(2 * Math.PI * (u * frequency + phase));

function paint(width, height, pixel) {
  const pixels = new Uint8Array(width * height * 4);
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const color = pixel(x / width, 1 - y / height, x, y);
    if (color) pixels.set(color, (y * width + x) * 4);
  }
  return { width, height, pixels };
}

const peaks = [[.03,.08,.12,.33],[.12,.17,.24,.56],[.22,.29,.34,.46],[.30,.38,.44,.77],
  [.40,.46,.51,.62],[.44,.52,.60,.93],[.53,.59,.68,.72],[.61,.67,.75,.57],[.70,.77,.83,.82],
  [.78,.82,.88,.64],[.86,.90,.96,.54],[.93,.97,1,.32]];

function mountains() {
  return paint(360,104,(u,v,x,y) => {
    let ridge = .23, face = 0;
    for (const [left, summit, right, height] of peaks) {
      if (u <= left || u >= right) continue;
      const slope = u <= summit ? (u-left)/(summit-left) : (right-u)/(right-summit);
      const h = .20 + (height-.20)*slope + .024*wave(u,37) + .009*wave(u,83);
      if (h > ridge) { ridge = h; face = u <= summit ? 1 : -1; }
    }
    if (v > ridge) return null;
    const cut = ridge - v;
    const lit = face === 1 || wave(u+v*.045,85)> .88;
    if (v > .54 + .028*wave(u,62) && cut < .22 + .055*wave(u+v*.09,31))
      return lit ? [242,197,176,255] : [183,145,166,255];
    if (cut < .036 || (v > .32 && wave(u-v*.045,80) > .87 && (x+y)%4))
      return lit ? [147,126,154,255] : [109,100,138,255];
    if (v < .29 + .031*wave(u,6,.3)) return [135,121,149,255];
    return lit ? [129,112,146,255] : [92,89,128,255];
  });
}

function foothills() {
  return paint(300,72,(u,v,x,y) => {
    const ridge=.49+.13*wave(u,4,.1)+.081*wave(u,9,.2)+.05*wave(u,15)+.017*wave(u,43,.25);
    if (v > ridge) return null;
    const shelf=.34+.072*wave(u,6,.31)+.041*wave(u,14,.11);
    if (v > ridge-.036) return [87,102,126,255];
    if (v > shelf) return [73,87,114,255];
    if (wave(u-v*.064,44) > .7 && (x+3*y)%5 !== 0 && v > .20) return [89,100,121,255];
    return [99,107,127,255];
  });
}

function treeline() {
  return paint(96,46,(u,v,x) => {
    const hill=.38+.13*wave(u,1,.56)+.04*wave(u,3,.2);
    let top=hill, edge=0;
    for (let i=-1;i<9;i++) {
      const base=i/8, d=Math.abs(u-base);
      const height=.16+.12*(.5+.5*wave(base,3,.4));
      const limit=hill + height*(1-d*33) - (x%3)*.014;
      if (d<.031 && limit>top) { top=limit; edge=u>base ? 1 : 0; }
    }
    if (v > top) return null;
    if (v > hill) return edge ? [42,65,76,255] : [55,84,88,255];
    return v > .17+.04*wave(u,2) ? [43,58,78,255] : [50,64,83,255];
  });
}

module.exports = ({ KIT:K, makeBuilder, makeSculpt, HorizonBands }) => ({
  id:'layered-horizon',
  name:'Waystation above the pine line',
  seed:111,
  build(seed) {
    const B=makeBuilder(seed,[
      0x252c49,0x342f46,0x4c3e52,0x685366,0x8e6e76,0xb18b81,0xd0a38b,
      0x273a48,0x365657,0x517370,0x799487,0xaaa788,
      0x57384a,0x774557,0x954a5a,0xbc5a62,0xd8796b,
      0x553e4d,0x8d645b,0xb98266,0xdfa777,0xffd48b,0xffebba
    ]);
    const S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.64,.49,.39]); S.amb=.53; S.sky=.18; S.sunK=.68;
    const stone={r:[1,2,3,4,5,6]}, pine={r:[7,8,9,10]}, moss={r:[7,8,9,10,11]};
    const timber={r:[17,18,19,20]}, roof={r:[12,13,14,15,16]}, light={r:[19,20,21,22],em:true};
    S.lathe([0,-1.25,.75],.70,[4.8,4.67],stone,{res:.13});
    S.lathe([0,-.61,.75],.56,[4.69,4.58],moss,{res:.12});
    for (let i=0;i<29;i++) {
      const a=i*2.39996, r=3.85+.73*Math.sin(i*3.5);
      S.rock([Math.cos(a)*r,-.48,.75+Math.sin(a)*r],[.75,.33+.14*Math.sin(i),.66],i%3?stone:moss,{res:.10});
    }
    for (let i=0;i<11;i++) {
      const x=.23+.29*Math.sin(i*.45), z=3.95-i*.53;
      S.box([x,-.018,z],[.44,.052,.243],stone,{rd:.073,res:.077});
    }
    for (const [x,z,tall] of [[-3.15,-.42,1.82],[-2.56,-1.09,1.21],[3.19,-1.8,1.46],[3.75,-.56,2.0]]) {
      S.lathe([x,0,z],tall,[.084,.055],timber,{res:.066});
      for (let i=0;i<5;i++) S.lathe([x,.26+tall*i*.145,z],tall*.41,[tall*(.22-i*.031),.04],pine,{res:.069});
    }
    const [x,z]=[.69,-1.18], tower={objectId:'waystation',res:.069};
    S.lathe([x,-.12,z],.26,[.80,.77],stone,tower);
    S.lathe([x,.14,z],1.65,[.64,.53],stone,tower);
    S.lathe([x,1.58,z],.19,[.72,.74],timber,tower);
    S.lathe([x,1.77,z],.50,[.50,.49],timber,tower);
    for (let i=0;i<6;i++) {
      const a=i*Math.PI/3;
      S.ball([x+Math.sin(a)*.437,2.00,z+Math.cos(a)*.437],[.115,.148,.115],light,{...tower,res:.047});
    }
    S.lathe([x,2.23,z],.63,[.76,.043],roof,tower);
    S.lathe([x,2.79,z],.24,[.065,.027],timber,tower);
    S.box([x,.38,z+.59],[.154,.37,.040],timber,{...tower,rd:.042});
    S.box([x,1.19,z+.55],[.079,.124,.037],light,{...tower,rd:.035});
    for (const [fx,fz] of [[-1.0,1.76],[1.68,2.35],[-1.53,-.74]]) {
      S.lathe([fx,.02,fz],.78,[.055,.041],timber,{res:.04});
      S.lathe([fx,.71,fz],.093,[.122,.09],roof,{res:.045});
      S.ball([fx,.67,fz],[.064,.088,.064],light,{res:.035});
    }
    S.bake();
    const horizonBands=HorizonBands.compile({camera:{yaw:[-54,57],pitch:[-12,24],distance:[6,19],
      fade:{yaw:13,pitch:4,distance:2}},bands:[
      {id:'snow-peaks',radius:107,height:[-41,27],azimuth:[95,265],image:mountains()},
      {id:'slate-foothills',radius:51,height:[-18,11],azimuth:[84,276],image:foothills()},
      {id:'pine-banks',radius:28,height:[-10,2.9],azimuth:[85,275],image:treeline(),repeat:6}
    ]});
    return B.finish({ cam:{target:[0,1.22,.1],dist:12.2,yaw:-.34,pitch:.072},radius:14,detail:27,dither:.18,
      look:{horizonBands},
      skyEnvironment:{defaults:{zenith:'#44577f',horizon:'#f2bc9f',ground:'#8e879e',sunStrength:0}},
      celestialTracks:{bodies:[{id:'evening-sun',kind:'sun',radius:.063,color:'#ffe4b6',glow:.33,glowRadius:.29,softness:.06,
        keys:[{at:0,azimuth:2.95,elevation:.18}]}]},
      atmosphere:[K.atmosphere.box({id:'valley-haze',min:[-21,-7,-22],max:[21,-.29,18],density:.048,color:'#a6a4af'})],
      splatFields:{fields:[{id:'lamplight-motes',preset:'embers',shape:{at:[.1,.86,1.6],size:[3.0,.6,2]},
        life:{start:-2,rate:15,lifetime:[.7,1.8]},motion:{wind:0,velocity:[.28,.24,-.07]},
        style:{color:0xffd784,endColor:0xe58762,size:.027,opacity:.76}}]}
    });
  }
});
