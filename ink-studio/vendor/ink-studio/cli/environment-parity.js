const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const PNG = require('./png.js');
const runWebGL = require('./look-webgl.js');
const observatory = require('../examples/environment-test-scene.js');

const width = 112, height = 72;
const front = {target:[0,0,0],dist:11,pitch:.035,yaw:.06};
const orbit = {...front,target:[.25,.13,-.4],yaw:-.23,pitch:.14};
const ortho = {...orbit,ortho:true};
const cases = [
  {id:'dawn', description:'Directional sky at dawn',time:0,camera:front,cloud:false,fog:false},
  {id:'interrupt', description:'Interrupted sky transition',time:2.5,camera:orbit,cloud:false,fog:false},
  {id:'pinned-ortho', description:'Orthographic sky with a profile override',time:1.25,camera:ortho,
    profiles:{light:'dusk'},cloud:false,fog:false},
  {id:'card', description:'Cloud card between two surfaces',time:1.0,camera:front,cloud:true,fog:false},
  {id:'card-orbit', description:'Cloud card parallax and drift',time:3.25,camera:orbit,cloud:true,fog:false},
  {id:'fog', description:'Overlapping bounded fog and height mist',time:3.25,camera:front,cloud:false,fog:true},
  {id:'card-fog', description:'Card and bounded fog in orthographic projection',time:2.25,camera:ortho,cloud:true,fog:true}
];

function build({ makeBuilder, KIT:K }) {
  const B = makeBuilder(42,[0x142636,0x88694a,0x708b8f,0xe6b07b,0x37506a]);
  B.disc(-.94,-.16,2.2,[0,0,1],.58,.045,B.P[3],3);
  B.disc(.95,-.15,-3.0,[0,0,1],.81,.045,B.P[2],3);
  B.disc(0,-1.0,-2,[0,1,.2],1.65,.04,B.P[4],3);
  const dawn = {zenith:'#416a9b',horizon:'#e0a276',ground:'#536370',sunColor:'#ffd6ab',
    sunAzimuth:3.10,sunAltitude:.19,sunSize:.055,sunStrength:.86,overcast:0,fogDensity:.7};
  const dusk = {...dawn,zenith:'#4f4268',horizon:'#faa381',ground:'#4d405c',sunColor:'#ffb888',
    sunAltitude:.075,sunStrength:1.1,fogDensity:1.15};
  const storm = {...dusk,zenith:'#26324e',horizon:'#7a7eaa',ground:'#394465',sunStrength:.28,
    overcast:.25,fogDensity:1.65};
  const skyEnvironment = K.skyEnvironment.compile({
    profiles:{dawn,dusk,storm}, sequences:{day:{duration:6,loop:false,keys:[{at:0,profile:'dawn'},{at:5,profile:'dusk'}]}},
    tracks:[{id:'light',sequence:'day'}], sky:{orthoFov:49,splats:[
      {id:'high mist',at:[3.29,.208],size:[.20,.038],color:'#edb4ac',opacity:.36},
      {id:'horizon haze',at:[2.92,.045],size:[.27,.023],color:'#f3c5ac',opacity:.29}
    ]}
  }).interrupt({at:1.8,profile:'storm',duration:2.8});
  const cloudField = K.clouds.asset({bounds:{min:[-3.7,-2.6],max:[3.5,1.2]},height:.54,thickness:2.6,
    resolution:[32,24],velocity:[.18,-.025],color:'#8fa1b7',opacity:.86,
    lighting:{color:'#ffd2b6',ambient:.32},
    coverage(x,z) {
      return Math.max(0,Math.min(1,1.35-Math.hypot((x+.22)/2.75,(z+.56)/1.36)+.17*Math.cos(x*2.8)));
    }
  },{resolution:48});
  return B.finish({cam:{target:[0,0,0],dist:11,pitch:.035,yaw:.06},radius:9,detail:20,dither:0,
    skyEnvironment,cloudField,cloudRepresentation:'card',weatherBinding:true,atmosphere:[
      K.atmosphere.box({min:[-2.25,-1.8,1.0],max:[2.45,.52,5.5],density:.214,color:'#a6b4c6'}),
      K.atmosphere.sphere({at:[1,.4,2.05],radius:1.4,density:.26,color:'#e4a585'}),
      K.atmosphere.fog({bottom:-2.3,top:-.76,near:1,far:24,density:.083,color:'#798baf'})
    ]});
}

function browser(kit, fixture, backend, {width,height,cases}) {
  const authored = fixture(kit), world = authored.build ? authored.build(authored.seed) : authored;
  const gpu = backend(width,height,{raw:true,dither:0});
  try {
    return { driver:gpu.driver, frames:cases.map(entry=>{
      const scene = entry.cloud || entry.fog ? world : {...world,count:0};
      const options = { time:entry.time,camera:entry.camera,skyProfiles:entry.profiles,
        cloudField:entry.cloud ? undefined : false,atmosphere:entry.fog };
      gpu.draw(scene,options);
      const color = gpu.image();
      gpu.draw(scene,{...options,...(entry.cloud ? {cloudField:false} : entry.fog ? {atmosphere:false} : {skyEnvironment:false})});
      return {color,disabled:gpu.image()};
    }) };
  } finally {
    gpu.close();
  }
}

function metrics(reference,actual) {
  const difference = new Uint8Array(reference.length);
  const errors = new Uint32Array(256);
  let sum = 0, bad = 0;
  for (let i=0;i<reference.length;i+=3) {
    let peak = 0;
    for (let c=0;c<3;c++) {
      const d = Math.abs(reference[i+c]-actual[i+c]);
      difference[i+c] = Math.min(255,d*4);
      sum += d;
      peak = Math.max(peak,d);
    }
    errors[peak]++;
    if (peak>12) bad++;
  }
  let p95 = 0, samples = 0;
  while (p95<255 && (samples+=errors[p95])<reference.length/3*.95) p95++;
  return { difference, mean:sum/reference.length, p95, fractionAbove12:bad/(reference.length/3) };
}

function compare(options = {}) {
  const kit = ink.load(), name = options.fixture ?? 'baseline';
  if (!['baseline','observatory'].includes(name))
    throw new RangeError('Environment parity fixture must be baseline or observatory');
  const fixture = name === 'observatory' ? observatory : build;
  const authored = fixture(kit), world = authored.build ? authored.build(authored.seed) : authored;
  const views = name === 'observatory'
    ? [false,true].flatMap(ortho=>authored.checkpoints.map(({id,time,description})=>({
      id:(ortho ? 'ortho-' : 'perspective-')+id, time, description, camera:authored.camera(time,ortho), cloud:true, fog:true
    }))) : cases;
  const gpu = runWebGL(options,fixture,browser,{width,height,cases:views});
  const details = views.map((entry,i)=>{
    const {camera,time,profiles,cloud,fog} = entry;
    const scene = cloud || fog ? world : {...world,count:0};
    const view = {...camera,w:width,h:height,px:1,t:time,raw:true,soft:true,dither:0,skyProfiles:profiles,
      cloudField:cloud ? undefined : false,atmosphere:fog};
    const cpu = ink.render(scene,view).rgb;
    const baseline = ink.render(scene,{...view,...(cloud ? {cloudField:false} : fog ? {atmosphere:false} :
      {skyEnvironment:false})}).rgb;
    const pixels = Buffer.from(gpu.frames[i].color,'base64');
    const disabled = Buffer.from(gpu.frames[i].disabled,'base64');
    if (pixels.length!==cpu.length || disabled.length!==cpu.length) throw new Error('WebGL environment readback size differs');
    const {difference,...error} = metrics(cpu,pixels);
    return { ...entry, ...error, cliEffect:metrics(baseline,cpu).mean, webglEffect:metrics(disabled,pixels).mean,
      cpu, gpu:pixels, difference };
  });
  return { width,height,driver:gpu.driver,fixture:name,frames:details };
}

function write(directory, result) {
  fs.mkdirSync(directory,{recursive:true});
  const {width,height,driver,fixture} = result;
  const frames = result.frames.map(({cpu,gpu,difference,...details})=>{
    const files = { cli:details.id+'-cli.png', webgl:details.id+'-webgl.png', difference:details.id+'-diff.png' };
    for (const [kind,pixels] of [['cli',cpu],['webgl',gpu],['difference',difference]])
      PNG.write(path.join(directory,files[kind]),width,height,pixels);
    return {...details,files};
  });
  fs.writeFileSync(path.join(directory,'environment-parity.json'),
    JSON.stringify({width,height,driver,fixture,differenceGain:4,frames},null,2)+'\n');
}
module.exports = { compare, write };
