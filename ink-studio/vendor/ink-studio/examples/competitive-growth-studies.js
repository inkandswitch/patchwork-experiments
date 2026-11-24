const DURATION = 6.4, FPS = 10, FRAME_COUNT = Math.round(DURATION * FPS);
const palette = [0x141729, 0x24293e, 0x3b4b61, 0x657885, 0x9ca3a1,
  0x35293d, 0x573b46, 0x905c4b, 0xbe8b5d, 0xf1cc87,
  0x163441, 0x245369, 0x437b89, 0x76b0a4, 0xbaf0ce, 0xf99b5c,
  0x172330, 0x1d3437, 0x1e4d42, 0x277052, 0x3d9563, 0x66bc86, 0x99db9f,
  0x391f36, 0x622c41, 0x904348, 0xb95a53, 0xe17b62, 0xf69b78, 0xffc193,
  0x292344, 0x383058, 0x504176, 0x6f5593, 0x8d6ab0, 0xb393cc, 0xe7bff2,
  0x543d2c, 0x70502f, 0x976437, 0xbd893d, 0xe7ae5f, 0xffd689, 0xffebbc,
  0x162e4a, 0x1e4666, 0x28617f, 0x3c89aa, 0x56b1ce, 0x8edbe6, 0xc5f6ec];
const iron = { r:[0,0,1,2] }, steel = { r:[1,2,3,4] }, brass = { r:[5,6,7,8,9] };
const teal = { r:[10,11,12,13] }, cyan = { r:[12,13,14], em:true }, amber = { r:[7,8,15,9], em:true };
const clamp = x => Math.max(0, Math.min(1, x));
const lerp = (a,b,f) => a + (b - a) * f;
function grain(i) {
  const n = Math.imul(i ^ 0xa91, 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 8) / 0x1000000;
}

function studio({ KIT:K, makeBuilder, makeSculpt, SpriteSurface }, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel:true, amb:.31, sky:.19, sunK:.88, sun:K.V.norm([-.44,.81,.41]) });
  const box = (p, half, mat, res = .09) => S.box(p, half, mat, { res, rd:res*.82 });

  function label(text, [x,y,z], span, upright, color) {
    const width = text.length * 6, h = span * 7 / width, letters = [...text].map(c => font.get(c));
    sprites.face([x-span/2,y,z], [span,0,0], upright ? [0,h,0] : [0,0,-h], width, 7,
      (u,v) => letters[Math.floor(u/6)]?.[v*6+u%6] ? color : undefined);
  }

  function show(model, placement, paint, cam) {
    const { width, height, endTime, bounds } = model, mask = model.mask();
    const w = bounds.max[0] - bounds.min[0], h = bounds.max[1] - bounds.min[1];
    const region = sprites.reserve(width, height), rgba = new Uint8Array(width * height * 4);
    const final = model.frame(), arrival = final.data('arrival'), material = final.data(), seam = new Float64Array(mask.length).fill(Infinity);
    for (const segment of final.seams()) {
      for (const i of segment.cells) seam[i] = Math.min(seam[i], segment.time);
    }
    sprites.faceRegion(placement.at, [w,0,0], placement.upright ? [0,h,0] : [0,0,h], region);
    S.bake();
    const atlas = sprites.finish();
    const world = B.finish({ cam, spriteSurfaces:atlas, radius:7, detail:22, dither:.046,
      look:{ pixelSize:1, splatCoverage:'continuous' } });
    const stage = K.stage(world);
    // Paint the time-varying front over a single solved arrival grid.
    const texels = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const [x,z] = model.center(i), color = paint(x,z,grain(i),material[i],arrival[i]);
      texels.push({ i, ...color });
      rgba[4*i+3] = 255;
    }
    let previous = -1;
    stage.add({ update(_dt,time) {
      const t = ((time % DURATION) + DURATION) % DURATION;
      const frame = Math.min(FRAME_COUNT - 1, Math.floor(t * FPS + 1e-7));
      if (previous === frame) return;
      const clock = endTime * (frame / 49) ** 1.1;
      for (const { i, bed, body, rim, joint, settle } of texels) {
        const start = arrival[i], age = clock - start, joined = clock >= seam[i], p = 4*i;
        if (age < 0) {
          rgba.set(bed,p);
          continue;
        }
        const active = Math.max(Math.exp(-age / .105), .18 * Math.exp(-age / .44));
        const heal = settle ? Math.exp(-age / settle) : 1;
        const glow = joined ? Math.exp(-(clock - seam[i]) / .41) : 0;
        for (let c = 0; c < 3; c++) {
          const matured = lerp(body[c],lerp(bed[c],body[c],.62),1-heal);
          const value = joined ? lerp(joint[c],rim[c],.68*glow) : lerp(matured,rim[c],active);
          rgba[p+c] = clamp(value/255)*255;
        }
      }
      SpriteSurface.update(atlas, region, { w:width, h:height, rgba });
      previous = frame;
    } });
    stage.stateful = false;
    stage.update(0,0);
    return world;
  }

  return { S, box, label, show };
}

function veins(K, { S, box, label, show }) {
  const width = 288, height = 170, cell = .03, w = width * cell, h = height * cell, top = 5.88;
  const mask = (x,z) => Math.abs(x) + .76 * Math.max(0, Math.abs(z) - 1.80) < 4.26 &&
    Math.hypot((x+.92)/.48,(z-.36+.22*x)/.26) > 1;
  const materials = [
    { id:'malachite', speed:1.05, angle:.73, stretch:1.52 },
    { id:'jasper', speed:.92, angle:-.64, stretch:1.4, drift:-.18 },
    { id:'amethyst', speed:1.12, angle:.35, stretch:1.23, drift:.09 },
    { id:'pyrite', speed:.87, angle:1.06, stretch:1.42 },
    { id:'chrysocolla', speed:1.02, angle:-.3, stretch:1.50 }
  ];
  const seeds = [
    { at:[-3.44,-.88], material:'malachite' }, { at:[-1.42,1.65], material:'jasper', time:.32 },
    { at:[.74,-1.39], material:'amethyst', time:.21 }, { at:[2.94,1.18], material:'pyrite', time:.39 },
    { at:[3.58,-1.79], material:'chrysocolla', time:.51 }, { at:[.29,2.17], material:'malachite', time:.61 }
  ];
  const model = K.procedural.growth.competitive({ width,height,cell,origin:[-w/2,-h/2],mask,materials,seeds,
    pace:(x,z) => 1 + .21*Math.sin(x*4.8+z*3.9+.94*Math.sin(z*4)) +
      .19*Math.cos(x*3.7-z*6.4) + .16*Math.sin(x*11.3+z*8.1) });
  box([0,3.22,-.37],[4.68,3.05,.36],steel,.108);
  box([0,3.24,-.025],[4.52,2.92,.12],iron,.095);
  box([0,3.32,.096],[4.35,2.60,.103],{ r:[0,0,1,2] },.073);
  for (const y of [.71,5.91]) box([0,y,.18],[4.39,.035,.069],brass,.052);
  for (const x of [-4.39,4.39]) {
    box([x,3.31,.146],[.041,2.61,.066],brass,.052);
    for (const y of [.49,6.02]) {
      S.ball([x,y,.20],.083,brass,{ res:.055 });
      S.ball([x,y,.268],.031,teal,{ res:.039 });
    }
  }
  box([0,.435,.187],[1.61,.114,.035],iron,.066);
  label('VEIN ATLAS',[0,.342,.245],2.55,true,0xffd89c);
  for (const x of [-2.64,2.64]) for (let i = 0; i < 9; i++) {
    box([x+.109*(i-4),.455,.184],[.022,i%4 ? .024 : .042,.027],i%4 ? brass : cyan,.036);
  }
  const stones = [
    { dark:[19,48,47], light:[80,201,154], rim:[200,255,187] },
    { dark:[79,34,48], light:[232,107,86], rim:[255,225,154] },
    { dark:[37,27,67], light:[145,115,207], rim:[228,203,255] },
    { dark:[87,54,39], light:[223,165,81], rim:[255,237,177] },
    { dark:[21,40,65], light:[76,161,206], rim:[181,247,255] }
  ];
  function paint(x,z,noise,id,arrival) {
    const grain = .10*Math.sin(18*x+16*z) + .08*Math.cos(37*z-15*x) + .18*(noise-.5);
    const bed = [18+27*grain,23+29*grain,38+36*grain];
    const { dark, light, rim } = stones[id], strata = 19*arrival + .65*Math.sin(8*x-3*z) + .48*Math.cos(z*9+x*4);
    const wave = .5+.5*Math.cos(strata), split = .5+.5*Math.sin(strata*.324+id*.89);
    const shine = clamp(.20 + .56*wave**2 + .25*split + grain + .12*Math.cos((x+z)*4.2));
    const body = dark.map((v,c) => lerp(v,light[c],shine));
    const joint = body.map((v,c) => lerp(v,[250,209,133][c],.54+.16*noise));
    return { bed, body, rim, joint };
  }
  return show(model, { at:[-w/2,top-h,.245], upright:true }, paint,
    { target:[0,3.22,-.05], dist:12.85, fov:.56, yaw:-.065, pitch:.068, sway:0 });
}

function weld(K, { S, box, label, show }) {
  const width = 288, height = 144, cell = .03, w = width * cell, h = height * cell;
  const slots = [[-1.51,-.70,.70],[1.25,.69,.86],[.13,1.81,.47]];
  const slotDistance = (x,z,[cx,cz,r]) => Math.hypot(Math.max(0,Math.abs(x-cx)-r),z-cz);
  const mask = (x,z) => slots.every(slot => slotDistance(x,z,slot) > .132);
  const materials = [
    { id:'nickel', speed:1.38, angle:.23, stretch:1.36, drift:.22 },
    { id:'bronze', speed:1.27, angle:-.50, stretch:1.52, drift:-.18 },
    { id:'steel', speed:1.14, angle:1.31, stretch:1.28 }
  ];
  const seeds = [
    { at:[-3.7,-1.48], material:'nickel' }, { at:[3.79,1.47], material:'bronze' },
    { at:[-.36,.08], material:'steel', time:.33 },
    { at:[-3.37,1.31], material:'bronze', time:.59 },
    { at:[3.41,-1.36], material:'nickel', time:.54 }
  ];
  const model = K.procedural.growth.competitive({ width,height,cell,origin:[-w/2,-h/2],mask,materials,seeds,
    pace:(x,z) => 1 + .24*Math.cos(z*4.7+x*1.9) + .14*Math.sin(x*9.1-z*4.4) +
      .13*Math.cos(z*11.8+.7*Math.sin(x*8.3)) });
  box([0,.08,.13],[4.94,.25,2.79],steel,.111);
  box([0,.335,.065],[4.71,.101,2.59],iron,.088);
  box([0,.457,0],[4.40,.068,2.231],{ r:[0,0,1,2] },.074);
  for (const side of [-1,1]) {
    box([0,.526,side*2.27],[4.47,.045,.059],brass,.064);
    box([side*4.41,.532,0],[.063,.059,2.3],teal,.064);
    for (let i=0;i<11;i++) {
      const z = -2.1+i*.42;
      box([side*4.64,.476,z],[.147,.091,.102],steel,.051);
      if (i%2===0) box([side*4.644,.574,z],[.075,.018,.039],side===1 ? amber : cyan,.042);
    }
  }
  for (const [x,z,r] of slots) {
    box([x,.489,-z],[r+.120,.061,.119],iron,.050);
    for (const sign of [-1,1]) box([x,.558,-z+sign*.135],[r+.045,.022,.019],teal,.046);
    S.ball([x-r-.112,.546,-z],.035,amber,{ res:.04 });
    S.ball([x+r+.112,.546,-z],.035,amber,{ res:.04 });
  }
  box([0,.469,2.515],[1.85,.099,.175],iron,.065);
  label('WELD REGISTER',[0,.643,2.69],3.20,false,0xffdfa4);
  const alloys = [
    { dark:[24,61,92], light:[67,157,189], rim:[157,244,255], joint:[171,227,234] },
    { dark:[90,43,40], light:[211,113,67], rim:[255,205,124], joint:[248,170,99] },
    { dark:[49,39,74], light:[149,119,163], rim:[240,218,255], joint:[202,166,200] }
  ];
  function paint(x,z,noise,id,arrival) {
    const strip = .5+.5*Math.cos(66*z + 2.4*Math.sin(x*.8)), ticks = .5+.5*Math.sin(25*x+26*z);
    const polish = .46 + .16*Math.cos(z*11+x*.34) + .19*strip + .15*noise;
    const bed = [14+18*polish,20+23*polish,31+31*polish];
    const { dark, light, rim, joint } = alloys[id];
    const sweep = .5+.5*Math.cos(23*arrival + 3.4*Math.sin(12*z) + 1.6*Math.cos(18*z+x));
    const body = dark.map((v,c) => lerp(v,light[c],clamp(polish*.58+.26*sweep**3)));
    const bead = joint.map(v => v * (.53+.46*ticks**2));
    return { bed, body, rim, joint:bead, settle:1.44 };
  }
  return show(model, { at:[-w/2,.567,-h/2] }, paint,
    { target:[0,.24,.24], dist:13.5, fov:.53, yaw:-.16, pitch:1.02, sway:0 });
}

module.exports = kit => ({
  id:'competitive-growth-studies', name:'Vein Atlas and Weld Register', seed:27, duration:DURATION,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'veins';
    if (study !== 'veins' && study !== 'weld') throw new RangeError('Choose veins or weld');
    const set = studio(kit,seed);
    return (study === 'veins' ? veins : weld)(kit.KIT,set);
  }
});
