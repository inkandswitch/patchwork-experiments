module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'animated-splat-fields',
  name: 'Four animated splat fields',
  seed: 64,
  build(seed, { controls } = {}) {
    const palettes = {
      aurora: [0x121d39, 0x182944, 0x233b54, 0x365363, 0x546f75, 0x72998e, 0x6ab7aa, 0xe1efd6],
      embers: [0x261d2c, 0x302536, 0x493348, 0x674557, 0x83675f, 0xba8f72, 0xe9a264, 0xffdc9a],
      'dust-wall': [0x3f3035, 0x493535, 0x6a433b, 0x9b6150, 0xbb8160, 0xe0ad7c, 0xffc598, 0xffe3b9],
      wake: [0x171c36, 0x222b43, 0x2d4059, 0x4a506d, 0x647696, 0x7b90a7, 0x87cbbc, 0xd9faea]
    };
    const mode = controls?.effect ?? 'aurora';
    if (!Object.hasOwn(palettes, mode)) throw new Error('Unknown splat field vignette ' + mode);
    const B = makeBuilder(seed, palettes[mode]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.6, .75, .63]);
    S.amb = .46;
    S.sky = .25;
    S.sunK = .62;
    const far = { r: [0, 1, 2, 3] }, rock = { r: [1, 2, 3, 4] }, stone = { r: [2, 3, 4, 5] };
    const accent = { r: [4, 5, 6, 7] }, lamp = { r: [6, 7], em: true };
    const accents = [];
    function marker(x, z, h, broken = false) {
      S.box([x, .06, z], [.40, .13, .37], rock, { res: .095, rd: .06 });
      for (let y=.22; y<h; y+=.38)
        S.box([x+.035*Math.sin(y*8), y, z], [.24,.20,.24], y>h-.44 && broken ? rock : stone,
          { res: .083, rd: .038, ax: B.frame(y*.17,0,0) });
      if (!broken) {
        S.box([x, h+.02, z], [.31, .095, .31], stone, { res: .08, rd: .033 });
        S.ball([x,h+.14,z+.04], [.076,.13,.078], lamp, { res:.031, ghost:true });
        accents.push([x,h+.14,z+.04]);
      }
    }
    for (const [x, y, z, w, h, d] of [
      [-11,.07,-14,5,4.5,4], [-7,.03,-19,5,3.7,4], [4,-.6,-17,7,5,5],
      [10,-.52,-12,4.5,5.4,4], [-12,-.44,-5,5,4.0,4], [10,-.4,-5,3.8,3.4,4]
    ]) S.rock([x,y,z], [w,h,d], far, { res:.29 });
    S.box([0,-.54,-2], [11,.41,10], mode==='dust-wall' ? stone : far, { res:.32, rd:.28 });
    for (let i=0;i<34;i++) {
      const x = (K.hash(seed,i,0)-.5)*19, z = (K.hash(seed,i,1)-.5)*14-2, size=.13+K.hash(seed,i,2)*.58;
      if (Math.abs(x)<1.8 && z>-.5) continue;
      S.rock([x,-.17,z], [size,size*.63,size*.82], i%6 ? rock : stone, { res:.13 });
    }
    let splats, cam, sky;
    if (mode === 'aurora') {
      for (const [x,z,h] of [[-5,1,1.45],[4.5,.2,1.16],[-3.8,-2.2,.72]]) marker(x,z,h);
      for (const [x,z,r] of [[-.3,2.2,1.1],[-6.9,-1.6,2.16],[6.1,-2.7,1.84],[-4.7,2.7,1.34]])
        S.rock([x,-.32,z],[r,.58,r*.68],rock,{res:.145});
      const length=39;
      const crest = (shift, lift) => Array.from({ length }, (_, i) => {
        const x = (i/(length-1)-.5)*31;
        return [x+shift, 4.7+lift+1.0*Math.sin(x*.31)+.36*Math.sin(x*.71), -12+3.6*Math.sin(x*.29+.6)+.3*Math.cos(1.2*x)];
      });
      splats = [
        {id:'main-ribbon',preset:'aurora',shape:{points:crest(0,0),height:2.85,depth:.23},
          life:{start:-4,rate:305},style:{size:.108,stretch:9.2,opacity:.27,color:0x6bfcc2,endColor:0x7f81f4}},
        {id:'upper-ribbon',preset:'aurora',shape:{points:crest(-3,2.0),height:1.6,depth:.30},
          life:{start:-4,rate:145},motion:{wave:[.12,.31,1.4],frequency:.18},
          style:{size:.116,stretch:5.3,opacity:.24,color:0x53b9b4,endColor:0xbd78ce}}
      ];
      cam={ target:[-.55,2.75,-3.7],dist:14.5,yaw:.015,pitch:.012 };
      sky={ zenith:'#101934',horizon:'#364963',ground:'#162337' };
    } else if (mode === 'embers') {
      marker(-3.22,-.64,2.5,true); marker(3.14,-.85,2.32,true);
      K.build.arch(S,[.04,0,-3.37],{span:3.6,height:3.53,depth:.54,thick:.47,block:.39,res:.106,mats:{stone}});
      S.lathe([-.32,.04,.52],.65,[.28,.65],stone,{res:.064});
      S.lathe([-.32,.67,.52],.17,[.72,.62],accent,{res:.062});
      S.ball([-.32,.78,.52],[.52,.17,.51],lamp,{res:.06,ghost:true});
      for (const [dx,dz] of [[-.24,-.12],[.06,.08],[.24,-.09]])
        S.ball([-.32+dx,.89,.53+dz],[.12,.31,.11],lamp,{res:.05,ghost:true});
      splats = [
        {id:'hearth',preset:'embers',shape:{at:[-.32,.98,.52],size:[.95,.29,.75]},life:{start:-3,rate:82},
          motion:{velocity:[.36,1.12,.03],spread:[.32,.48,.40]},style:{size:.039,endScale:.43,stretch:2.1}},
        {id:'banks',preset:'embers',shape:{at:[.22,.28,-1.42],size:[5.5,.35,1.4]},life:{start:-3,rate:30},
          style:{size:.029,opacity:.58}}
      ];
      cam={target:[.1,1.77,-1.1],dist:10.9,yaw:.21,pitch:.12};
      sky={zenith:'#301f37',horizon:'#745a68',ground:'#252132'};
    } else if (mode === 'dust-wall') {
      for (const [x,z,h] of [[-4.4,2,1.54],[2.1,1.0,2.13],[4.1,-1,1.56],[-2.1,-1.9,1.6],[-3.3,-4.2,2.5],[6,2,2.02]])
        marker(x,z,h,true);
      K.build.arch(S,[2.7,0,-5.13],{span:3.0,height:2.85,depth:.46,thick:.42,block:.4,res:.117,mats:{stone}});
      splats = [
        {id:'dune-front',preset:'dust-wall',
          shape:{points:[[-11,.04,-.35],[-4,.08,-.77],[0,.03,-1.22],[4,.07,-1.02],[11,.06,-.43]],height:1.48,depth:1.28},
          life:{start:-4,rate:158},motion:{velocity:[1.4,.21,.74],spread:[.45,.48,.50],wave:[.2,.23,.55],frequency:.39},
          style:{size:.32,endScale:2.3,stretch:1.82,opacity:.17,color:0xf0b47b,endColor:0x9f6d5a}},
        {id:'sand-streams',preset:'dust-wall',shape:{type:'box',at:[-1,-.05,-.5],size:[14,.23,4]},
          life:{start:-3,rate:53,lifetime:[.6,1.4]},motion:{velocity:[1.17,.04,1.36]},style:{size:.076,opacity:.44,color:0xf9cb8b}}
      ];
      cam={target:[.12,1.02,-.95],dist:12.7,yaw:.13,pitch:.15};
      sky={zenith:'#74566c',horizon:'#c89581',ground:'#745051'};
    } else {
      marker(-.2,-.65,2.27); marker(-4.3,1.1,.82); marker(4.64,-.4,.94);
      S.lathe([-.20,-.12,-.59],.20,[1.38,1.20],rock,{res:.1});
      for(const [x,z] of [[-4.3,1.1],[4.64,-.4]]) S.box([x,-.07,z],[.66,.12,.86],stone,{res:.1,rd:.08});
      const path = (radius, y, phase = 0) => Array.from({length: 64},(_, i)=>{
        const a=i/64*2*Math.PI+phase;
        return [Math.cos(a)*radius, y+.44*Math.sin(a*2+.4)+.23*Math.cos(a*3), .63*radius*Math.sin(a)-.6];
      });
      const route = path(4.4,1.02);
      splats = [
        {id:'wake-head',preset:'wake',shape:{points:route,duration:4.6,height:.1,depth:.16},
          life:{start:-4.6,rate:188,lifetime:[.45,1.83]},style:{size:.071,opacity:.78,stretch:2.8,axis:[1,.1,.24]}},
        {id:'wake-echo',preset:'wake',shape:{points:path(4.15,1.45,-.21),duration:4.6,height:.12,depth:.2},
          life:{start:-4.6,rate:91,lifetime:[.48,1.8]},style:{color:0xb4b2ff,endColor:0x664ef0,size:.071,endScale:.45,opacity:.54}}
      ];
      cam={target:[.02,1.05,-.55],dist:11.65,yaw:.19,pitch:.23};
      sky={zenith:'#192248',horizon:'#494f78',ground:'#1e263d'};
    }
    for (const [x,y,z] of accents)
      B.iso(x,y,z,.06,[255,221,159],.40,{em:true,nd:true});
    S.bake();
    return B.finish({
      cam:{ ...cam, sway:0 }, radius:34, detail:20, dither:0,
      skyEnvironment:{defaults:{ ...sky,sunStrength:0 }},
      windField:{velocity:[.37,.14]},
      splatFields:{fields:splats}
    });
  }
});
