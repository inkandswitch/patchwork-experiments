const { paintMap } = require('../src/frame-composite.js');

const width = 196, height = 122;
const unitsPerPixel = .046, pitch = .225;
const rect = (x, y, w, h) => ({ type: 'rect', rect: [x, y, w, h] });
const polygon = points => ({ type: 'polygon', points });
const path = (points, width) => ({ type: 'path', points, width });
const arch = (center, bottom, spring, radius, rise) => polygon([
  [center - radius, bottom],
  ...Array.from({ length: 17 }, (_, i) => {
    const angle = Math.PI * (1 - i / 16);
    return [center + radius * Math.cos(angle), spring - rise * Math.sin(angle)];
  }),
  [center + radius, bottom]
]);

function scenery(K) {
  const art = [], depthPaint = [], lightPaint = [];
  const draw = (shape, color) => art.push({ ...shape, color });
  const depth = (shape, band) => depthPaint.push({ shape, band });
  const light = (shape, normal) => lightPaint.push({ shape, normal });

  draw(polygon([[5,114],[5,31],[12,31],[12,23],[21,23],[21,15],[46,15],[46,10],[58,10],
    [58,5],[133,5],[133,10],[149,10],[149,15],[175,15],[175,22],[185,22],[185,32],[191,32],[191,114]]), '#354655');
  draw(rect(13,24,170,5), '#667773');
  draw(rect(19,18,158,5), '#4f686a');
  draw(rect(51,9,92,4), '#819087');
  draw(rect(59,5,74,3), '#a4aa90');
  draw(rect(14,30,167,3), '#233945');
  draw(rect(20,34,154,71), '#486067');
  for (let row = 0; row < 10; row++) {
    const y = 35 + row * 7;
    for (let col = 0; col < 12; col++) {
      const x = 17 + col * 14 + row % 2 * 6;
      if (x + 13 > 181) continue;
      const shade = ['#4d6369','#566c6d','#456069','#52656a','#607472'][(row * 13 + col * 7) % 5];
      draw(rect(x, y, 13, 6), shade);
      if ((row * 3 + col) % 4 === 0) draw(rect(x, y, 8, 1), '#72817a');
      if ((row + col * 3) % 5 === 0) draw(rect(x + 9, y + 3, 3, 1), '#394f5a');
    }
  }

  const center = 108, spring = 60;
  draw(arch(center,115,spring,47,45), '#2b404a');
  draw(arch(center,115,spring,44,42), '#768c81');
  draw(arch(center,115,spring,37,35), '#526e6e');
  for (let i = 0; i <= 12; i++) {
    const angle = Math.PI * i / 12, c = Math.cos(angle), s = Math.sin(angle);
    draw(path([[center + 37*c, spring - 35*s], [center + 44*c, spring - 42*s]], 1.1), '#3b5359');
    const bevel = path([[center + 42*c, spring - 40*s],[center + 44*c, spring - 42*s]], 1.15);
    draw(bevel, '#b3b29a');
    light(bevel, [-.45,.5,.72]);
  }
  for (const x of [64,146]) for (const y of [67,77,87,97,107])
    draw(rect(x,y,6,1), '#2b4450');
  const opening = arch(center,116,spring,34,32);
  draw(opening, '#203744');
  depth(opening, 'recess');
  draw(arch(center,115,64,29,28), '#354a53');
  draw(arch(center,111,70,23,24), '#796656');
  draw(arch(center,110,71,18,20), '#a17c5c');
  draw(arch(center,109,73,15,17), '#c89b68');
  draw(arch(center,107,78,11,17), '#e1b57a');
  draw(arch(center,105,80,7,12), '#f4d19a');
  draw(polygon([[78,115],[89,104],[124,104],[137,115]]), '#715b4e');
  draw(polygon([[86,115],[99,105],[117,104],[126,115]]), '#ba8a63');
  for (const y of [105,109,114]) draw(rect(88 - (y-104), y, 36 + 2*(y-104), 1), '#554b49');
  for (const [x,y] of [[90,84],[126,84]]) {
    draw(rect(x-2,y-3,5,13), '#624a44');
    draw(rect(x-1,y,3,7), '#e7ab71');
    draw(rect(x,y+1,1,4), '#fff0b0');
  }

  // The normal marks sit alongside the painted stone and metal highlights.
  for (const [x,y] of [[19,35],[43,37],[151,37],[167,64]]) {
    const bevel = polygon([[x,y],[x+17,y],[x+15,y+2],[x+2,y+2]]);
    draw(bevel, '#a3aa8e');
    light(bevel, [-.5,.55,.72]);
  }
  for (const x of [29,163]) {
    draw(rect(x-5,42,11,40), '#2b4553');
    draw(rect(x-4,43,9,36), '#596b68');
    draw(rect(x-2,46,5,28), '#263a45');
    draw(rect(x,50,1,20), '#7e9180');
  }

  const vines = [
    { at: [[41,15],[48,28],[45,46],[52,67],[47,91],[53,107]], width:3.6, seed:3 },
    { at: [[57,13],[56,28],[62,45],[55,61],[61,79],[58,99]], width:3, seed:6 },
    { at: [[28,18],[32,32],[30,53],[35,70],[31,86]], width:2.5, seed:2 },
    { at: [[73,10],[70,22],[77,35],[73,54],[78,67]], width:2.1, seed:5 },
    { at: [[160,13],[153,28],[158,42],[153,54],[155,75]], width:2.5, seed:7 },
    { at: [[176,20],[172,36],[176,53],[169,70],[174,92]], width:2.7, seed:1 }
  ];
  for (const vine of vines) {
    const stem = path(vine.at, vine.width);
    draw(stem, '#1e3b38');
    depth(stem, 'ivy');
    for (let i = 0; i < vine.at.length - 1; i++) {
      const [ax,ay] = vine.at[i], [bx,by] = vine.at[i+1];
      for (let j = 0; j < 3; j++) {
        const t = (j + .1)/3, x = Math.round(ax + (bx-ax)*t), y = Math.round(ay + (by-ay)*t);
        const side = (i + j + vine.seed) % 2 ? 1 : -1, reach = 5 + (i*3 + j + vine.seed) % 5;
        const leaf = polygon([[x,y],[x+side*2,y-3],[x+side*reach,y-4],[x+side*(reach-2),y+1],[x+side*3,y+3]]);
        draw(leaf, ['#365b47','#437354','#57845e','#659269'][(i + j*3 + vine.seed)%4]);
        depth(leaf, 'ivy');
        const vein = path([[x+side*2,y],[x+side*(reach-2),y-2]], 1.1);
        draw(vein, '#91ab78');
        light(vein, [-.68,.36,.64]);
      }
    }
  }

  const source = { metadata: {
    width, height, unitsPerPixel,
    frames: [{ pitch, pivot: { x: width/2, y: 108 }, rect: { x: 0, y: 0, width, height } }],
    scenery: { bands: { ivy: -.98, wall: 0, recess: 1.32 }, base: 'wall', depthPaint, lightPaint }
  }, images: { color: paintMap(width, height, art) } };
  return K.sprite.atlas(source);
}

function courier(K) {
  const width = 25, height = 35, frames = [], images = new Uint8Array(width * height * 4 * 8);
  for (let frame = 0; frame < 8; frame++) {
    const phase = frame * Math.PI / 4, stride = Math.round(Math.sin(phase)*4);
    const lift = Math.round(Math.max(0,Math.cos(phase))*3), bob = frame % 4 === 0 ? 1 : 0;
    const art = [];
    const draw = (shape, color) => art.push({ ...shape, color });
    draw(path([[11,23],[12-stride,27],[12-stride,32-lift]],3), '#453343');
    draw(rect(11-stride,32-lift,5,3), '#654c47');
    draw(path([[12,23],[13+stride,28],[12+stride,32]],3), '#694a4d');
    draw(rect(11+stride,32,6,3), '#956c54');
    draw(polygon([[8,12+bob],[15,12+bob],[17,18],[16,24],[11,26],[5,23],[7,18]]), '#ae574d');
    draw(polygon([[8,14+bob],[12,16],[10,23],[5,23],[7,18]]), '#703d49');
    draw(polygon([[7,8+bob],[9,3+bob],[14,2+bob],[18,6+bob],[18,11+bob],[15,15+bob],[8,13+bob]]), '#bc6a56');
    draw(polygon([[8,7+bob],[10,4+bob],[14,3+bob],[17,7+bob],[11,6+bob],[9,12+bob]]), '#e39268');
    draw(polygon([[13,8+bob],[18,7+bob],[19,11+bob],[15,12+bob],[13,11+bob]]), '#754d47');
    draw(rect(16,8+bob,2,2), '#edbb84');
    draw(rect(16,8+bob,1,1), '#fff0bb');
    draw(path([[9,14],[14,21]],1.5), '#e1ab71');
    draw(rect(7,18,5,5), '#7b5d4f');
    draw(rect(7,18,5,1), '#b28360');
    const lamp = 18 + Math.round(Math.cos(phase));
    draw(path([[14,16],[16,19],[lamp,18]],2), '#e39268');
    draw(path([[lamp,18],[lamp,22]],1), '#997550');
    draw(rect(lamp-1,21,4,6), '#b8784b');
    draw(rect(lamp,22,2,4), '#f1cf85');
    draw(rect(lamp,23,1,2), '#fff1b2');
    images.set(paintMap(width, height, art), frame*width*height*4);
    frames.push({ frame, pivot: { x: 12, y: 35 }, rect: { x: 0, y: frame*height, width, height } });
  }
  return K.sprite.atlas({ metadata: { width, height: height*8, unitsPerPixel: .047, frames }, images: { color: images } });
}

function position(t) {
  const clamp = value => Math.min(1, Math.max(0, value));
  const x = -3.58 + 7.16 * clamp(t/5.6);
  const turn = Math.min(clamp((x+.68)/.64), clamp((1.84-x)/.61));
  return [x, .045, .42 - .72*turn*turn*(3-2*turn)];
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'painted-scenery',
  name: 'The Ivy Arcade',
  seed: 43,
  build(seed, { depth = true, lighting = true, fog = true } = {}) {
    const B = makeBuilder(seed, [
      0x132531,0x203744,0x2b404a,0x354a53,0x486067,0x607472,0x768c81,0xa3aa8e,0xc2c1a0,
      0x1e3b38,0x365b47,0x437354,0x57845e,0x659269,0x91ab78,
      0x453343,0x654c47,0x703d49,0xae574d,0xbc6a56,0xe39268,0xe1ab71,0xedbb84,0xf4d19a,0xfff0b0,
      0x624a44,0x796656,0xa17c5c,0xc89b68,0xe1b57a,0x58717a,0x90a7a6,
      0x394f5a,0x526e6e,0x819087,0x97a6a1
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: K.V.norm([-.65,.73,.39]), amb: .48, sunK: .53, sky: .15, shLen: 0 });
    const stone = { r: [1,2,3,4,5,6] }, paving = { r: [2,3,4,5,6,34] };
    const moss = { r: [9,10,11,12,13] };
    const pier = material => ({ ...material, materialId: 'carved-pier' });
    const box = (at, half, mat, res=.13, rd=.055) => S.box(at, half, mat, { res, rd });
    box([0,-.27,.72],[5.04,.24,1.85],stone,.17,.10);
    for (let row = 0; row < 5; row++) for (let col = -7; col <= 7; col++) {
      const x = col*.65 + (row % 2)*.29, z = -.53 + row*.57;
      box([x,-.023,z],[.312,.05,.273],(col*3+row*7)%6===0?stone:paving,.109,.037);
    }
    S.bake();
    S.keepRenderSdf = true;
    for (const side of [-1,1]) {
      const x=side*4.10;
      box([x,.15,.18],[.36,.17,.48],pier(stone),.12,.065);
      box([x,.39,.11],[.29,.16,.36],pier(stone),.11);
      const blocks = side < 0 ? 4 : 5;
      for (let row = 0; row < blocks; row++) {
        const y=.66+row*.31;
        box([x+side*.03*(row%2),y,.10],[.23,.148,.26],pier(row%2?stone:paving),.102,.053);
        if (row%2===1) box([x-side*.05,y+.10,.37],[.14,.019,.026],pier({r:[5,6,7]}),.071,.018);
      }
      const top = .66 + (blocks-1)*.31;
      box([x,top+.16,.11],[.31,.055,.31],pier({r:[3,4,5,6,7]}),.105,.046);
      box([x+side*.06,top+.22,.17],[.22,.037,.24],pier(moss),.084,.031);
    }
    S.bake();
    S.keepRenderSdf = false;
    const planters = [[-3.76,1.28], [3.32,1.51], [4.32,.72]];
    for (const [i,[x,z]] of planters.entries()) {
      S.rock([x,.032,z],[.40,.14,.38],stone,{res:.095});
      for (let j = 0; j < 13; j++) {
        const a = i + j*2.4, reach = .10 + j%4*.055;
        S.ball([x+Math.sin(a)*reach,.15 + j%5*.036,z+Math.cos(a)*reach],
          [.088,.044,.072],j%4===0?{r:[11,12,13,14]}:moss,{res:.048,rd:.027});
      }
    }
    S.bake();

    const painting = scenery(K);
    const actor = courier(K);
    return B.finish({
      cam: { target: [0,1.95,.19], yaw: 0, pitch, ortho: true, dist: 9.45, sway: 0 },
      radius: 11, dither: 0, detail: 21,
      look: { splatCoverage: 'continuous', sdfAssist: { rules: [{ select: { material: 'carved-pier' } }] } },
      spriteAtlases: [
        K.sprite.placeAtlas({ atlas: painting, at: [0,.08,0], depth, lighting, objectId: 'arcade-painting' }),
        K.sprite.placeAtlas({ atlas: actor, at: position, mode: 'card',
          frame: t => Math.floor(Math.max(0,t)*10)%8, objectId: 'courier' })
      ],
      liveSun: { direction: t => K.V.norm([-.70*Math.cos(t*.43),.40,.57]), ambient: .63,
        intensity: .61, shadows: false },
      atmosphere: fog ? [
        K.atmosphere.sphere({ id: 'arch-mist', at: [.42,.53,-.67], radius: 1.03, color: '#829caa', density: .24 }),
        K.atmosphere.sphere({ id: 'floor-mist-left', at: [-.49,.07,-.32], radius: .63, color: '#8aa3a4', density: .16 }),
        K.atmosphere.sphere({ id: 'floor-mist-right', at: [1.19,.12,-.37], radius: .72, color: '#95aaa5', density: .16 })
      ] : []
    });
  }
});
