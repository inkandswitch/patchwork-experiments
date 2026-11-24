module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'raster-millrace',
  name: 'Evening at the millrace',
  seed: 53,
  build(seed, { controls } = {}) {
    const B = makeBuilder(seed, [
      0x182636,0x233747,0x344755,0x4a5762,0x64686d,0x827d77,0xa29486,0xbbae97,
      0x302e3c,0x48394a,0x634958,0x855c64,0xab7773,0xce9686,
      0x1f3f49,0x2b5660,0x386d72,0x588983,0x79a396,
      0x283d35,0x364f41,0x4b6550,0x64805c,0x84916a,
      0x3e343a,0x654448,0x874f4d,0xb36a53,0xe49963,0xffc677,0xffe6a9,
      0x314c64,0x466984,0x79a2ac,0xa4bdb4
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{pixel:true,amb:.42,sky:.19,sunK:.61,shLen:0,sun:K.V.norm([-.56,.67,.55])});
    const stone = {r:[1,2,3,4,5]}, trim = {r:[2,3,4,5,6,7]};
    const timber = {r:[24,25,26,27]}, leaf = {r:[19,20,21,22,23]};
    const roof = {r:[8,9,10,11,12]}, plaster = {r:[3,4,5,6,7]}, lit = {r:[28,29,30],em:true,v:.86};
    const box = (at,half,mat,res=.105,rd=.053,more) => S.box(at,half,mat,{res,rd,...more});
    const tube = (points,radius,mat,res=.072) => S.tube(points,radius,radius,mat,{res});

    for (const [x,z,w,h] of [[-8,-11,4,1.51],[-4.9,-12.3,2.5,1.20],[-2.4,-13.4,3.8,.82],
      [1.0,-14.2,3.25,.97],[4.5,-12.8,3.9,1.40],[7,-11.1,3.5,1.69]]) {
      S.rock([x,-.29,z],[w,h,2.1],{r:[2,3,4,8,9]},{res:.23});
    }
    for (const side of [-1,1]) {
      box([side*4.03,-.23,1.63],[1.79,.51,6.21],stone,.173,.16);
      for (let i=0;i<23;i++) {
        const z=-4.17+i*.53, edge=2.24+.11*Math.sin(i*1.78+side);
        box([side*(edge+.26),.16,z],[.30,.30,.26],i%4===2 ? trim : stone,.093,.065);
        if (i%3!==1) S.rock([side*(edge+.8),.49,z],[.55,.26+.07*Math.sin(i),.38],leaf,{res:.095});
        if (i%4===1) S.rock([side*(edge+.09),-.075,z+.15],[.33,.22,.27],stone,{res:.089});
      }
      for (let i=0;i<35;i++) {
        const x=side*(2.75+2.41*K.hash(i,side,seed)), z=-4.48+12.1*K.hash(i,side,2*seed);
        S.rock([x,.26+.23*K.hash(i,side,3*seed),z],[.35+.46*K.hash(i,side,41),.27,.46],leaf,{res:.12});
      }
      for (const [x,z] of [[2.47,2.36],[2.32,3.08],[2.59,3.83]]) for (let i=0;i<5;i++) {
        const shift=(i-2)*.055, y=.45+.1*Math.sin(i*2.6+side);
        tube([[side*(x+.07),.0,z+shift],[side*(x+shift*.72),y,z+.07+shift]],.023,leaf,.055);
      }
    }

    // Individual arch stones and parapet courses carry the bridge's silhouette.
    const zBridge = -.63;
    for (const side of [-1,1]) {
      box([side*2.00,.39,zBridge],[.38,.59,.74],stone,.094,.072);
      box([side*2.13,.19,zBridge],[.44,.145,.81],trim,.092,.051);
      for (let i=0;i<6;i++) {
        const x=side*(1.85+i*.263), y=.99-i*.071;
        box([x,y,zBridge],[.132,.17,.65],stone,.082,.031);
        box([x,y+.176,zBridge],[.137,.057,.73],trim,.075,.032);
      }
    }
    for (let i=0;i<19;i++) {
      const a=(i+.5)*Math.PI/19, c=Math.cos(a), s=Math.sin(a);
      const ax=[[c,s,0],[-s,c,0],[0,0,1]], mat=i%5===2 ? stone : trim;
      box([1.76*c,.21+1.09*s,zBridge],[.182,.162,.68],mat,.076,.039,{ax});
    }
    for (let i=-10;i<=10;i++) {
      const x=i*.187, y=1.05+.49*Math.cos(Math.min(1,Math.abs(x)/2.0)*Math.PI*.5);
      box([x,y,zBridge],[.098,.102,.63],stone,.076,.033);
      for (const z of [zBridge-.645,zBridge+.645]) {
        box([x,y+.17,z],[.10,.13,.078],stone,.068,.027);
        box([x,y+.305,z],[.104,.043,.106],trim,.064,.031);
      }
    }
    for (const x of [-1.69,1.69]) for (const z of [zBridge-.67,zBridge+.67]) {
      const y=1.35;
      S.lathe([x,y,z],.47,[.05,.045],timber,{res:.045});
      S.ball([x,y+.51,z],[.095,.109,.093],lit,{res:.043,ghost:true});
      S.lathe([x,y+.60,z],.126,[.125,.026],timber,{res:.045});
    }
    for (const x of [-1.18,1.18]) {
      const z=zBridge+.71;
      box([x,1.27,z],[.114,.056,.066],timber,.047);
      S.ball([x,1.11,z+.04],[.074,.129,.065],lit,{res:.033,ghost:true});
      box([x,.976,z+.04],[.087,.041,.075],timber,.043);
    }

    // A small riverside mill with an iron-rimmed waterwheel.
    box([-3.45,.98,-1.67],[1.04,.80,.80],plaster,.114,.075);
    for (const x of [-4.45,-2.46]) box([x,1.18,-.858],[.065,.61,.056],timber,.070);
    for (const y of [.58,1.71]) box([-3.45,y,-.844],[1.05,.067,.067],timber,.069);
    for (const x of [-3.89,-3.04]) {
      box([x,1.32,-.821],[.25,.255,.060],timber,.073);
      box([x,1.32,-.749],[.179,.18,.027],lit,.053,.027,{ghost:true});
      box([x,1.32,-.712],[.019,.19,.024],timber,.036);
    }
    for (const side of [-1,1]) {
      const ax=[[.824,-side*.566,0],[side*.566,.824,0],[0,0,1]];
      box([-3.45+side*.56,2.02,-1.66],[.724,.095,.98],roof,.091,.038,{ax});
    }
    box([-3.45,2.36,-1.66],[.095,.077,1.018],roof,.078);
    box([-4.05,2.39,-2.01],[.132,.43,.14],stone,.085,.052);
    box([-4.05,2.81,-2.01],[.19,.076,.19],trim,.081,.04);
    for (const z of [-.61,-.36]) {
      const x=-2.63,y=.53,r=.53;
      const points=Array.from({length:25},(_,i)=>{
        const a=i*Math.PI/12;
        return [x+r*Math.cos(a),y+r*Math.sin(a),z];
      });
      tube(points,.064,timber,.058);
      for (let i=0;i<8;i++) tube([[x,y,z],points[i*3]],.034,timber,.057);
    }
    S.bake();

    const plane=K.reflection.plane({id:'millrace',at:[0,0,0]});
    const base=K.surface.preset('rippling-water',{r:[14,15,16,17,18],materialId:'millrace-water'},{
      normal:{amplitude:.005,scale:.45,speed:0},
      layers:{sun:false,sky:{sky:'#4d6189',horizon:'#5f8497',ground:'#213c65',strength:.59,f0:.53},ripples:{strength:.11}}
    });
    const reflection=K.reflection.material(base,plane.id,{f0:.89,strength:.91,distortion:0,blur:0,color:'#bed6e1'});
    const width=160,height=464,span=[4.76,14.16];
    const slots=Array.from({length:width*height},(_,i)=>{
      const u=((i%width)+.5)*span[0]/width, v=(Math.floor(i/width)+.5)*span[1]/height;
      const crest=Math.sin(v*14.8+.61*Math.sin(3.1*u+2.8*v)+.20*Math.sin(u*8.4-v));
      const breaks=Math.sin(u*7.5+v*3.9)+.67*Math.sin(u*14.1-v*5.3);
      if (crest>.65 && breaks>.32) return breaks>1.18 && crest>.87 ? 34 : 33;
      if (crest<-.84 && breaks>-.08) return breaks>.72 ? 31 : 32;
      return null;
    });
    const water=K.surface.material(reflection,{layers:{sheen:{
      type:'projected',pattern:'indexed',projection:{origin:[-2.38,0,-5.51]},
      raster:{width,height,size:span,slots}
    }}});
    box([0,-.043,1.57],[2.38,.043,7.08],water,.141,.018);
    S.bake();

    return B.finish({
      cam:{target:[-.25,.53,.95],dist:11.4,yaw:.12,pitch:.323,ortho:true,sway:0},
      radius:18, detail:25, dither:0, reflections:[plane],
      skyEnvironment:{defaults:{zenith:'#454e78',horizon:'#d8a096',ground:'#354865',sunStrength:0}},
      look:{splatCoverage:'continuous',renderGraph:{passes:[{
        id:'water-scanlines',type:'distortion',enabled:controls?.raster !== false,
        select:{material:'millrace-water'},depthThreshold:controls?.depth === false ? undefined : .26,
        rows:({y,v,width,height,time})=>{
          const t=(time%6)*Math.PI/3, near=K.clamp((v-.43)/.57,0,1);
          const wave=Math.sin(y*145/height-t*4)+.47*Math.sin(y*228/height-t*7);
          return {offset:[wave*width*(.008+.018*near),0],scale:[1+.044*near*Math.sin(y*113/height-t*2),1],
            tint:[1-5*near,3+7*near,7+16*near]};
        }
      }]}}
    });
  }
});
