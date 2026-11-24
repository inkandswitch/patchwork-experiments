module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'beacon-court',
  name: 'Beacon court',
  seed: 13,
  build(seed, { floorFinish } = {}) {
    const B = makeBuilder(seed, [
      0x283c53, 0x374654, 0x63717a, 0x8c9ca0, 0xcfbfa9,
      0x68524d, 0x9b765d, 0xc3a382, 0xe7ccb2, 0xf6e7c6,
      0x513439, 0x884b45, 0xc5715a, 0xe09c77, 0xf1bf8d,
      0x223944, 0x335364, 0x4e7782, 0x72a5a7,
      0x293b2d, 0x4c6242, 0x78824f, 0x9b9f69,
      0xffb963, 0xffdf8d, 0xfff5cd
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.captureAlbedo = true;
    S.pixel = true;
    S.sun = K.V.norm([-.71,.67,.39]);
    S.amb = .27;
    S.sky = .19;
    S.sunK = .64;

    const stone = { r: [1,2,3,4] }, tile = { r: [5,6,7,8], albedo: '#d8b58e', materialId: 'paving' };
    const accent = { r: [5,6,7,9], albedo: '#edcca4', materialId: 'inlay' };
    const floor = floorFinish ? [tile,accent].map(base=>K.surface.material(base,floorFinish)) : [tile,accent];
    const walls = { r: [10,11,12,13,14], albedo: '#d58862', materialId: 'plaster' };
    const copper = { r: [15,16,17,18], materialId: 'copper' };
    const leaf = { r: [19,20,21,22], materialId: 'cover' };
    const lamp = { r: [23,24,25], em: true };
    for (const [x,z,w,d] of [[0,0,4.82,3.40],[0,.24,4.57,3.12],[0,.15,4.31,2.84]]) {
      const y = w > 4.7 ? -.45 : w > 4.5 ? -.24 : -.075;
      S.box([x,y,z],[w,.13,d],stone,{res:.18,rd:.11});
    }
    for (let zi=0;zi<8;zi++) for (let xi=0;xi<11;xi++) {
      const x=(xi-5)*.775, z=(zi-3.5)*.69;
      S.box([x,.032,z],[.372,.033,.329],floor[Number((xi+2*zi)%7===1)],{res:.115,rd:.023});
    }
    const tower = [-.78,.14,-.42];
    const at = (x,y,z) => [tower[0]+x,tower[1]+y,tower[2]+z];
    S.lathe(tower,.20,[.8,.68],stone,{res:.087,objectId:'beacon'});
    S.lathe(at(0,.18,0),1.96,[.54,.42],walls,{res:.067,objectId:'beacon'});
    for (const [j,r] of [[.53,.555],[1.47,.489],[2.03,.62],[2.17,.66],[2.71,.59]])
      S.lathe(at(0,j,0),.08,[r,r*.97],stone,{res:.060,objectId:'beacon'});
    S.lathe(at(0,2.23,0),.47,[.43,.42],lamp,{res:.065,objectId:'lamp'});
    for (let i=0;i<8;i++) {
      const angle=i*Math.PI/4;
      S.lathe(at(.463*Math.cos(angle),2.22,.463*Math.sin(angle)),.50,.044,copper,{res:.044});
    }
    S.lathe(at(0,2.77,0),.58,[.65,.038],copper,{res:.058});
    S.lathe(at(0,3.26,0),.30,.043,stone,{res:.042});
    S.ball(at(0,3.57,0),.055,lamp,{res:.043});
    S.box(at(.025,.40,.50),[.17,.24,.028],copper,{res:.052,rd:.04});
    for (const side of [-1,1]) {
      const x=side*3.44;
      S.box([x,.19,-1.86],[.49,.18,.42],stone,{res:.10,rd:.05});
      S.lathe([x,.32,-1.86],.95,[.125,.105],stone,{res:.067});
      S.lathe([x,1.23,-1.86],.15,[.23,.18],accent,{res:.065});
      S.rock([x,.23,1.9],[.51,.29,.54],leaf,{res:.125});
      S.rock([x+.33,.19,2.25],[.32,.20,.43],leaf,{res:.13});
    }
    S.bake();
    return B.finish({
      cam: { target: [0,.72,0], dist: 12.4, yaw: .41, pitch: .59, sway: 0 },
      detail: 22, radius: 9, dither: 0,
      look: { pixel: true, outline: true },
      liveSun: {
        direction: t => {
          const phase = 2*Math.PI*t/8;
          const az = .77*Math.cos(phase), elevation = .59 + .25*Math.sin(phase);
          return [Math.sin(az)*Math.cos(elevation), Math.sin(elevation), Math.cos(az)*Math.cos(elevation)];
        },
        ambient: .33, intensity: .99, bias: .024, mapSize: 512
      }
    });
  }
});
