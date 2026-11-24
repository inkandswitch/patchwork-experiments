const { spriteAtlas } = require('../cli/sprite-atlas.js');
const { paintMap } = require('../src/frame-composite.js');

const fps = 8, reachFrame = 5, catchFrame = 6;
const width = 48, height = 40, pivot = [0, .89, 0];
const colors = [
  0x14202c,0x1b293b,0x243548,0x304357,0x3d5466,0x55717c,0x799094,
  0x263b42,0x315155,0x40716d,0x5e967e,0x8eb998,0xbfd5a7,
  0x43303d,0x673f47,0x9c514c,0xc87459,0xeb9c69,0xffca8b,
  0x4f443e,0x77574a,0xa47550,0xce9a5f,0xf5bb6b,0xffdc90,0xffedb4,
  0x373742,0x50505a,0x707278,0x92958d,0xc1b393
];
const hip = [0,.83,0], shoulder = [.29,1.27,.07], face = [.02,1.48,.03];
const joint = [0,0,1];
const armAngles = [-.94,-1.02,-1.11,-.93,-.63,-.24,.24,.39,.12,-.04,-.17,-.28];
const lean = [0,-.025,-.05,-.08,-.065,-.025,.055,.13,.08,.035,0,-.02];

function bake(kit, seed) {
  const { KIT: K, makeBuilder, makeSculpt } = kit;
  const B = makeBuilder(seed, colors), S = K.sculpt(makeSculpt(B)), rig = K.rig(B,S);
  Object.assign(S,{pixel:true,amb:.32,sky:.17,sunK:.66,shLen:0,sun:K.V.norm([-.50,.72,.48])});
  const coat={r:[7,8,9,10,11]}, dark={r:[1,2,7,8]}, scarf={r:[13,14,15,16,17]};
  const leather={r:[13,19,20,21]}, brass={r:[19,21,22,23,24]}, skin={r:[15,16,17,18]};
  const box=(at,half,mat,tag,res=.049,rd=.05)=>S.box(at,half,mat,{tag,res,rd});
  const ball=(at,half,mat,tag,res=.044)=>S.ball(at,half,mat,{tag,res});
  box([-.19,.33,.018],[.105,.28,.115],dark,'legs');
  box([.18,.36,-.026],[.101,.26,.125],dark,'legs');
  box([-.235,.103,.13],[.142,.10,.170],leather,'legs',.043);
  box([.205,.10,.058],[.131,.101,.156],leather,'legs',.043);
  box([0,.96,0],[.282,.287,.164],coat,'body',.048,.11);
  box([.04,.739,.057],[.279,.064,.173],leather,'body',.047,.036);
  box([-.088,.811,.176],[.111,.087,.043],brass,'body',.035,.032);
  box([-.176,.99,-.147],[.167,.20,.106],dark,'body',.044,.06);
  ball([.019,1.291,.049],[.199,.082,.154],scarf,'body');
  box([-.139,1.126,.154],[.074,.17,.048],scarf,'body',.039,.028);
  ball([.015,1.502,.018],[.204,.222,.168],coat,'head',.046);
  ball([.065,1.455,.132],[.144,.142,.090],skin,'head',.036);
  box([.114,1.499,.207],[.08,.037,.039],dark,'head',.024,.015);
  box([.165,1.501,.239],[.029,.021,.015],brass,'head',.019,.009);
  box([.044,1.686,.041],[.248,.071,.166],brass,'head',.042,.05);
  ball([.018,1.749,.002],[.148,.045,.132],coat,'head',.034);
  S.tube([[-.242,1.235,.027],[-.390,1.023,.094],[-.399,.905,.102]],.098,.077,coat,{res:.043,tag:'body'});
  ball([-.399,.902,.105],[.088,.087,.074],leather,'body',.038);
  S.tube([shoulder,[.501,1.207,.109],[.724,1.170,.119]],.116,.085,coat,{res:.038,tag:'arm'});
  box([.692,1.174,.124],[.056,.094,.081],brass,'arm',.036,.018);
  ball([.791,1.162,.136],[.104,.082,.078],leather,'arm',.035);
  box([.842,1.190,.139],[.048,.031,.045],brass,'arm',.027,.016);
  S.bake();
  const world=B.finish({cam:{target:pivot,dist:3.31,yaw:0,pitch:.115,sway:0},radius:2.2,
    dither:0,look:{splatCoverage:'continuous'}});
  const stage=K.stage(world);
  rig.bind(stage);
  function pose(_world,t) {
    const frame=Math.max(0,Math.min(armAngles.length-1,Math.floor(t*fps+.000001)));
    const shift=lean[frame], dip=frame===6?.079:frame===7?.117:Math.abs(shift)*.43;
    rig.set('body',K.M.rot(joint,-shift*.81),hip,[shift,hip[1]-dip,0]);
    rig.child('head','body',K.M.rot(joint,shift*.53),face);
    rig.child('arm','body',K.M.rot(joint,armAngles[frame]),shoulder);
    rig.apply();
  }
  return spriteAtlas(world,{width,height,directions:4,fps,pivot,pose,
    times:armAngles.map((_,i)=>i/fps),maps:['depth','normal','emission','silhouette']});
}

function editCels(baked) {
  const view=baked.metadata.frames.find(view=>view.frame===catchFrame&&view.direction===0);
  const color=new Uint8Array(width*height*4), { x,y }=view.rect;
  for (let row=0;row<height;row++) {
    const start=((row+y)*baked.metadata.width+x)*4;
    color.set(baked.images.color.subarray(start,start+width*4),row*width*4);
  }
  const paint=(cells,rgb)=>{
    for (const [x,y] of cells) {
      const pixel=(y*width+x)*4;
      if (color[pixel+3]) color.set(rgb,pixel);
    }
  };
  paint([[35,13],[36,13],[37,13],[35,14],[36,14],[36,15]], [252,190,110]);
  paint([[30,13],[31,13],[32,13],[31,14],[32,14],[33,14],[34,14]], [146,189,149]);
  const effect=paintMap(width,height,[
    {type:'polygon',points:[[28,16],[32,13],[39,11],[43,8],[42,12],[38,15],[32,17]],color:'#40716d'},
    {type:'polygon',points:[[32,15],[37,13],[43,9],[41,12],[37,14]],color:'#8eb998'},
    {type:'path',points:[[34,14],[40,11],[44,8]],width:1,color:'#ffca8b'}
  ]);
  return {
    poses:{reach:reachFrame,brace:catchFrame},
    replacements:[
      {frame:'reach',direction:0,images:{effect},effectDepth:-.30},
      {frame:'brace',direction:0,images:{color}}
    ],
    holds:[{frame:'brace',direction:0,frames:2}]
  };
}

const hanger=[1.055,2.97,.22];
function lanternAngle(t) {
  const contact=catchFrame/fps, age=t-contact;
  return age<0 ? -.19+.98*(1-t/contact)**1.23 : -.19-.118*Math.sin(age*8)*Math.exp(-age*2.6);
}

function scene(kit) {
  const {KIT:K,makeBuilder,makeSculpt}=kit;
  return {id:'lantern-catch',name:'Lantern catch at the tide gate',seed:31,build(seed,{controls={}}={}) {
    const {edited=true}=controls;
    const B=makeBuilder(seed,colors), S=K.sculpt(makeSculpt(B)), rig=K.rig(B,S);
    Object.assign(S,{pixel:true,amb:.24,sky:.15,sunK:.62,shLen:0,sun:K.V.norm([-.56,.72,.34])});
    const rock={r:[1,2,3,4,5]}, wall={r:[2,3,4,5,6]}, iron={r:[13,26,27,28]}, wood={r:[13,19,20,21]};
    const gold={r:[19,21,22,23]}, fire={r:[22,23,24,25],em:true};
    const box=(at,half,mat,res=.115,rd=.052,tag)=>S.box(at,half,mat,{res,rd,tag});
    box([0,-.29,.17],[4.83,.27,1.64],rock,.172,.109);
    for(let z=0;z<5;z++)for(let x=-7;x<=7;x++)
      box([x*.635+(z%2)*.21,-.023,-1.11+z*.575],[.298,.037,.257],
        (x*11+z*3)%5===0?wall:rock,.101,.024);
    box([0,1.06,-1.45],[4.67,1.10,.13],rock,.143,.08);
    for(let y=0;y<6;y++)for(let x=-7;x<=7;x++)
      if((x+2*y)%5!==0) box([x*.614+(y%2)*.22,.15+y*.318,-1.29],
        [.289,.139,.052],(x*17+y*9)%8===0?wall:rock,.103,.029);
    for(const x of [-3.29,3.59]) {
      box([x,.19,-.51],[.40,.23,.35],wall,.12,.08);
      box([x,1.48,-.53],[.23,1.09,.28],wall,.136,.067);
      box([x,2.56,-.52],[.38,.103,.39],wall,.106,.055);
      box([x,2.71,-.53],[.31,.065,.31],wood,.094,.029);
    }
    box([2.42,2.98,hanger[2]],[1.57,.098,.103],wood,.083,.032);
    box([3.57,1.52,hanger[2]],[.12,1.58,.13],wood,.110,.04);
    S.tube([[3.06,2.86,.22],[3.53,2.30,.22]],.068,.081,wood,{res:.058});
    for(const x of [1.10,2.07,3.45]) box([x,2.981,.22],[.035,.117,.127],iron,.051,.02);
    S.ball([hanger[0],hanger[1]+.011,hanger[2]],[.108,.105,.080],gold,{res:.043});

    for(const [x,z] of [[-2.08,-.68],[2.65,-.78],[3.78,.84]]) {
      box([x,.18,z],[.275,.18,.224],wood,.093,.029);
      for(const dx of [-.205,.205]) box([x+dx,.20,z+.227],[.025,.176,.022],iron,.064,.013);
      box([x,.275,z+.246],[.071,.042,.023],gold,.052,.013);
    }
    const [ax,ay,az]=hanger, ringY=1.386, flameY=1.195;
    S.tube([hanger,[ax,ringY+.07,az]],.023,.018,wood,{res:.052,tag:'lantern'});
    box([ax,ringY+.022,az],[.034,.042,.033],gold,.035,.02,'lantern');
    for(const y of [1.045,1.322])
      box([ax,y,az],[.119,.035,.101],gold,.043,.025,'lantern');
    for(const x of [ax-.089,ax+.089]) for(const z of [az-.071,az+.071])
      box([x,flameY,z],[.017,.125,.017],iron,.035,.009,'lantern');
    S.ball([ax,flameY,az],[.078,.106,.068],fire,{res:.033,tag:'lantern'});
    S.bake();

    const baked=bake(kit,seed);
    const atlas=K.sprite.atlas({metadata:{...baked.metadata,...(edited&&{cels:editCels(baked)})},images:baked.images});
    const camera=t=>({target:[.65+.10*t,1.43,0],dist:7.48,yaw:-.12+.102*t,pitch:.105+.022*t,sway:0,ortho:true});
    const world=B.finish({cam:camera(0),radius:8.1,detail:26,dither:0,look:{splatCoverage:'continuous'},
      spriteAtlases:[K.sprite.placeAtlas({atlas,at:[0,pivot[1]+.025,.045],playback:'once',objectId:'watchkeeper'})],
      liveSun:{ambient:.66,intensity:.48,shadows:false,direction:t=>K.V.norm([.70+.12*Math.sin(t*2),.49,.63])}
    });
    const stage=K.stage(world);
    rig.bind(stage);
    stage.add({pre(_dt,t) {
      Object.assign(world.cam,camera(t));
      rig.set('lantern',K.M.rot(joint,lanternAngle(t)),hanger,hanger);
      rig.apply();
    }});
    return world;
  }};
}

module.exports = scene;
module.exports.bake = bake;
module.exports.editCels = editCels;
