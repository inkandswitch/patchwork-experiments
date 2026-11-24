/* Two polar palette fields in the stone floor of an observatory. */
const { type, ...chart } = require('./polar-colour-field.json');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'polar-colour', name:'The chromatic observatory', seed:24,
  build(seed, { controls } = {}) {
    const B = makeBuilder(seed, chart.palette.map(hex => parseInt(hex.slice(1),16)));
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{ sun:K.V.norm([-.42,.72,.53]), amb:.39, sky:.25, sunK:.64 });
    const stone={r:[1,2,3,4,5]}, trim={r:[2,3,4,5,6]}, brass={r:[15,16,17,13]}, dark={r:[0,1,2,3]};
    const box=(at,half,mat,res=.12)=>S.box(at,half,mat,{res,rd:res*.52});
    box([0,-.49,.05],[4.75,.27,3.02],dark);
    box([0,-.23,.05],[4.62,.113,2.85],stone);
    for(const z of [-2.62,2.7]) for(let i=0;i<14;i++)
      box([(i-6.5)*.64,-.035,z],[.307,.093,.198],i%3 ? stone : trim,.087);
    for(const x of [-4.41,4.41]) for(let i=0;i<9;i++)
      box([x,-.046,(i-4)*.57],[.159,.082,.266],i%3 ? stone : trim,.092);
    box([0,-.17,2.98],[1.50,.10,.31],trim);
    box([0,-.27,3.37],[1.65,.09,.29],stone);

    for(const [i,x] of [-1.82,1.82].entries()) {
      const z=.08, diameter=2.49;
      const colors = i ? {palette:chart.palette,radial:'saturation',brightness:.89,rotation:-.09} : chart;
      const seal = K.surface.material(dark,{layers:{ signal:{
        type:'projected',pattern:'polar-colour',
        projection:{origin:[x-diameter/2,.16,z+diameter/2],along:[1,0,0],across:[0,0,-1]},
        polar:{...colors,size:[diameter,diameter]},
        strength:controls?.seals === false ? 0 : 1
      } }});
      box([x,.004,z],[1.45,.129,1.44],trim,.099);
      box([x,.138,z],[1.32,.022,1.32],seal,.047);
      const ring = 1.295;
      for(let j=0;j<48;j++) {
        const phase=j/48*Math.PI*2, p=[x+Math.cos(phase)*ring,.188,z+Math.sin(phase)*ring];
        if(j%6===0) S.ball(p,[.047,.029,.047],brass,{res:.035});
        else if(j%2===0) S.ball(p,[.030,.019,.030],trim,{res:.031});
      }
      for(const dx of [-1.34,1.34]) for(const dz of [-1.34,1.34])
        box([x+dx,.165,z+dz],[.085,.048,.085],brass,.045);
    }
    for(const [x,z] of [[-3.97,-2.17],[3.97,-2.17],[-3.91,1.84],[3.91,1.84]]) {
      S.lathe([x,.06,z],.78,[.21,.14,.092,.14],trim,{res:.071});
      S.lathe([x,.81,z],.17,[.137,.166,.075],brass,{res:.051});
      S.ball([x,.83,z],.086,{r:[13,14,7],em:true},{res:.044});
    }
    for (const [x,z,r] of [[-6,-3.7,1.4],[6.3,-3.6,2.15],[-6.5,2,1.6],[6.5,3.8,1.4]])
      S.rock([x,-.66,z],[r,r*.6,r*.85],stone,{res:.18});
    S.bake();
    return B.finish({
      cam:{target:[0,.19,.24],dist:11.2,yaw:.13,pitch:.94,sway:0},
      radius:16,detail:28,dither:0,
      skyEnvironment:{defaults:{zenith:'#1a253d',horizon:'#506b84',ground:'#1c2840',sunStrength:0}},
      look:{splatCoverage:'continuous'}
    });
  }
});
