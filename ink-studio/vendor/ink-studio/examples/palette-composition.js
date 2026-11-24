/* Stone and fabric share a few scene swatches at the dye house. */
module.exports = ({KIT:K,makeBuilder,makeSculpt}) => ({
  id:'palette-composition',name:'Mist at the dye house',seed:71,
  build(seed) {
    const pal = [
      0x202e42, 0x283444,0x35495a,0x506061,0x6f7a6d,0x959786,0xc1b299,
      0x482833,0x6c3439,0x983f3f,0xc65c4a,0xe37f58,0xf5ab74,0xffe0a3,
      0x304a63,0x455f77,0x627f8e,0x7e9a9e,0x99afb1,
      0x24283d,0x313046,0x41384e,
      0x594337,0x89503a,0xe4b684,0xf3c998,
      0x35473f,0x55715e,0x829171,0x73878b
    ];
    const roles = {stone:[1,2,3,4,5,6],fabric:[7,8,9,10,11,12],stitch:[13],
      'shared-fog':[14,15,16,17,18], 'shared-shadow':[19,20,21], 'shared-bounce':[22,23,24,25]};
    const B = makeBuilder(seed,pal), S = K.sculpt(makeSculpt(B));
    S.captureAlbedo = true;
    S.amb = .28; S.sky = .16; S.sunK = .48;
    S.sun = K.V.norm([-.52,.73,.43]);
    function finish(id,r,albedo,policy) {
      return K.surface.material({materialId:id,r,albedo},{paletteConstraint:policy});
    }
    const stone = finish('stone',roles.stone,'#9a9881',{palette:['stone'],match:'perceptual'});
    const cloth = finish('fabric',roles.fabric,'#e37f58',{
      palette:['fabric'],reserved:['stitch'],match:'perceptual'
    });
    const dark = finish('stone',roles.stone.slice(0,4),'#66776d',{palette:['stone'],match:'perceptual'});
    const stitch = {r:[13],materialId:'thread',em:true};
    const foliage = {r:[26,27,28],albedo:'#6c805a',materialId:'foliage'};
    const rail = {r:[1,7,22,23,24],materialId:'wood',albedo:'#a18167'};
    const box = (at,half,mat,res=.098,rd=.055,id)=>S.box(at,half,mat,{res,rd,objectId:id});
    box([0,-.37,-.25],[5.46,.28,2.10],dark,.14,.13,'bridge');
    box([0,-.115,-.25],[5.34,.07,2.01],stone,.115,.055,'bridge');
    for (let j=0;j<15;j++) for (let k=0;k<5;k++)
      box([(j-7)*.70+(k%2)*.25,-.03,1.19-k*.65],[.33,.028,.31],stone,.115,.020,'bridge tiles');

    for (const [cx,z] of [[-2.70,-.60],[2.23,-1.12]]) {
      for (const side of [-1,1]) {
        const x = cx+side*1.42;
        box([x,.15,z],[.38,.19,.37],dark,.093,.07,'stone arch');
        for (let j=0;j<7;j++)
          box([x+(j%2 ? side*.012 : 0),.39+j*.318,z],[.274,.153,.25],j%3 ? stone : dark,.083,.061,'stone arch');
        box([x,2.51,z],[.35,.11,.28],stone,.074,.054,'stone arch');
      }
      for (let j=0;j<13;j++) {
        const a = (j+.5)*Math.PI/13;
        S.ball([cx+Math.cos(a)*1.42,2.47+Math.sin(a)*1.23,z],[.26,.25,.285],
          j%5 ? stone : dark,{res:.085,objectId:'stone vault'});
      }
      box([cx,2.52,z+.29],[1.39,.045,.061],rail,.055,.041,'banner rail');
      for (let j=0;j<21;j++) {
        const u = (j-10)/10, x = cx+(j-10)*.109;
        const low = .50+.34*Math.abs(u)**2, top = 2.46;
        const dz = Math.cos(u*8.3)*.055;
        box([x,(top+low)*.5,z+.27+dz],[.058,(top-low)*.5,.034],cloth,.045,.029,'woven panel');
        for (const y of [low+.12,top-.15])
          box([x,y,z+.305+dz],[.057,.012,.009],stitch,.026,.01,'gold stitching');
        const v = Math.abs(u);
        if (v < .43) for (const y of [1.61-v,1.61+v])
          S.ball([x,y,z+.31+dz],.025,stitch,{res:.027,objectId:'gold stitching'});
      }
    }
    for (const [x,z] of [[-4.49,1.18],[.0,1.48],[4.38,.72]]) {
      S.lathe([x,.02,z],.49,[.31,.27,.18,.23],dark,{res:.078,objectId:'marker'});
      S.ball([x,.55,z],.105,stitch,{res:.046,objectId:'gold markers'});
    }
    for (const [x,y,z,s] of [[-4.7,.09,-1.54,.50],[-.28,.09,-1.41,.35],[3.82,.07,-.08,.43],[4.62,.053,-1.80,.41]])
      S.rock([x,y,z],[s,.24,s*.82],foliage,{res:.084,objectId:'moss'});
    S.bake();
    const shared = (colors,threshold)=>({colors:[colors],combine:'material',threshold});
    return B.finish({
      radius:12,detail:35,dither:0,paletteRoles:roles,
      cam:{target:[-.17,1.57,-.29],dist:12.15,yaw:.13,pitch:.13,sway:0,fov:.61},
      look:{coverageAware:true,splatCoverage:'continuous',
        effectPalettes:{
          fog:shared('shared-fog',.29),shadow:shared('shared-shadow',.45),bounce:shared('shared-bounce',.08),
          protect:{materials:['thread','foliage','wood']}
        }},
      atmosphere:[K.atmosphere.fog({bottom:-.36,top:.86,near:4,far:19,
        color:'#82969b',density:.23})],
      liveSun:{direction:[-.53,.74,.41],ambient:.28,intensity:.57,shadows:true,mapSize:384,
        skyBounce:{color:'#9ab8c4',intensity:.16},groundBounce:{color:'#df9e5b',intensity:.29}},
      skyEnvironment:{defaults:{zenith:'#314557',horizon:'#758391',ground:'#465f6d',sunStrength:0}}
    });
  }
});
