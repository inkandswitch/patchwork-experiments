module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'celestial-estuary',
  name: 'The eclipse at Estuary Watch',
  seed: 129,
  build(seed) {
    const palette = [
      0x171c35, 0x1a2537, 0x293846, 0x40515b, 0x627477, 0x808d88,
      0x293448, 0x3b5358, 0x537167, 0x6a8470, 0xa9aa84,
      0x31283e, 0x514256, 0x79636d, 0xb38b80, 0xd9ac8b,
      0x725048, 0xb37453, 0xf8b576, 0xffdfab, 0xffefd4,
      0x151e33, 0x24394c, 0x345369, 0x648390
    ];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-0.4, .55, -.65]);
    S.amb = .44;
    S.sky = .25;
    S.sunK = .55;
    const basalt = { r: [1, 2, 3, 4] }, dark = { r: [11, 6, 2, 3] };
    const grass = { r: [6, 7, 8, 9, 10] }, masonry = { r: [2, 3, 4, 5] };
    const roof = { r: [11, 12, 16, 17] }, gold = { r: [16, 17, 18] }, glow = { r: [17, 18, 19, 20], em: true };
    for (const [x,y,z,w,h,d] of [
      [-23,-.88,-27,13,4.8,10],[-17,-.77,-23,7,3.4,8],[-21,-.52,-34,15,6.4,6],
      [18,-1,-33,12,4.9,7],[28,-.64,-28,15,7,9],[13,-1.3,-26,8.1,3.5,6],
      [-8,-.63,-13,5.6,2,3.36],[-7.3,-.5,-11.8,4.2,2.1,3.0],
      [-5.3,-.66,-11.7,2.2,1.38,2.67],[-11,-.2,-10,3.9,2.8,4.4]
    ]) S.rock([x,y,z],[w,h,d], x < -14 || x > 10 ? dark : basalt, { res:.26 });
    for (const [x,y,z,w,h,d] of [
      [-8,.80,-11.96,5.2,.44,2.3],[-5.75,.22,-10.8,3.65,.43,2.56],
      [-12.1,1.21,-10.5,4.1,.57,2.8],[-7.33,-.1,-5.35,2.7,.76,2.02],
      [7,-.29,-1.2,1.85,.66,2.25],[8.35,-.35,1.52,3.4,.61,1.9],
      [-4.4,-.41,1.98,2.16,.87,1.77],[-6.1,-.44,3.2,3.58,1.16,3.56]
    ]) {
      S.rock([x,y,z],[w,h,d],basalt,{res:.18});
      S.rock([x-.13,y+h*.44,z-.11],[w*.89,h*.44,d*.91],grass,{res:.17});
    }
    for (const [x,z,h] of [[-8.2,-9.22,2.16],[-12.15,-9.41,2.82],[-6.3,-8.8,1.48],[8.2,-.92,1.87]]) {
      S.lathe([x,.44,z],h*.96,[.094,.032],dark,{res:.064});
      for (let tier=0;tier<5;tier++)
        S.lathe([x+.032*tier,.44+h*(.22+.15*tier),z],h*.23,[h*(.23-.024*tier),.019],grass,{res:.067});
    }
    const x=-4.32, z=-9.95, foot=.53;
    const tower = (y,h,r1,r2,mat,res=.108) => S.lathe([x,foot+y,z],h,[r1,r2],mat,{res});
    tower(0,.28,.83,.81,basalt);
    tower(.27,2.40,.67,.49,masonry,.078);
    tower(.80,.08,.67,.64,basalt);
    tower(2.48,.19,.71,.76,basalt,.078);
    tower(2.66,.14,.75,.66,masonry,.078);
    tower(2.81,.12,.47,.42,gold,.055);
    S.ball([x,foot+3.13,z],[.411,.285,.408],glow,{res:.069,ghost:true});
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      S.lathe([x+.423*Math.cos(a),foot+2.92,z+.423*Math.sin(a)],.48,[.037,.04],roof,{res:.026});
    }
    tower(3.39,.105,.60,.63,gold,.061);
    tower(3.45,.58,.63,.069,roof,.065);
    tower(4.02,.31,.038,.017,gold,.028);
    S.box([x,foot+.42,z+.65],[.14,.29,.057],roof,{res:.052,rd:.045});
    for (const y of [1.24,1.94]) S.box([x+.11,foot+y,z+.57],[.087,.128,.035],glow,{res:.034,rd:.023});
    for (let i=0;i<10;i++) {
      const depth=-1.6-i*.57, cx=-4.15-.11*i;
      S.box([cx,-.035,depth],[.83,.09,.26],i%3 ? masonry : basalt,{res:.122,rd:.04});
      if (i%3===0) for (const side of [-1,1]) {
        S.lathe([cx+side*.69,-.31,depth],.55,[.075,.066],dark,{res:.055});
        if (side===1) S.ball([cx+.69,.267,depth],[.059,.086,.053],glow,{res:.03,ghost:true});
      }
    }
    S.bake();

    const water = K.surface.preset('rippling-water', { r:[21,22,23,24], materialId:'estuary' }, {
      normal:{ type:'noise', amplitude:.047, scale:.95, speed:.54 },
      layers:{ sun:false, sky:{ source:'scene', strength:.90, f0:.74 }, ripples:{ strength:.043 } }
    });
    S.box([0,-.269,-30],[54,.043,67],water,{res:.67,ghost:true});
    S.bake();

    const compass = (at,x,y,extra={}) => ({at,azimuth:Math.PI-x,elevation:y,...extra});
    const transit = {
      radius:.067, softness:.039, start:1.05, end:5.1,
      keys:[compass(1.05,-.088,.127,{ease:'linear',opacity:0}),compass(3.18,.127,.064,{ease:'linear'}),
        compass(5.1,.31,.012,{opacity:0})]
    };
    const bodies = [
      {id:'held-sun',kind:'sun',radius:.081,color:'#ffd79c',softness:.045,glow:.62,glowRadius:.296,
        keys:[compass(0,.127,.064,{ease:'hold'}),compass(4.95,.127,.064),
          compass(7.55,.25,-.11,{opacity:0})]},
      {id:'central-transit',kind:'eclipse',target:'held-sun',...transit,
        keys:transit.keys.map(({opacity,...key})=>key)},
      {id:'transiting-moon',kind:'moon',phase:0,darkColor:'#382a47',darkOpacity:.88,...transit},
      {id:'ivory-moon',kind:'moon',radius:.076,phase:.64,roll:.39,color:'#e9edff',darkColor:'#18223d',glow:.21,
        keys:[compass(4.30,-.35,.239,{opacity:0}),compass(7.4,-.285,.259),compass(9,-.25,.270,{phase:.74})]},
      {id:'rose-moon',kind:'moon',radius:.052,phase:-.42,roll:-.27,color:'#e9afd7',darkColor:'#251c40',glow:.19,
        keys:[compass(4.75,.347,.189,{opacity:0}),compass(7.8,.283,.208),compass(9,.258,.219,{phase:-.49})]},
      {id:'bright-traveler',kind:'star',radius:.005,color:'#d5e9ff',glow:.45,glowRadius:.019,
        keys:[compass(5.45,-.10,.328,{opacity:0}),compass(6.65,-.026,.291),compass(9,.084,.23)]}
    ];
    const starColors = ['#eff3ff','#a6bbed','#c5c8f1','#f7c7ae'];
    for (let i=0;i<118;i++) {
      const x=(K.hash(seed,i,1)-.5)*1.38, y=.022+K.hash(seed,i,2)*.46;
      const strength=.37+K.hash(seed,i,3)*.61, radius=.0018+K.hash(seed,i,4)**4*.0038;
      const arrival=4.5+1.62*K.hash(seed,i,5);
      bodies.push({id:'star-'+i,kind:'star',radius,opacity:strength,color:starColors[i%4],
        keys:[compass(arrival,x,y,{opacity:0}),compass(8.3,x+.028,y+.009)]});
    }
    const celestialTracks = K.celestialTracks.compile({primarySun:'held-sun',bodies});
    const skyEnvironment = {
      profiles:{
        amber:{zenith:'#594b78',horizon:'#b8746c',ground:'#33415d',sunStrength:1.12,aerialDensity:.021},
        eclipse:{zenith:'#383e66',horizon:'#83536a',ground:'#273953',sunStrength:1.12,aerialDensity:.024},
        indigo:{zenith:'#171d3a',horizon:'#555382',ground:'#23334b',sunStrength:1.12,aerialDensity:.027}
      },
      sequences:{passage:{duration:10,loop:false,keys:[
        {at:0,profile:'amber'},{at:3.18,profile:'eclipse'},{at:4.60,profile:'amber'},{at:8.15,profile:'indigo'}
      ]}},
      tracks:[{id:'twilight',sequence:'passage'}]
    };
    return B.finish({
      cam:{target:[.1,2.56,-6.45],dist:17.5,yaw:.025,pitch:-.072,sway:0},
      radius:60,detail:24,dither:0,celestialTracks,skyEnvironment,skyReflections:'scene',
      aerialPerspective:{start:12,contrast:.56}
    });
  }
});
