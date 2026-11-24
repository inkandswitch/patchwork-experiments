const DURATION = 6.4, FPS = 10, FRAMES = Math.round(DURATION * FPS), TAU = 2 * Math.PI;
const swatches = [0x101a2a, 0x213849, 0x364e63, 0x69838b, 0x9eb2ad,
  0x432c33, 0x754942, 0xa97454, 0xdca777, 0xffd698,
  0x093642, 0x205968, 0x2b868f, 0x70b9ae, 0xbde4cb,
  0x241c38, 0x4e385a, 0x7b526f, 0xad807e, 0xe2af9b, 0xe7d3e2];
const shell = { r: [0, 1, 2, 3, 4] }, iron = { r: [0, 0, 1, 2] }, brass = { r: [5, 6, 7, 8, 9] };
const stone = { r: [1, 2, 3, 4, 18] }, green = { r: [10, 11, 12, 13] };
const signal = { r: [12, 13, 14], em: true }, goldLight = { r: [8, 9, 9], em: true };
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, f) => a.map((n, i) => n + (b[i] - n) * clamp(f));

function studio(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, swatches), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .33, sky: .18, sunK: .84, sun: K.V.norm([-.51, .78, .42]) });
  const box = (p, half, mat, res = .086, rd = .068) => S.box(p, half, mat, { res, rd });
  function label(text, [x, y, z], span, vertical, color) {
    const columns = text.length * 6, h = 7 * span / columns, letters = [...text].map(c => font.get(c));
    sprites.face([x - span / 2, y, z], [span, 0, 0], vertical ? [0, h, 0] : [0, 0, -h], columns, 7,
      (u, v) => letters[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
  }
  function raster(region, width, height) {
    const rgba = new Uint8Array(width * height * 4);
    return (write, pixel) => {
      for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i += 4) {
        const value = pixel(x, y, (height - 1 - y) * width + x);
        if (value) rgba.set(value, i);
        rgba[i+3] = value ? 255 : 0;
      }
      write(region, { w: width, h: height, rgba });
    };
  }
  function finish(cam, draw) {
    S.bake();
    const atlas = sprites.finish(), write = (id, image) => SpriteSurface.update(atlas, id, image);
    const world = B.finish({ spriteSurfaces: atlas, cam, radius: 7, detail: 23, dither: .038,
      look: { pixelSize: 1, splatCoverage: 'continuous' } });
    let previous = -1;
    const stage = K.stage(world);
    stage.add({ update(_dt, time) {
      const local = ((time % DURATION) + DURATION) % DURATION;
      const frame = Math.min(FRAMES - 1, Math.floor(local * FPS + 1e-7));
      if (frame === previous) return;
      draw(write, frame / FPS);
      previous = frame;
    } });
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
  return { S, sprites, box, label, raster, finish };
}

function harbor(K, set) {
  const { S, sprites, box, label, raster, finish } = set, F = K.fieldViews;
  const width = 8.77, depth = 4.68, y = .405, counts = [219,117], left = -width/2, front = depth/2;
  const island = [-1.57, -.23], other = [1.84, -1.47];
  const obstacle = (x, _y, z) => Math.min(Math.hypot(x - island[0], (z - island[1]) * 1.25) - .80,
    Math.hypot((x - other[0]) * 1.22, z - other[1]) - .43);
  const wake = K.procedural.motion.obstacleWake(obstacle, { origin: [island[0], y, island[1]], radius: .72,
    flow: [1.03, 0, .08], width: .94, circulation: 1.64, length: 5.35, shelter: .57, eddies: 5, period: DURATION });
  const plane = { origin: [left,y,front], u: [1,0,0], v: [0,0,-1], size: [width,depth] };
  const bounds = { min: [left,y,-front], max: [-left,y,front] };
  const region = sprites.reserve(...counts), paint = raster(region, ...counts);
  sprites.faceRegion(plane.origin, [width,0,0], [0,0,-depth], region);

  box([0,-.05,.12], [4.67,.238,2.78], shell, .126, .122);
  box([0,.198,.07], [4.52,.080,2.62], iron, .103, .096);
  for (const side of [-1,1]) {
    box([side*4.45,.373,0], [.083,.087,2.42], green);
    box([0,.365,side*2.427], [4.52,.090,.093], shell);
    for (let j = 0; j < 17; j++) {
      box([-4.20+j*.527,.485,side*2.428], [.033,.022,.032], j%4 ? shell : brass, .038, .029);
    }
  }
  const rock = (x,z,r,h) => S.rock([x,.397,z], [r,h,r*.73], stone, { res:.067 });
  rock(island[0]-.30,island[1],.67,.46);
  rock(island[0]+.33,island[1]+.08,.59,.34);
  rock(island[0]-.055,island[1]-.30,.56,.31);
  rock(other[0],other[1],.49,.25);
  rock(other[0]-.19,other[1]+.11,.26,.15);
  const [lx,lz] = island;
  S.lathe([lx-.17,.869,lz-.062], .18, [.25,.25,.208], brass, { res:.059 });
  S.lathe([lx-.17,1.207,lz-.062], .55, [.16,.147,.119], stone, { res:.052 });
  S.lathe([lx-.17,1.524,lz-.062], .103, [.165,.166], brass, { res:.052 });
  S.lathe([lx-.17,1.624,lz-.062], .121, [.125,.125], goldLight, { res:.042 });
  S.lathe([lx-.17,1.737,lz-.062], .140, [.185,.109,.022], brass, { res:.055 });
  for (const z of [lz-.44,lz+.34]) {
    box([lx+.25,.828,z], [.17,.095,.112], stone, .069);
    box([lx+.25,.928,z], [.183,.037,.124], brass, .065);
  }
  for (const [x,z] of [[-3.62,-1.42],[-3.71,1.31],[3.83,-1.08],[3.88,1.46]]) {
    S.lathe([x,.438,z], .073, [.101,.072], brass, { res:.051 });
    S.ball([x,.510,z], .044, signal, { res:.039 });
  }
  box([0,.361,2.581], [1.44,.083,.166], iron, .087);
  label('HARBOR WAKE',[0,.503,2.702],2.11,false,0xffdda5);
  function draw(write,time) {
    const field = F.source({ type:'vec3',bounds,sample:(x,hy,z) =>
      obstacle(x,hy,z) > 0 ? wake.velocity(x,hy,z,time) : null });
    const fog = F.lic(field,{ plane,counts,seed:72,grain:.046,length:.72,
      motion:{wavelength:.82,phase:time*2/DURATION} });
    paint(write, (x,j,i) => {
      const value = fog.values[i];
      if (value === null) return null;
      const speed = fog.speeds[i], worldX = left+(x+.5)*width/counts[0], z = -front+(j+.5)*depth/counts[1];
      const lee = clamp((worldX-lx+.65)*.66)*Math.exp(-.23*(z-lz)**2);
      const trace = clamp((value-.30)*2.62), bright = clamp((trace-.49)*2.2);
      const base = mix([10,29,47],[14,44,57],.28+speed*.19);
      const mist = mix([41,123,144],[99,171,163],lee*.95);
      const flow = mix(base,mist,.10+trace*.82);
      return mix(flow,[216,242,210],bright*(.24+.44*lee));
    });
  }
  return finish({ target:[0,.31,.20],dist:14.18,fov:.557,pitch:.98,yaw:-.18,sway:0 },draw);
}


function silk(K, set, TexturedSurface) {
  const { S, sprites, box, label, raster, finish } = set, F = K.fieldViews;
  const clothW = 5.10, clothH = 3.98, counts = [175,138], tx = -3.87, bottom = .80;
  const field = F.source({ type:'vec2',components:'xy',bounds:{min:[0,0,0],max:[clothW,clothH,0]},sample(x,y) {
    let u = .29*Math.sin(1.66*y+.45*x), v = -.97;
    for (const [cx,cy,turn] of [[1.67,2.25,1.65],[3.54,1.27,-1.38]]) {
      const dx = x-cx, dy = y-cy, spin = turn*Math.exp(-(dx*dx+dy*dy)*.74);
      u -= dy*spin; v += dx*spin;
    }
    return [u,v];
  }});
  const grain = .029, seed = 939, texture = (u,v) =>
    K.grow.dice(K.procedural.data.hash(Math.floor(u/grain)+','+Math.floor(v/grain),seed))();
  const region = sprites.reserve(...counts), drawCloth = raster(region,...counts);
  const fold = (u,v) => .145*Math.sin(TAU*(3.16*u+.26*v+.10*Math.sin(v*5))) +
    .095*Math.sin(TAU*(1.19*u-.30*v)) + .09*v;
  const cloth = TexturedSurface.grid({ segments:[66,47],point:(u,v) => [
    tx+clothW*u+.114*v*Math.sin(v*4.3+u*4.6),
    bottom+clothH*(1-v)+.128*Math.sin(Math.PI*u)*v**4*Math.sin(TAU*(u+.37)),
    .502+fold(u,v)
  ]});
  sprites.meshRegion(cloth,region);
  box([0,2.68,-.288], [4.34,2.69,.265], shell, .133, .137);
  box([0,2.68,-.012], [4.21,2.54,.092], iron, .094, .106);
  box([-.17,.264,.221], [4.05,.114,.205], shell);
  for (const x of [-4.12,4.07]) {
    box([x,2.70,.24], [.091,2.53,.11], shell, .077);
    for (let j=0;j<11;j++) box([x,.57+j*.428,.373], [.042,.028,.022], j%5 ? brass : goldLight, .045,.031);
  }
  S.tube([[tx-.15,4.83,.561],[tx+clothW+.16,4.83,.561]], .076,.076,brass,{res:.062});
  for (let i=0;i<13;i++) {
    const u=(i+.5)/13;
    S.tube([[tx+clothW*u,4.69,.50+fold(u,0)],[tx+clothW*u,4.822,.642]], .023,.022,brass,{res:.047});
  }
  const rawX = 2.56, rawY = 2.86, rawW = 2.43, rawH = 2.16, proofCounts = [89,80];
  box([rawX,rawY,.24],[1.32,1.18,.147],brass,.077);
  const rawRegion = sprites.reserve(...proofCounts), drawRaw = raster(rawRegion,...proofCounts);
  sprites.faceRegion([rawX-rawW/2,rawY-rawH/2,.486],[rawW,0,0],[0,rawH,0],rawRegion);
  label('SILK CURRENT',[rawX,4.442,.396],2.23,true,0xffdaa3);
  label('INPUT GRAIN',[rawX,1.375,.501],1.48,true,0xffcbab);
  const ink = [33,19,46], violet = [93,49,103], rose = [180,107,134], light = [252,211,170];
  let rawDone = false;
  function draw(write,time) {
    const result = F.lic(field,{plane:{axis:'z'},counts,length:.70,texture,
      motion:{wavelength:.86,phase:time*2/DURATION},kernel:'hann'});
    drawCloth(write, (x,y,i) => {
      const u = (x+.5)/counts[0], v = (y+.5)/counts[1];
      const slope = (fold(u+.002,v)-fold(u-.002,v)) / .004 / clothW;
      const sheen = clamp(.63-.79*slope+.22*Math.sin(TAU*(time/DURATION)+.6-v*2.8));
      const g = clamp((result.values[i]-.25)*2.25);
      const edge = Math.min(u,1-u,v,1-v);
      if (edge<.012) return mix([108,49,72],[233,166,139],g*.5+sheen*.47);
      const pigment = mix(ink,rose,.16+.52*sheen+.23*g);
      const shade = mix(pigment,violet,clamp((.43-g)*2));
      return mix(shade,light,clamp((g-.33)*1.48) * (.43+.56*sheen));
    });
    if (!rawDone) {
      drawRaw(write,(x,y) => {
        const n = texture(1.45+(x+.5)*rawW/proofCounts[0],1.03+(proofCounts[1]-y-.5)*rawH/proofCounts[1]);
        return mix(mix(ink,rose,n*.79),light,clamp(n-.68)*1.45);
      });
      rawDone = true;
    }
  }
  return finish({target:[-.05,2.67,.20],dist:12.64,fov:.549,pitch:.061,yaw:-.117,sway:0},draw);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface }) => ({
  id:'vector-field-painting-studies', name:'Harbor Wake and Silk Current', seed:57, duration:DURATION,
  build(seed, {controls} = {}) {
    const study = controls?.study ?? 'harbor';
    if (!['harbor','silk'].includes(study)) throw new RangeError('Choose harbor or silk');
    const set = studio(K,makeBuilder,makeSculpt,SpriteSurface,seed);
    return study === 'harbor' ? harbor(K,set) : silk(K,set,TexturedSurface);
  }
});
