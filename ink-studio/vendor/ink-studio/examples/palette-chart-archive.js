/* A pigment archive uses the same indexed assets as the palette chart exporter. */
const source = require('./palette-charts.json');
const pairs = [[0,5],[2,10],[4,11],[8,7]];

module.exports = ({KIT:K, makeBuilder, makeSculpt}) => ({
  id:'palette-chart-archive',name:'Pigment archive',seed:57,
  build(seed) {
    const B = makeBuilder(seed,[
      0x17212a,0x22313a,0x31424d,0x465960,0x627477,0x87928b,0xb2b2a0,
      0x3d3337,0x5c4845,0x745543,0x9e7453,0xc59c68,0xe4c08a,0xe8dfc5,
      0x283a44,0x345666,0x437e85,0x78c6b7
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.42,.70,.53]),amb:.40,sky:.21,sunK:.45});
    const iron={r:[0,1,2,3]}, frame={r:[1,2,3,4,5]}, steel={r:[2,3,4,5,6]};
    const wood={r:[7,8,9,10,11]}, brass={r:[9,10,11,12]};
    const light={r:[15,16,17],em:true};
    const box=(at,half,mat,res=.086)=>S.box(at,half,mat,{res,rd:res*.52});

    box([0,1.93,-.43],[4.95,2.41,.27],iron,.13);
    for (const x of [-3.52,-1.75,0,1.75,3.52]) box([x,2.15,-.13],[.863,1.91,.057],frame,.098);
    box([0,4.20,-.049],[4.93,.15,.19],iron,.093);
    box([0,4.28,.121],[4.95,.036,.058],brass,.072);
    box([0,.30,.12],[4.91,.22,.30],wood,.118);
    box([0,.488,.31],[4.98,.049,.56],brass,.084);
    box([0,.44,.865],[4.98,.042,.058],wood,.079);
    for (const x of [-4.88,4.88]) {
      box([x,2.20,.105],[.090,1.70,.19],iron,.068);
      for (const y of [.67,3.92]) S.ball([x,y,.29],.053,brass,{res:.034});
    }
    const atlas = K.ascii.atlas();
    const caption = (text,[x,y,z])=>{
      const width = text.length*6, height = 8, size = [width*.034,height*.034];
      const glyphs = Array.from(text,letter=>atlas.chars.indexOf(letter));
      const slots = Array.from({length:width*height},(_,i)=>{
        const px = i%width, py = Math.floor(i/width), glyph = glyphs[Math.floor(px/6)];
        const at = (Math.floor(glyph/atlas.per)*8+py)*atlas.font.w + glyph%atlas.per*6+px%6;
        return atlas.font.data[at] ? 0 : null;
      });
      const sign = K.surface.material({r:[0],em:true},{layers:{lettering:{
        type:'projected',pattern:'indexed',projection:{origin:[x-size[0]/2,y-size[1]/2,z],across:[0,1,0]},
        raster:{width,height,slots,palette:['#f4e2ba'],origin:'top-left',size}
      }}});
      box([x,y,z],[size[0]/2+.032,size[1]/2+.022,.014],sign,.014);
    };
    const display=(id,title,config,x,y,w,h)=>{
      const asset = K.palette.chart({...source,...config});
      box([x,y,.029],[w/2+.12,h/2+.118,.11],iron,.070);
      box([x,y,.129],[w/2+.062,h/2+.063,.024],steel,.053);
      const panel = K.surface.material({r:[0,1],em:true,materialId:id},{layers:{
        chart:{type:'projected',pattern:'indexed',
          projection:{origin:[x-w/2,y-h/2,.17],along:[1,0,0],across:[0,1,0]},
          raster:asset.indexed({size:[w,h]})}
      }});
      box([x,y,.174],[w/2,h/2,.024],panel,.020);
      caption(title,[x,y+h/2+.202,.183]);
      for (const side of [-1,1]) S.ball([x+side*(w/2+.084),y+h/2+.070,.147],.028,brass,{res:.022});
    };

    display('swatch-chart','SWATCHES',{type:'swatches',cell:[22,14]},-3.31,2.95,2.65,1.23);
    display('pair-chart','CLOSEST',{type:'closest-pairs',limit:6,cell:[28,14]},-3.31,1.43,2.65,1.03);
    display('brightness-chart','LIGHT',{type:'brightness',cell:[48,8]},-.88,2.38,1.38,2.36);
    display('saturation-chart','SAT',{type:'saturation',cell:[48,8]},.82,2.38,1.38,2.36);
    display('dither-chart','DITHER MIX',{type:'dither-pairs',pairs,cell:[12,12],labels:false},3.22,2.79,2.78,1.86);
    caption('PIGMENTS',[3.23,1.35,.175]);
    for (const [i,c] of [0,4,5,7,9,10,11].entries()) {
      const x=2.06+i*.40, z=.47+(i%2)*.11;
      const mat=K.surface.material({r:[2,3,4,5],em:true},{layers:{
        pigment:{type:'tint',color:source.palette[c]}
      }});
      S.lathe([x,.54,z],.12,[.155,.149],frame,{res:.039});
      S.lathe([x,.645,z],.031,[.122,.120],mat,{res:.030});
    }
    for (const x of [-4.49,4.48]) {
      box([x,3.99,.34],[.23,.076,.23],wood,.059);
      box([x,3.938,.35],[.183,.026,.176],light,.041);
    }
    S.bake();
    return B.finish({
      cam:{target:[0,2.13,.075],dist:7.84,yaw:.038,pitch:.040,sway:0},
      radius:15,detail:34,dither:0,look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#283941',horizon:'#283941',ground:'#283941',sunStrength:0}}
    });
  }
});
