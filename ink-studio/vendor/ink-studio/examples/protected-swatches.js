/* A ferry console keeps a glyph, team badge and lamp core exact. */
const dark = '#773832', core = '#ffc36a';

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'protected-swatches', name: 'Ferry console palette', seed: 23,
  build(seed, { controls } = {}) {
    const mode = controls?.mode ?? 'dither';
    if (!['exact', 'match', 'dither'].includes(mode)) throw new RangeError('Choose exact, match or dither');
    const B = makeBuilder(seed, [
      0x182333, 0x253848, 0x384c5c, 0x526a74, 0x89949a,
      0x392b35, 0x59434b, 0x865a52, 0xb28261, 0xdab07c, 0xf4dca5,
      0x416e68, 0xf3e4a2, 0x3d8098, 0x52bcd0,
      0x99523e, 0xba7049, 0xd18b55, 0xffc36a, 0x263d46
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.52,.80,.49]), amb: .28, sky: .18, sunK: .67 });
    const iron = { r: [0,1,2,3] }, edge = { r: [1,2,3,4] };
    const copper = { r: [5,6,7,8] }, brass = { r: [7,8,9,10] };
    const flat = (r, materialId) => ({ r: [r], em: true, materialId });
    const box = (p,h,m,res=.057,rd=res*.6) => S.box(p,h,m,{res,rd});
    const tube = (points,r,m) => S.tube(points,r,r,m,{res:Math.max(.024,r*.57)});
    const xGlyph = -2.21, xBadge = 2.21;

    box([0,-.12,0],[3.72,.17,1.04],iron,.11);
    box([0,.075,.06],[3.73,.059,1.015],copper,.090);
    box([0,.139,.08],[3.66,.028,.975],brass,.073);
    box([0,1.14,-.32],[3.54,.994,.55],iron,.094);
    box([0,1.20,.229],[3.44,.886,.070],edge,.079);
    box([0,2.119,-.28],[3.66,.066,.643],copper,.083);
    box([0,2.183,-.273],[3.67,.024,.651],brass,.069);
    for (const x of [-3.47,-1.12,1.12,3.47]) {
      box([x,1.17,.352],[.050,.916,.084],copper);
      for (const y of [.45,1.93]) S.ball([x,y,.397],.050,brass,{res:.027});
    }

    box([xGlyph,1.19,.327],[.91,.68,.143],copper,.068);
    box([xGlyph,1.19,.486],[.778,.562,.059],flat(11,'glyph'),.043);
    const paint = flat(12,'glyph');
    const strokes = [
      [[-.46,-.25],[-.46,.25],[-.19,.25]],
      [[-.46,.02],[-.245,.02]],
      [[-.035,-.25],[-.035,.25],[.198,.25],[.249,.188],[.249,.072],[.195,.016],[-.035,.016]],
      [[.13,.016],[.277,-.25]],
      [[.426,-.25],[.426,.25]],
    ];
    for (const stroke of strokes)
      tube(stroke.map(([x,y])=>[xGlyph+x,1.227+y,.557]),.037,paint);
    box([xGlyph,.711,.554],[.456,.024,.014],{r:[19]},.027);

    box([0,1.20,.352],[.89,.71,.141],copper,.064);
    box([0,1.20,.503],[.811,.637,.048],brass,.049);
    box([0,1.20,.564],[.728,.558,.042],flat(15,'lantern'),.040,.060);
    box([0,1.20,.609],[.570,.440,.028],flat(16,'lantern'),.032,.060);
    box([0,1.20,.641],[.407,.316,.020],flat(17,'lantern'),.030,.060);
    S.ball([0,1.20,.665],[.170,.228,.048],flat(18,'lantern'),{res:.023});
    for (const x of [-.755,.755]) for (const y of [.67,1.73])
      S.ball([x,y,.568],.039,iron,{res:.024});

    box([xBadge,1.19,.337],[.91,.68,.131],copper,.061);
    box([xBadge,1.19,.480],[.779,.558,.059],flat(13,'team'),.041);
    const badge = flat(14,'team');
    const crest = [[-.58,.13],[-.27,-.17],[0,.07],[.27,-.17],[.58,.13]];
    tube(crest.map(([x,y])=>[xBadge+x,1.26+y,.554]),.055,badge);
    S.ball([xBadge,1.578,.551],[.089,.089,.026],badge,{res:.025});
    for (const x of [-.51,0,.51]) S.ball([xBadge+x,.779,.555],.038,brass,{res:.026});
    S.bake();

    const protectedCore = mode === 'exact' ? core : { color: core,
      ...(mode === 'match' ? { match: true } : { dither: true }) };
    return B.finish({
      cam: { target: [0,1.09,.16], dist: 8.35, yaw: .16, pitch: .17, sway: 0 },
      radius: 9, detail: 27, dither: 0,
      skyEnvironment: { defaults: { zenith: '#26384e', horizon: '#4e6674', ground: '#283e50', sunStrength: 0 } },
      look: { splatCoverage: 'continuous', paletteConstraints: { targets: [
        { material: 'glyph', palette: ['#294b4e','#80a18b'], reserved: ['#f3e4a2'], dither: { strength: .8 } },
        { material: 'lantern', palette: [dark], reserved: [protectedCore],
          dither: { pattern: 'bayer', strength: 1, ...(mode === 'dither' && { pairs: [{ colors: [dark, core] }] }) } },
        { material: 'team', palette: ['#29465e','#53737d'], reserved: ['#52bcd0'], dither: { strength: .8 } }
      ] } }
    });
  }
});
