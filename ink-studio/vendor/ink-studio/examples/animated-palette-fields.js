/* Three timed palette effects share the observatory shot clock. */
const duration = 4;
const dusk = ['#f7b36e','#e78b75','#c6627d','#9e557d','#734a76','#523e69','#363456','#242c4f'];
const night = ['#57869e','#487597','#3d648e','#344f7b','#2c406a','#25365e','#1e2a4e','#161f3e'];
const spell = ['#11243d','#234c6f','#286f89','#4cb2b4','spark','#8a7660','#63414a','#a35e6b','#d49583'];
const midnightSpell = ['#121c41','#28346d','#4b459b','#8d72ca','#d3a5e7','#765d98','#4b325d','#795099','#b186cf'];

module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'animated-palette-fields', name:'The chromatic observatory', seed:102,
  build(seed,{ controls }={}) {
    const stepped = controls?.mode === 'cut';
    const animation = (next, protect)=>({
      interpolation:stepped ? 'step' : 'smooth', playback:stepped ? 'clamp' : 'pingpong',
      keys:[{time:0},{time:duration,...next}], ...(protect && { protect })
    });
    const recipe = K.palette.recipe({
      background:'#181d2d', anchors:{ slate:'#3e5473', bronze:'#a76d45', inset:'#202744' },
      roles:{
        slate:{anchor:'slate',steps:7,lightness:[.19,.72],chromaScale:[.75,.75,.39]},
        bronze:{anchor:'bronze',steps:5,lightness:[.25,.8],chromaScale:[.60,.9,.53]},
        inset:{anchor:'inset',steps:4,lightness:[.13,.44]},
        spark:{color:'#ffe38c'}
      }
    });
    const B = makeBuilder(seed,recipe.palette), S = K.sculpt(makeSculpt(B));
    S.sun = K.V.norm([-.62,.66,.42]);
    S.amb = .41; S.sky = .20; S.sunK = .53;
    const stone = {r:recipe.roles.slate}, bronze = {r:recipe.roles.bronze}, recess = {r:recipe.roles.inset};
    const lamp = {r:recipe.roles.spark,em:true};
    const box = (at,half,material,res=.085,rd=res*.6)=>S.box(at,half,material,{res,rd});
    const front = origin=>({origin,along:[1,0,0],across:[0,1,0]});
    const projected = (id,layer)=>K.surface.material({r:recipe.roles.inset,em:true,materialId:id},{layers:{color:layer}});

    box([0,-.24,0],[4.05,.21,2.36],stone,.12);
    box([0,-.067,.27],[3.21,.11,1.94],bronze,.11);
    box([0,.023,.15],[2.96,.071,1.83],stone,.09);
    box([0,1.93,-.29],[2.24,1.82,.93],stone,.088,.18);
    box([0,3.78,-.29],[2.42,.105,1.00],bronze,.087,.12);
    box([0,3.95,-.29],[2.15,.086,.85],stone,.09);
    box([0,2.15,.656],[1.66,1.36,.10],recess,.059,.17);
    const polar = projected('spell-glass',{
      type:'projected',pattern:'polar-colour',projection:front([-1.25,.91,.78]),
      polar:{palette:spell,size:[2.50,2.50],radial:'brightness',rotation:.04,range:[.08,1],saturation:.56,
        animation:animation({palette:midnightSpell},['spark'])}
    });
    box([0,2.16,.76],[1.26,1.26,.034],polar,.044,.019);
    for (const sign of [-1,1]) {
      const x = sign*1.85;
      box([x,1.90,.72],[.125,1.59,.135],bronze,.066,.046);
      for (const y of [.41,3.51]) box([x,y,.75],[.225,.104,.18],bronze,.060);
      S.ball([x,3.39,.903],.083,lamp,{res:.045});
      S.ball([x,1.19,.91],.067,lamp,{res:.040});
      S.tube([[sign*1.70,.48,.87],[sign*1.59,.84,.89],[sign*1.51,.92,.89]],.027,.024,bronze,{res:.032});
    }
    const sweep = projected('spectrum-strip',{
      type:'projected',pattern:'palette-ramp',projection:front([-1.52,.30,.889]),
      paletteRamp:{type:'spectrum',hue:[-.13,.87],saturation:.56,brightness:.89,steps:18,size:[3.04,.34],
        animation:animation({hue:[.87,1.87]})}
    });
    box([0,.47,.715],[1.67,.264,.16],bronze,.070,.079);
    box([0,.47,.876],[1.55,.18,.029],sweep,.046,.025);
    for (let i=0;i<9;i++) {
      const x = (i-4)*.36;
      box([x,.19,1.02],[.12,.033,.23],i%3 ? recess : bronze,.039);
    }
    for (const x of [-3.53,3.53]) {
      S.lathe([x,.036,1.25],.45,[.18,.22,.13,.16],bronze,{res:.065});
      S.ball([x,.545,1.25],.098,lamp,{res:.046});
    }

    for (const [x,y,z,w] of [[-12,.08,-13,8],[10,.05,-16,8],[-19,.38,-23,7],[17,.24,-24,7]]) {
      box([x,y-.38,z],[w,.40,3],recess,.29,.30);
      for (let j=0;j<5;j++) {
        const h = .3+.17*((j+Math.abs(x))%4);
        box([x+(j-2)*w*.35,y+h*.3,z-.28],[.21,h,.31],recess,.14,.09);
      }
    }
    S.bake();
    return B.finish({
      radius:29, detail:37, dither:0, paletteRoles:recipe.roles,
      look:{coverageAware:true,splatCoverage:'continuous'},
      cam:{target:[-.25,1.96,0],dist:10.3,yaw:.13,pitch:.15,sway:0,fov:.62},
      skyEnvironment:{
        defaults:{zenith:'#303552',horizon:'#c57d74',ground:'#27263e',sunStrength:0},
        sky:{paletteField:{source:'elevation',domain:[-.16,.42],field:{
          type:'bands',stops:dusk.map((color,i)=>({at:i/dusk.length,color})),
          animation:animation({palette:night})
        }}}
      },
      transitionReview:{fps:12,neighbors:2,paletteMode:'visible',
        thresholds:{pixelDelta:.10,popFraction:.10,lightingDelta:.065,paletteDelta:.060},
        events:[{id:'first colour shift',at:1},{id:'halfway',at:2},{id:'blue hour',at:3},{id:'night key',at:4}]}
    });
  }
});
