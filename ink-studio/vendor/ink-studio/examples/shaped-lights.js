module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'shaped-lights',
  name: 'The lantern court',
  seed: 61,
  build(seed) {
    const B=makeBuilder(seed,[
      0x192536,0x263442,0x334556,0x485865,0x616a6c,0x8d8e81,0xb2ab92,
      0x4a4444,0x655749,0x8a7055,0xb7986e,0xd9ba8d,0xe7d1a6,
      0x234457,0x2d5a6c,0x427682,0x5d9093,0x83b1ae,
      0x4c3c37,0x725143,0xaa7352,0xe39b58,0xffca7c,0xffe4ae,
      0xc5d8e1,0xe3ebef,0xf5eee0,0x324933,0x456145,0x689263
    ]);
    const S=K.sculpt(makeSculpt(B));
    Object.assign(S,{amb:.38,sky:.12,sunK:.43,shLen:0,aoK:0,
      sun:K.V.norm([-.52,.67,.49])});
    const masonry={r:[1,2,3,4,5]}, wood={r:[7,8,9,10,11]}, bronze={r:[18,19,20,21]};
    const bed={r:[2,3,4,5,6]}, paver={r:[3,4,5,6]}, leaf={r:[27,28,29]};
    const box=(at,half,mat,res=.13,rd=.045)=>S.box(at,half,mat,{res,rd});

    box([0,-.24,0],[3.68,.23,2.42],masonry,.17,.12);
    box([-1.84,.024,.04],[1.74,.035,2.20],bed,.125,.055);
    for(let x=0;x<6;x++)for(let z=0;z<7;z++)
      box([-3.32+x*.56,.064,-1.93+z*.61],[.268,.016,.283],(x+2*z)%5===0 ? bed : paver,.102,.018);
    box([-1.87,.77,-1.87],[1.78,.89,.14],masonry,.13,.11);
    for(const x of [-3.34,-.51]) {
      box([x,.32,-1.57],[.15,.34,.18],masonry,.092);
      box([x,1.08,-1.58],[.14,.46,.15],masonry,.10);
      box([x,1.61,-1.58],[.195,.081,.191],wood,.078);
    }
    box([-1.92,1.61,-1.64],[1.64,.082,.20],wood,.113);
    box([-1.92,1.44,-1.63],[.99,.055,.12],bronze,.07);
    box([-1.92,.47,-1.58],[1.17,.066,.21],masonry,.079);
    for(const x of [-2.93,-.93]) box([x,.98,-1.64],[.05,.49,.112],bronze,.074);
    box([-2.78,.18,-.84],[.30,.11,.20],wood,.089);
    for(const x of [-2.96,-2.77,-2.59]) S.rock([x,.33,-.84],[.13,.19,.14],leaf,{res:.087});

    for(const x of [.16,3.44]) box([x,.071,.13],[.16,.145,2.13],masonry,.12);
    for(const z of [-1.98,2.20]) box([1.80,.071,z],[1.67,.145,.15],masonry,.12);
    box([2.73,.76,-1.68],[.077,.64,.086],wood,.079);
    box([2.47,1.38,-1.66],[.36,.056,.068],bronze,.082);
    box([2.16,1.29,-1.65],[.033,.12,.034],bronze,.046);
    for(const y of [.72,1.19]) box([2.16,y,-1.63],[.251,.036,.136],bronze,.055,.029);
    for(const x of [1.95,2.37]) box([x,.965,-1.65],[.029,.237,.098],bronze,.054);
    for(const x of [.34,1.03,1.72,2.42,3.10]) box([x,-.062,2.22],[.27,.151,.097],masonry,.105);
    S.bake();

    S.keepRenderSdf=true;
    box([-1.08,.377,-.07],[.110,.32,.46],wood,.087,.053);
    box([-1.08,.69,-.07],[.14,.044,.505],bronze,.075);
    S.bake();
    S.keepRenderSdf=false;
    const plane=K.reflection.plane({id:'court-pool',at:[0,.046,0]});
    const water=K.reflection.material(K.surface.material({r:[13,14,15],materialId:'pool'},{
      layers:{ sky:{type:'reflection',sky:'#34566f',horizon:'#4d7480',ground:'#263c51',strength:.55,f0:.6} }
    }),plane.id,{strength:1,f0:.89,distortion:0,blur:0});
    box([1.80,.02,.12],[1.49,.026,1.95],water,.13,.006);
    S.bake();

    return B.finish({
      cam:{target:[0,.37,0],yaw:.08,pitch:.49,dist:10.6,sway:0},
      radius:9,dither:0,reflections:[plane],
      look:{splatCoverage:'continuous'},
      areaLights:[
        {id:'window',at:[-1.92,.965,-1.497],normal:[0,-.36,1],shape:'rectangle',size:[1.77,.82],
          color:'#d4e9ff',radius:6.3,intensity:7,sampleGrid:5,reflection:false},
        {id:'lantern',at:[2.16,.955,-1.51],normal:[0,0,1],shape:'disk',size:[.345,.454],
          color:'#ffc078',radius:4.0,intensity:4.5,sampleGrid:4,twoSided:true}
      ]
    });
  }
});
