/* One four-slot dial and material finish, bound to three palette recipe roles. */
const width = 52, height = 62;
const raster = {
  width, height, size: [1.34, 1.63], origin: 'top-left',
  palette: ['shadow', 'body', 'rim', 'emission'],
  slots: Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width), dx = Math.abs(x - 25.5), dy = Math.abs(y - 28.5);
    const diamond = dx + dy * .86;
    if (x < 2 || x > 49 || y < 2 || y > 59) return 0;
    if (x < 4 || x > 47 || y < 4 || y > 57) return 2;
    if (diamond >= 15 && diamond <= 17) return 2;
    if (diamond < 9) return 0;
    if (dx < 2 && dy < 12 || dy < 2 && dx < 12) return 3;
    if (y >= 51 && y <= 53 && x >= 11 && x <= 40) return (x % 5 === 0) ? 0 : x < 27 ? 3 : 2;
    if (y >= 45 && y <= 46 && x >= 18 && x <= 33) return 0;
    return 1;
  })
};

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'surface-palette-roles', name:'Relay colourways', seed:64,
  build(seed) {
    const recipe=K.palette.recipe({
      background:'#1a2634',
      anchors:{ glacier:'#317f9d', ember:'#c36248', orchard:'#688b4e', steel:'#4a6571', brass:'#b8915f' },
      roles:{
        steel:{ anchor:'steel', steps:6,lightness:[.20,.76],chromaScale:[.55,.6,.24] },
        brass:{ anchor:'brass', steps:4,lightness:[.30,.88],chromaScale:[.7,.9,.35] },
        glacier:{ anchor:'glacier', steps:3,lightness:[.29,.81],chromaScale:[.70,1.05,.74] },
        'glacier-light':{ color:'#b9f9ed' },
        ember:{ anchor:'ember', steps:3,lightness:[.29,.80],chromaScale:[.62,1,.70] },
        'ember-light':{ color:'#fff0bd' },
        orchard:{ anchor:'orchard', steps:3,lightness:[.27,.78],chromaScale:[.64,1.16,.82] },
        'orchard-light':{ color:'#edf5a7' }
      }
    });
    const B=makeBuilder(seed,recipe.palette), S=K.sculpt(makeSculpt(B));
    S.sun=K.V.norm([-.54,.72,.62]); S.amb=.30; S.sky=.18; S.sunK=.62;
    const steel={r:recipe.roles.steel}, brass={r:recipe.roles.brass}, black={r:[0,recipe.roles.steel[0]]};
    const box=(p,h,m,res=.059,rd=res*.67)=>S.box(p,h,m,{res,rd});
    box([0,-.18,.0],[4.64,.17,1.49],black,.13,.14);
    box([0,.025,.0],[4.61,.068,1.47],steel,.105,.097);
    box([0,.099,1.403],[4.54,.023,.037],brass,.064);
    for (const x of [-4.2,4.2]) {
      S.lathe([x,.101,1.145],.24,[.18,.13],steel,{res:.05});
      S.ball([x,.37,1.145],.060,brass,{res:.032});
    }

    for (const [i,id] of ['glacier','ember','orchard'].entries()) {
      const x=(i-1)*2.91, z=0;
      const paletteRoles={
        shadow:id+'.shadow',
        body:id+'.midtone',
        rim:id+'.highlight',
        emission:id+'-light'
      };
      const finish=(layers, materialId, em=false)=>K.surface.material({r:recipe.roles.steel,materialId,em},
        {paletteRoles,layers});
      const enamel=finish({
        paint:{type:'tint',color:'body',strength:.84},
        edge:{type:'sheen',color:'rim',strength:.24,power:3}
      },id+'-shell');
      const signal=finish({ core:{type:'tint',color:'emission'} },id+'-signal',true);
      const recessed=finish({ paint:{type:'tint',color:'shadow',strength:.94} },id+'-bezel');
      const dial=finish({ face:{type:'projected',pattern:'indexed',raster,
        projection:{origin:[x-.67,.53,.655],along:[1,0,0],across:[0,1,0]} } },id+'-dial',true);

      box([x,.16,.15],[.97,.067,1.04],brass,.080,.063);
      box([x,.27,.13],[.88,.088,.91],steel,.073,.065);
      box([x,1.38,z],[.83,.99,.56],enamel,.060,.145);
      box([x,1.345,.58],[.746,.880,.086],recessed,.052,.07);
      box([x,1.345,.658],[.67,.815,.027],dial,.037,.022);
      box([x,2.34,z],[.73,.094,.49],enamel,.054,.081);
      S.lathe([x,2.427,-.05],.173,[.24,.16],brass,{res:.037});
      S.ball([x,2.665,-.05],[.159,.133,.162],signal,{res:.032});
      for (const side of [-1,1]) {
        S.tube([[x+side*.78,.39,.39],[x+side*.78,.96,.66],[x+side*.78,1.94,.66],[x+side*.76,2.29,.43]],
          .036,.034,brass,{res:.035});
        for (const y of [.56,2.17]) S.ball([x+side*.77,y,.702],.053,steel,{res:.033});
      }
      for (const j of [-1,0,1]) box([x+j*.23,.266,1.059],[.071,.031,.014],j ? black : signal,.029,.014);
    }
    S.bake();
    return B.finish({
      cam:{target:[0,1.32,.08],dist:10.35,yaw:.17,pitch:.22,sway:0},
      radius:10,detail:28,dither:0,paletteRoles:recipe.roles,
      look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#263847',horizon:'#596d71',ground:'#30404c',sunStrength:0}}
    });
  }
});
