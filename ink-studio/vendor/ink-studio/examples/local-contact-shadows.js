module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'local-contact-shadows',
  name: 'Harbor steps',
  seed: 53,
  build(seed) {
    const B = makeBuilder(seed, [
      0x283f53, 0x34495a, 0x4d5d67, 0x68777a, 0x8b9892,
      0x736b5c, 0x958371, 0xb8a28b, 0xc7b69a, 0xd9c6a6, 0xe9dbba,
      0x524049, 0x7c4b50, 0xa05855, 0xd77c61, 0xf9b880,
      0x584936, 0x8b6446, 0xb6895c, 0xc89b67, 0xe4bb83,
      0x355356, 0x467771, 0x669586, 0x9fb39a,
      0x334838, 0x4a664a, 0x6d8553, 0x99a362,
      0x9fc4a8
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.48,.69,.60]), amb:.42, sky:.22, sunK:.46, aoK:0, shLen:0 });
    const stone = { r:[1,2,3,4], materialId:'quay stone' };
    const paving = { r:[5,6,7,8,9], materialId:'paving' };
    const pale = { r:[6,7,8,9,10], materialId:'paving' };
    const iron = { r:[1,2,21,22,23] }, wood = { r:[16,17,18,19,20] };
    const coat = { r:[11,12,13,14] }, skin = { r:[17,18,14,15] };
    const leaves = { r:[25,26,27,28,29] }, inner = { r:[21,25,26,27] };
    const box = (at, half, mat, objectId, res = .12, rd = .035) =>
      S.box(at, half, mat, { res, rd, objectId });

    box([0,-.28,0],[3.82,.23,1.85],stone,'slab',.17,.11);
    for (let z = 0; z < 6; z++) for (let x = 0; x < 12; x++)
      box([(x-5.5)*.619,-.024,(z-2.5)*.592],[.301,.051,.288],
        (x+z*3)%7 === 0 ? pale : paving,'paving',.105,.018);
    box([0,.15,-1.59],[3.74,.12,.16],stone,'curb',.131,.048);

    for (const x of [-2,-1.68]) {
      box([x,.18,.34],[.105,.17,.096],iron,'courier',.059);
      box([x,.091,.40],[.13,.064,.155],iron,'courier',.058);
    }
    box([-1.84,.49,.34],[.285,.24,.147],coat,'courier',.064,.055);
    for (const x of [-2.13,-1.55])
      box([x,.53,.35],[.078,.165,.091],coat,'courier',.06,.03);
    box([-1.84,.83,.34],[.144,.128,.127],skin,'courier',.059,.051);
    box([-1.84,.97,.34],[.192,.048,.155],iron,'courier',.061,.027);
    box([-1.84,1.041,.32],[.148,.068,.13],coat,'courier',.061,.04);
    box([-1.84,.442,.495],[.25,.022,.018],wood,'courier',.056,.018);
    box([-1.79,.501,.493],[.033,.17,.022],wood,'courier',.05,.019);

    box([-.40,.294,-.16],[.48,.265,.408],wood,'crate',.083,.034);
    for (const x of [-.79,-.015]) box([x,.293,.254],[.048,.27,.040],wood,'crate',.052,.02);
    for (const y of [.16,.313,.461])
      box([-.40,y,.263],[.348,.01,.021],{ r:[16,17,18] },'crate',.067,.013);
    box([-.40,.568,-.16],[.51,.046,.424],wood,'crate',.076,.026);

    for (const x of [.87,1.85,2.83]) {
      box([x,.105,-.72],[.133,.077,.132],iron,'railing',.065);
      box([x,.501,-.72],[.058,.436,.066],iron,'railing',.061);
      box([x,.955,-.72],[.083,.038,.081],iron,'railing',.063);
    }
    for (const y of [.40,.74]) box([1.85,y,-.72],[1.055,.038,.047],iron,'railing',.089,.022);

    for (const [x,z] of [[-2.93,-.64],[2.65,.70],[3.14,.40]]) {
      S.rock([x,.12,z],[.27,.10,.22],inner,{ res:.079, objectId:'foliage' });
      for (let i = 0; i < 7; i++) {
        const angle = i * Math.PI * 2 / 7, dx = Math.cos(angle), dz = Math.sin(angle);
        const tip = [x+dx*.28,.21+(i%3)*.06,z+dz*.28];
        S.tube([[x,.078,z],[x+dx*.095,.25,z+dz*.095],tip],.030,.042,leaves,{ res:.066, objectId:'foliage' });
        S.ball(tip,[.10,.064,.094],leaves,{ res:.071, objectId:'foliage' });
      }
    }
    S.bake();

    return B.finish({
      cam:{ target:[0,.25,0], dist:9.7, yaw:.23, pitch:.64, sway:0 },
      radius:7, dither:0, look:{ splatCoverage:'continuous', contactShadows:{
        reach:.52, strength:.76,
        cast:{ include:['courier','crate','railing','foliage'].map(object => ({ object })) },
        receive:{ include:[{ material:'paving' }] }
      } }
    });
  }
});
