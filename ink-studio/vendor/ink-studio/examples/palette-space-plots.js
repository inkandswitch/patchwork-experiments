/* Mount the same palette in two coordinate systems inside a scene. */
const spec = require('./palette-space-plot.json');

module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'palette-space-plots', name:'The colour archive', seed:34,
  build(seed) {
    const builtins = ['#14202e','#253744','#42545e','#657979','#9aa89c','#c6bb97','#e0cc98','#fde7ad',
      '#50647a','#ef766e','#7dcb8e','#76a5ec','#df8cb3','#e3e7e7','#efc477'];
    const B = makeBuilder(seed,[...builtins,...spec.palette].map(hex=>parseInt(hex.slice(1),16)));
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.56,.71,.49]),amb:.36,sky:.22,sunK:.64});
    const stone={r:[1,2,3,4]}, plaster={r:[2,3,4,5]}, brass={r:[3,5,6,7]}, dark={r:[0,1,2]};
    const box=(at,half,material,res=.12)=>S.box(at,half,material,{res,rd:res*.55});
    box([0,-.43,.0],[5,.26,2.53],dark);
    box([0,-.211,.0],[4.87,.073,2.43],stone);
    for(const x of [-2.48,2.48]) {
      box([x,-.054,0],[2.02,.126,1.75],plaster,.101);
      box([x,.145,0],[1.60,.11,1.32],dark,.099);
      box([x,.263,0],[1.57,.048,1.29],brass,.083);
      box([x,1.74,-1.74],[2.02,1.57,.12],stone,.15);
      for(const dx of [-1.72,1.72])
        box([x+dx,1.75,-1.56],[.076,1.59,.105],brass,.092);
      for(const z of [-1.79,1.80]) {
        S.lathe([x+1.82,.065,z],.43,[.13,.105,.081,.08],plaster,{res:.056});
        S.ball([x+1.82,.49,z],.079,{r:[6,7],em:true},{res:.046});
      }
    }
    for(let i=0;i<20;i++) box([(i-9.5)*.455,-.089,2.19],[.217,.063,.098],i%4===0?brass:stone,.086);
    S.bake();
    const labels = [];
    for(const [space,x] of [['rgb',-2.48],['oklab',2.48]]) {
      const plot = K.palette.plot({...spec,space,size:2.68});
      for(const {label,at,color} of plot.emit(B,{origin:[x,1.74,0],id:space+'-palette'}))
        labels.push({id:space+'-'+label,at,text:label,style:{color},offset:[3,-7]});
    }
    return B.finish({
      cam:{target:[0,1.41,-.13],dist:14.5,yaw:.15,pitch:.33,sway:0},
      radius:17,detail:23,dither:0,
      skyEnvironment:{defaults:{zenith:'#202f48',horizon:'#526c80',ground:'#172433',sunStrength:0}},
      look:{splatCoverage:'continuous',composite:{layers:[{annotations:{
        style:{size:8,padding:1,background:'#172433cc',border:false},labels
      }}]}}
    });
  }
});
