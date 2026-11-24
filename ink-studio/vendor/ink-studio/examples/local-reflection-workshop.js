/* One lantern read by a planar pool and by the normals of the surrounding finishes. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'local-reflection-workshop',
  name: 'Lantern workshop',
  seed: 31,
  build(seed) {
    const palette = [
      0x131521,0x201d2a,0x2d2634,0x3a3140,0x524451,0x6a5961,0x897478,
      0x192737,0x243c50,0x35566b,0x49778a,0x6595a2,0x91b6ae,0xc9d1b5,
      0x39262c,0x573237,0x76453a,0x9d6146,0xc78453,0xe6a062,0xf8bd78,0xffdb98,0xffedbc,
      0x3d4146,0x52564f,0x6c6a59,0x86816b,0xaba086,0xcbbb97,
      0x38515a,0x515668,0x8f6671,0xb87c71,0xe4a17e
    ];
    const B=makeBuilder(seed,palette);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{ pixel:true, sun:K.V.norm([-.52,.58,.49]), amb:.36, sky:.16, sunK:.45, wob:.022 });
    const slate={r:[1,2,3,4,5,6]}, trim={r:[3,4,5,6]}, iron={r:[1,2,3,4,5]};
    const bronze={r:[14,15,16,17],materialId:'bronze'};
    const stone={r:[23,24,25,26,27,28],materialId:'paving'};
    const ceramic={r:[7,8,9,10,11,12],materialId:'glaze'};
    const water=K.reflection.material({r:[7],em:true,materialId:'pool'},'basin',{ f0:.9, strength:.96, distortion:3 });
    const glaze=K.reflection.localMaterial(ceramic,'lantern-bench',{ f0:.71, roughness:.14,strength:.88 });
    const wetStone=K.reflection.localMaterial(K.surface.material(stone,{
      normal:{type:'noise',amplitude:.12,scale:.29}
    }), 'lantern-bench',{ f0:.57, roughness:.25,strength:.82 });
    const brush=K.reflection.localMaterial(K.surface.material(bronze,{
      direction:'z',normal:{type:'waves',axis:'y',cross:'x',scale:.17,amplitude:.016}
    }), 'fixture',{ f0:1,roughness:[.57,.09],strength:1,rotation:.12 });
    const box=(at,half,material,res=.075,rd=.045,extra={})=>S.box(at,half,material,{res,rd,...extra});

    box([0,-.37,.15],[4.55,.28,2.85],slate,.115,.14);
    box([0,-.143,.11],[4.32,.077,2.62],trim,.106,.065);
    for(const x of [-4.1,-3.42,3.42,4.1]) {
      box([x,.21,-2.11],[.22,.34,.31],trim,.078,.055);
      box([x,.68,-2.14],[.12,.28,.17],slate,.074,.035);
    }
    box([0,.03,-2.24],[4.2,.10,.14],slate,.106,.054);
    box([0,.85,-2.2],[4.18,.065,.071],trim,.085,.049);
    for(let i=0;i<9;i++) {
      const x=(i-4)*.94;
      box([x,.37,-2.23],[.035,.38,.055],slate,.077,.022);
    }

    box([0,-.025,.35],[1.06,.11,1.57],slate,.065,.075);
    for(const x of [-1.064,1.064]) box([x,.102,.35],[.12,.088,1.64],trim,.061,.062);
    for(const z of [-1.23,1.93]) box([0,.102,z],[1,.088,.11],trim,.061,.055);
    box([0,.106,.35],[.954,.016,1.47],water,.050,.008,{ghost:true});
    for(const x of [-.72,0,.72]) box([x,.185,1.94],[.27,.018,.106],iron,.04,.016);

    box([-2.57,.005,.26],[1.17,.102,1.49],slate,.072,.072);
    for(let row=0;row<4;row++) for(let col=0;col<3;col++) {
      const x=-3.32+col*.73, z=-.76+row*.69, lift=.02*Math.sin(row*2.4+col*3.2);
      const m=row<2 ? glaze : wetStone;
      box([x,.126+lift,z],[.338,.083,.31],m,.047,.065,
        row<2 ? {} : {bump:[.032,6.7]});
    }
    box([2.58,.005,.38],[1.21,.105,1.28],slate,.079,.08);
    box([2.58,.15,.33],[.91,.10,1.025],trim,.070,.068);
    box([2.62,.307,.31],[.64,.095,.72],iron,.064,.068);
    const lampZ=-1.48, lampCenter=[0,.985,lampZ+.18], panel=[2.42,.93,.36];
    const cam={ target:[0,.54,.18],dist:7.45,yaw:.035,pitch:.43,sway:0 };
    const eye=K.V.add(cam.target,[cam.dist*Math.sin(cam.yaw)*Math.cos(cam.pitch),cam.dist*Math.sin(cam.pitch),
      cam.dist*Math.cos(cam.yaw)*Math.cos(cam.pitch)]);
    const bisector=point=>K.V.norm(K.V.add(K.V.norm(K.V.sub(lampCenter,point)),K.V.norm(K.V.sub(eye,point))));
    let panelNormal=bisector(panel);
    for (let i=0;i<3;i++) panelNormal=bisector(K.V.mad(panel,panelNormal,.23));
    const horizontal=K.V.norm(K.V.cross([0,1,0],panelNormal));
    const vertical=K.V.cross(panelNormal,horizontal);
    S.ball(panel,[.92,.65,.23],brush,{res:.030,ax:[horizontal,vertical,panelNormal],objectId:'brushed-copper'});
    box([0,.061,lampZ],[.56,.13,.38],trim,.057,.057);
    box([0,.253,lampZ],[.37,.074,.29],iron,.044,.038);
    S.lathe([0,.308,lampZ],.29,[.19,.12],bronze,{res:.043});
    S.lathe([0,.589,lampZ],.14,[.25,.32],iron,{res:.036});
    const glowing={r:[20,21,22],v:.63,em:true};
    box([0,.987,lampZ],[.233,.26,.182],glowing,.032,.036,{ghost:true,objectId:'lantern-flame'});
    const panes={r:[18,19,20,21,22],em:true,v:.55};
    for(const x of [-.251,.251]) {
      box([x,.978,lampZ],[.02,.24,.151],panes,.036,.014,{ghost:true,objectId:'lantern-flame'});
      for(const z of [lampZ-.211,lampZ+.211])
        S.tube([[x,.728,z],[x,.995,z],[x*.92,1.268,z]],.028,.027,iron,{res:.034,objectId:'lantern-frame'});
    }
    for(const y of [.741,1.23]) box([0,y,lampZ],[.294,.038,.242],bronze,.033,.021,{objectId:'lantern-frame'});
    S.tube([[0,.776,lampZ+.214],[0,1.214,lampZ+.214]],.022,.020,bronze,{res:.028,objectId:'lantern-frame'});
    S.lathe([0,1.247,lampZ],.23,t=>t<.23 ? .35 : .34-(t-.23)*.33,iron,{res:.036,objectId:'lantern-frame'});
    S.ball([0,1.513,lampZ],[.095,.102,.092],bronze,{res:.031});
    S.lights.push({p:[0,.96,lampZ+.15],r:3.3,s:.86,c:[18,19,20,21]});
    S.bake();
    const probe=K.reflection.probe({
      id:'lantern-bench', at:[.12,.55,.54], size:128,
      bounds:{min:[-4.8,-.24,-1.30],max:[4.8,2.95,3.6],feather:.12},
      capture:{exclude:['pool','bronze','paving','glaze'].map(material=>({material}))}
    });
    const fixture=K.reflection.probe({
      id:'fixture', at:K.V.mad(panel,panelNormal,.25), size:128, bounds:probe.bounds,
      capture:{include:[{object:'lantern-flame'},{object:'lantern-frame'}]}
    });
    return B.finish({
      cam,detail:28,radius:11,dither:0,
      look:{pixel:true,splatCoverage:'continuous'},
      reflections:[K.reflection.plane({id:'basin',at:[0,.122,0],
        select:(index,x,y,z)=>Math.abs(x)<.44 && z>-1.90 && z< -1.05 && y>.20 })],reflectionProbes:[probe,fixture],
      skyEnvironment:{defaults:{zenith:'#374460',horizon:'#797889',ground:'#2e2936',sunStrength:0}}
    });
  }
});
