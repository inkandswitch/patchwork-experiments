/* An oblique OKLab palette slice painted as leaded glass. */
const {type, ...field} = require('./palette-coverage-field.json');

module.exports = ({ KIT:K, makeBuilder, makeSculpt }) => ({
  id:'palette-coverage', name:'The spectrum chapel', seed:63,
  build(seed,{controls}={}) {
    const B = makeBuilder(seed,field.palette.map(hex=>parseInt(hex.slice(1),16)));
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.47,.67,.56]),amb:.42,sky:.25,sunK:.58});
    const stone={r:[1,2,3,4]}, rim={r:[2,3,4,5,6]}, wood={r:[0,1,2,15]}, roof={r:[8,9,10,11]};
    const moss={r:[20,21,22,23]}, gold={r:[10,11,12,13,14]}, lantern={r:[12,13,14,7],em:true};
    const box=(at,half,mat,res=.13)=>S.box(at,half,mat,{res,rd:res*.5});
    const radius=1.31, base=1.07, spring=3.02, rise=1.49;
    const arch = [[-radius,base],[radius,base], ...Array.from({length:21},(_,i)=>{
      const a=i*Math.PI/20;
      return [radius*Math.cos(a),spring+rise*Math.sin(a)];
    })];
    box([0,-.56,.1],[4.9,.32,3.31],stone);
    box([0,2.31,-.58],[2.54,2.25,.55],stone);
    box([0,.07,.41],[2.88,.12,1.19],rim);
    box([0,-.095,1.38],[2.99,.075,.55],rim);
    S.extrude([[[-2.79,4.52],[0,6.13],[2.79,4.52]]],[0,0,-.14],.39,roof,{res:.115,rd:.065});
    S.tube([[-2.83,4.51,.12],[0,6.14,.12],[2.83,4.51,.12]],.118,.118,rim,{res:.074});
    for(const x of [-2.38,2.38]) {
      box([x,2.22,-.11],[.194,2.15,.27],rim,.101);
      for(const y of [.45,1.08,3.47,4.4]) box([x,y,.01],[.293,.065,.31],rim,.085);
      S.lathe([x*.94,.16,1.02],1.36,[.13,.083,.049,.079],wood,{res:.060});
      S.lathe([x*.94,1.48,1.02],.17,[.135,.166,.095],gold,{res:.051});
      S.ball([x*.94,1.50,1.02],.088,lantern,{res:.043});
    }
    if (controls?.glass !== false) {
      const glass = K.surface.material({r:[0,1],em:true},{layers:{lead:{
        type:'projected',pattern:'palette-coverage',
        projection:{origin:[-radius,base,.13],along:[1,0,0],across:[0,1,0]},
        coverage:{...field,edge:{width:.0021,color:'#101522'},size:[2*radius,spring+rise-base]}
      } }});
      S.extrude([arch],[0,0,.085],.073,glass,{res:.042,rd:.032});
    }
    const frame=arch.concat([arch[0]]).map(([x,y])=>[x,y,.143]);
    S.tube(frame,.078,.078,wood,{res:.050});
    S.tube([[-1.44,base-.03,.15],...Array.from({length:21},(_,i)=>{
      const a=(20-i)*Math.PI/20;
      return [1.45*Math.cos(a),spring+1.66*Math.sin(a),.15];
    }),[1.44,base-.03,.15]],.119,.119,rim,{res:.065});
    box([0,base-.10,.16],[1.53,.076,.19],rim,.064);
    for(const x of [-3.52,-2.99,3.17,3.69]) {
      S.rock([x,-.10,.94],[.45,.32,.31],moss,{res:.075});
      S.rock([x,.15,.84],[.21,.32,.24],moss,{res:.069});
    }
    for(const [x,z,h] of [[-7,-6,2.6],[6,-6,3.5],[-4,-8,4.2],[5,-10,4.7]])
      S.rock([x,-1.4,z],[4,h,2.8],stone,{res:.25});
    S.bake();
    return B.finish({
      cam:{target:[0,2.45,-.28],dist:15.7,yaw:.11,pitch:.095,sway:0},
      radius:21,detail:27,dither:0,look:{splatCoverage:'continuous'},
      skyEnvironment:{defaults:{zenith:'#283751',horizon:'#91a9a7',ground:'#3b4c64',sunStrength:0}}
    });
  }
});
