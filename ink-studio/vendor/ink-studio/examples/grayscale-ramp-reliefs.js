/* The same sculpted shell printed with two ways of matching a gray ramp. */
const ink = require('./grayscale-ramp.json');

module.exports = ({KIT:K, makeBuilder, makeSculpt}) => ({
  id:'grayscale-ramp-reliefs', name:'Nautilus press', seed:41,
  build(seed) {
    const gray = Array.from({length:24},(_,i)=>Math.round(255*i/23)*0x010101);
    const B = makeBuilder(seed,[...gray,0x16232c,0x2a3d49,0x516673,0x9c8981,0xd0ae86,0xebc998,0x514b51]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.64,.57,.43]),amb:.18,sky:.24,sunK:.68});
    const paletteRange = Array.from({length:22},(_,i)=>i+1);
    const plate = {r:[24,25,26]}, wood = {r:[30,27,28,29]}, paper = {r:[27,28,29]};
    const box = (p,h,m,res=.07)=>S.box(p,h,m,{res,rd:res*.57});

    for (const [column,metric] of [null,'nearest','lightness'].entries()) {
      const x = (column-1)*3.1;
      const part = materialId => {
        const base = {r:paletteRange,materialId:materialId+'-'+(metric ?? 'gray')};
        return metric ? K.surface.material(base,{layers:{ink:{
          type:'colorCurve',paletteRamp:{...ink,metric}
        }}}) : base;
      };
      const shell = part('shell'), veins = part('veins');
      box([x,-.01,-.22],[1.43,1.71,.20],wood);
      box([x,.015,-.011],[1.33,1.59,.039],paper);
      box([x,.105,.041],[1.23,1.39,.031],plate);
      for (const side of [-1,1]) for (const top of [-1,1]) {
        box([x+side*1.096,.105+top*1.242,.082],[.058,.012,.014],paper,.032);
        box([x+side*1.144,.105+top*1.203,.082],[.012,.046,.014],paper,.032);
      }
      const spiral = t => {
        const a = -.77+t*10.8, r = 1.02*Math.exp(-1.92*t);
        return [x-.10+r*Math.cos(a),.149+r*Math.sin(a),.147+.035*(1-t)];
      };
      S.ball([x-.08,.175,.172],[.83,.78,.174],shell,{res:.038});
      const ridge = t=>.28*Math.exp(-1.90*t)+.024;
      S.tube(Array.from({length:71},(_,i)=>spiral(i/70)),ridge,0,shell,{res:.032,rd:.026});
      for (let i=0;i<20;i++) {
        const t = (i+.25)/27;
        const [sx,sy,z] = spiral(t), a = -.77+t*10.8, radius = ridge(t);
        const ribs = Array.from({length:9},(_,j)=>{
          const b=.25+j*(Math.PI-.46)/8;
          const cross = radius*Math.cos(b);
          return [sx+Math.cos(a+.16)*cross,sy+Math.sin(a+.16)*cross,z+radius*Math.sin(b)];
        });
        S.tube(ribs,.010+radius*.055,.008,veins,{res:.020});
      }
      for (const [dx,dy,sz] of [[.78,.97,.069],[.92,.82,.039],[-.85,-.86,.049],[-.97,-.97,.026]]) {
        S.ball([x+dx,dy,.093],sz,paper,{res:.030});
      }
      for (const dx of [-.22,0,.22]) box([x+dx,-1.436,.040],[.052,.015,.028],wood,.029);
    }
    S.bake();
    return B.finish({
      cam:{target:[0,0,.06],dist:5.96,yaw:0,pitch:0,sway:0},
      skyEnvironment:{defaults:{zenith:'#17242b',horizon:'#17242b',ground:'#17242b',sunStrength:0}},
      radius:13,detail:34,dither:0,ortho:true,look:{splatCoverage:'continuous'}
    });
  }
});
