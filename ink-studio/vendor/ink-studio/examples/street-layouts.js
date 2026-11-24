module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'street-layouts',
  name: 'Street fields and house lots',
  seed: 0,
  build(seed) {
    const B = makeBuilder(20, [
      0x17282f, 0x333b33, 0x586847, 0x788658, 0x9a9a64,
      0x514936, 0x866c49, 0xb18f5f, 0xd3b782, 0xead19d,
      0x3d4e52, 0x597279, 0x769494, 0x9faf9e,
      0x583c37, 0x91513e, 0xbc7754, 0xdda876
    ]);
    const S = K.sculpt(makeSculpt(B)),
      { routes } = K.procedural,
      bounds = { min: [-4.0,-2.65], max: [4.0,0.08] },
      field = routes.tensor([
        { type: 'grid', angle: 0.06, strength: 0.65 },
        { type: 'ring', origin: [0.28,-1.36], radius: 4.6, strength: 2.1 },
        { type: 'grid', origin: [3.8,-1.0], radius: 2.8, strength: 1.4, angle: -0.21 }
      ]),
      planar = p => [p[0],0.095,p[2]],
      natural = (x,z) => Math.hypot((x-0.09)/0.85,(z+1.30)/0.64) > 1.0,
      ground = { r: [1,2,3,4], mod: (x,y,z) => (B.n3(x*2,y*2,z*2)-0.5)*0.28 },
      road = { r: [5,6,7,8,9] },
      roof = { r: [14,15,16,17] };
    S.ground(ground,{rad:4.85,zs:1.48,edge:0.022,res:0.091});
    if (seed % 2) {
      const paths = routes.growStreets([
        { point: [-3.95,-1.78], angle: 0.22 }, { point: [3.95,-1.1], angle: Math.PI },
        { point: [-2.63,0], angle: -Math.PI/2 }, { point: [2.5,0], angle: -Math.PI/2 }
      ], { bounds, mask:natural, field, seed:18, branchChance:0.13, step:0.52, maxSegments:45, maxAge:12 });
      for (const edge of paths.edges) {
        K.sweep(S, edge.route.points.map(planar), { w:0.094,h:0.038 }, road,{res:0.061});
      }
      for (const [x,,z] of paths.points) {
        S.ball([x,0.095,z],[0.093,0.038,0.093],road,{res:0.061});
      }
    } else {
      const traces = routes.followTensor(field,[
        [-3,-2.05],[-3,-0.69],[3,-2.18],[3,-0.16],{point:[-1.72,-1.07],family:'minor'},
        {point:[1.91,-1.1],family:'minor'}
      ], { bounds, mask:natural, step:0.19, length:6 });
      for (const street of traces.streets) {
        K.sweep(S,street.route.points.map(planar),{w:street.family==='minor'?0.085:0.103,h:0.035},road,{res:0.062});
      }
    }
    S.rock([0.08,0.28,-1.36],0.52,{r:[10,11,12,13]},{res:0.08});
    const site = [[-4.04,0.66],[4.04,0.66],[3.7,1.88],[1.78,2.18],[1.31,1.64],[-0.89,2.49],[-3.38,2.13]],
      parcels = routes.parcels(site,{pitch:1.25,depth:1.33,gap:0.10}),
      ax = [[1,0,0],[0,0,1],[0,1,0]];
    K.sweep(S,[[-4.05,0.093,0.41],[4.05,0.093,0.41]],{w:0.142,h:0.04},road,{res:0.069});
    for (const [i,lot] of parcels.lots.entries()) {
      for (const fragment of lot.fragments) {
        S.extrude([fragment],[0,0.032,0],0.085,{r:i%2?[1,2,3,4]:[5,6,7,8]},{ax,res:0.073});
      }
      const x = (lot.frontage[0][0]+lot.frontage[1][0])/2;
      S.box([x,0.27,1.16],[0.28,0.26,0.31],{r:[10,11,12,13]},{rd:0.029,res:0.07});
      S.box([x,0.555,1.16],[0.34,0.077,0.38],roof,{rd:0.033,res:0.069});
    }
    S.bake();
    return B.finish({cam:{target:[0,0.22,0],dist:12.5,pitch:0.93,yaw:0.09},detail:20,dither:0.26,radius:4.96});
  }
});
