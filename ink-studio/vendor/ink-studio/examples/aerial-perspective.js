const evening = require('./shared-sky-profiles.json');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'pass-at-dusk',
  name: 'Pass at dusk',
  seed: 101,
  build(seed) {
    const B = makeBuilder(seed, [
      0x2a3853, 0x26343a, 0x475357, 0x717775, 0x9a9b8b, 0xbeb8a0,
      0x29392e, 0x43563c, 0x637652, 0x8b9367,
      0x3b414f, 0x545963, 0x6c6974, 0x88808b, 0xa0989e,
      0x564341, 0x765957, 0xa07466, 0xc49778, 0xe5b88a, 0xffdf98
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.amb = .32; S.sky = .15; S.sunK = .50; S.sun = K.V.norm([-.54,.66,.42]);
    const granite = { r:[1,2,3,4,5] }, moss = { r:[6,7,8,9] };
    const mountain = { r:[10,11,12,13,14], materialId:'mountain' };
    const tile = { r:[15,16,17,18,19] };
    const lamp = { r:[20], em:true };

    for (const [x, y, z, sx, sy, sz, res] of [
      [-35,1,-84,22,21,16,1.28], [-15,5,-91,19,22,14,1.18], [12,1,-100,24,22,18,1.22],
      [38,3,-91,23,26,16,1.32], [59,.4,-89,23,18,12,1.36],
      [-23,-2,-59,16,15,13,.93], [-36,1,-50,19,19,10,.97], [-4.9,-2,-63,12,12,7,.73],
      [23,-.8,-58,16,15,11,.93], [37,1,-49,17,21,10,.88], [7,-4,-52,10,10,6,.70],
      [-16,-2.5,-31,10,11,10,.61], [-20,-1,-26,11,13,8,.67], [-8.9,-4,-28,8,8.9,10,.54],
      [14.7,-1.6,-33,11,13,9,.57], [20,0,-28,10,12.5,7,.62], [7.6,-5,-29,7,8,9,.55],
      [-8.1,-2.8,-11,6,8.7,6,.43], [-10.9,-1.9,-8,6.9,8.7,5,.45],
      [11.0,-1.4,-13,5.5,8.8,6,.49], [8.1,-3.6,-10,5.5,7.6,5.0,.42]
    ]) S.rock([x,y,z],[sx,sy,sz],mountain,{res});
    S.rock([-.8,-6.7,-20],[12,4.4,17],moss,{res:.53});
    S.rock([2.1,-6.6,-42],[15,4.4,18],mountain,{res:.68});

    S.rock([-2.65,1.1,1.9],[3.4,1.68,3.1],granite,{res:.15});
    S.rock([-2.62,2.25,2.11],[2.88,.59,2.56],moss,{res:.123});
    S.rock([3.63,.9,.92],[2.15,1.83,2.45],granite,{res:.17});
    S.rock([3.74,2.25,.67],[1.73,.59,1.77],moss,{res:.13});
    for (let i=0;i<12;i++) {
      const x=-3.38+(i%4)*.47, z=-.04+Math.floor(i/4)*.5;
      S.box([x,2.70,z],[.25,.065,.26],granite,{res:.087,rd:.044});
    }
    for (const [x,z,h] of [[-3.30,.22,1.40],[-1.64,-.21,1.12],[3.92,-.18,1.43],[3.06,.24,.95],[4.55,.18,1.27]]) {
      S.lathe([x,2.62,z],.42,[.047,.029],tile,{res:.065});
      for (let i=0;i<3;i++)
        S.lathe([x,2.73+.23*i,z],h*(.57-i*.06),[h*(.22-i*.036),.033],moss,{res:.08});
    }
    S.box([-2.34,2.88,.40],[.58,.13,.36],granite,{res:.075,rd:.05});
    for (const x of [-2.76,-1.94])
      S.lathe([x,2.92,.37],.83,[.082,.071],tile,{res:.051});
    S.box([-2.34,3.76,.36],[.64,.075,.49],granite,{res:.073,rd:.03});
    S.lathe([-2.34,3.82,.36],.33,[.50,.06],tile,{res:.045});
    S.ball([-2.34,3.42,.46],.12,lamp,{res:.052});
    S.bake();
    const density = { day:.047, sunset:.059, 'blue-hour':.086 };
    const profiles = Object.fromEntries(Object.entries(evening.profiles).map(([id, profile]) =>
      [id, { ...profile, aerialDensity:density[id] }]));
    return B.finish({
      cam:{target:[0,2.6,-8],dist:17.9,pitch:.154,yaw:.045,sway:0},
      detail:22,radius:110,dither:0,
      skyEnvironment:K.skyEnvironment.compile({ ...evening, profiles }),
      aerialPerspective:{start:15,contrast:.13}
    });
  }
});
