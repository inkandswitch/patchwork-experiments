/* A pigment panel and an emissive signal share the same indexed artwork. */
const signalColors = ['#152c49','#287794','#37c0b1','#ffce76','#fff0c7'];

module.exports = ({KIT:K,makeBuilder,makeSculpt})=>({
  id:'palette-placement', name:'Harbour signal works',seed:35,
  build(seed,{controls}={}) {
    const mode = controls?.stage ?? 'paired';
    if (!['paired','material','lit','frame','palette'].includes(mode)) throw new RangeError('Choose a palette stage or paired');
    const B = makeBuilder(seed,[
      0x172432,0x25384a,0x354b5e,0x536374,0x747d7e,0x96958a,0xb6ac98,0xddd1b6,
      0x3e333b,0x664e46,0x916b54,0xb68c62,0xd4ae76,0xffde9c,0x2b4e55,0x577a71
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S,{sun:K.V.norm([-.69,.65,.33]),amb:.32,sky:.13,sunK:.66,captureAlbedo:true});
    const wood={r:[8,9,10,11]}, steel={r:[1,2,3,4,5]}, rim={r:[8,9,10,11,12]}, lamp={r:[12,13],em:true};
    const stone={r:[1,2,3,4]}, concrete={r:[3,4,5,6]}, base={r:[1,2,3,4,5,6,7]};
    const box=(p,h,m,res=.084)=>S.box(p,h,m,{res,rd:res*.58});
    const w=48,h=33,slots=[];
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const yWave = 19+3.3*Math.sin(x*.19) + .028*x;
      const sun = (x-30)**2+(y-10)**2<26;
      let index = y > yWave+6.5 ? 1 : y>yWave+1 ? 2 : y>yWave-2 ? 3 : 0;
      if (sun) index = 4;
      slots.push(index);
    }
    function artwork(id,stage,origin,size,em) {
      return K.surface.material({...base,materialId:id,em},{layers:{
        graphic:{type:'projected',stage,pattern:'indexed',
          projection:{origin,along:[1,0,0],across:[0,1,0]},
          raster:{width:w,height:h,slots,palette:signalColors,origin:'top-left',size}}
      }});
    }

    box([0,-.27,-.01],[4.56,.23,1.51],stone,.14);
    box([0,-.026,.03],[4.59,.055,1.48],concrete,.11);
    box([0,-.075,1.539],[4.64,.065,.065],rim,.085);
    box([0,1.51,-.82],[4.36,1.54,.18],steel,.125);
    for (let i=0;i<9;i++) {
      const x = (i-4)*.954;
      box([x,1.41,-.607],[.467,1.39,.032],i%3===0 ? stone : steel,.12);
    }
    box([0,3.021,-.57],[4.42,.08,.34],rim,.090);
    box([0,3.11,-.48],[4.51,.051,.39],wood,.085);
    box([0,.38,-.51],[4.36,.08,.21],rim,.086);
    for (const x of [-4.07,0,4.07]) {
      box([x,1.51,-.423],[.072,1.47,.078],wood,.059);
      for (const y of [.50,2.86]) S.ball([x,y,-.33],.049,rim,{res:.037});
    }
    const left=-2.16, right=2.12, y=1.55;
    const ceramic = mode === 'paired'
      ? artwork('ceramic','material',[left-1.42,y-1.10,.39],[2.84,2.20],false)
      : {...base,materialId:'ceramic'};
    S.ball([left,y,-.15],[1.453,1.135,.344],rim,{res:.065});
    S.ball([left,y,.028],[1.352,1.054,.549],ceramic,{res:.046});
    for (const s of [-1,1]) {
      box([left+s*.92,.41,.285],[.078,.33,.125],wood,.057);
      S.ball([left+s*.94,1.02,.502],.092,rim,{res:.044});
    }

    box([right,y,-.07],[1.49,1.01,.365],wood,.079);
    box([right,y,.241],[1.404,.938,.091],rim,.052);
    const sign = artwork('signal','lit',[right-1.30,y-.861,.341],[2.60,1.722],true);
    box([right,y,.348],[1.30,.861,.024],sign,.029);
    for (const x of [right-1.413,right+1.413]) for (const d of [-.94,.94])
      S.ball([x,y+d,.336],.053,steel,{res:.032});
    for (const x of [left-1.60,right+1.66]) {
      S.lathe([x,.05,.59],.38,[.154,.108],steel,{res:.061});
      S.ball([x,.48,.59],[.101,.082,.081],lamp,{res:.042});
    }
    for (let i=0;i<6;i++) {
      const x = -1.22+i*.41;
      box([x,.084,1.019+(i%2)*.14],[.131,.080,.095],i%3===0 ? rim : wood,.054);
    }
    S.bake();
    const grade={stage:'frame',order:10,stack:{name:'Warm glass',steps:[
      {type:'channelMix',matrix:[[.88,0,0],[0,.77,0],[0,0,.73]],offset:[.055,.026,.012]}
    ]}};
    const rules = mode === 'paired'
      ? [{...grade,weight:.44},{stage:'palette',select:{material:'signal'},palette:{palette:signalColors}}]
      : [grade,{stage:mode,palette:{palette:['#17283e','#24537a','#2c8e97','#60cbbb','#c69861','#f7e0ad']}}];
    return B.finish({
      cam:{target:[0,1.42,.09],dist:7.93,yaw:.032,pitch:.096,sway:0},radius:13,detail:34,dither:0,
      look:{splatCoverage:'continuous',renderStages:rules},
      skyEnvironment:{defaults:{zenith:'#2a4469',horizon:'#66858c',ground:'#293c52',sunStrength:0}}
    });
  }
});
