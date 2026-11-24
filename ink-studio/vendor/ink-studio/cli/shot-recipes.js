const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const format = 'ink-studio/shot-recipe';
const commands = new Map([
  ['render', ['render']], ['clip', ['clip']], ['transition-review', ['transition-review']], ['sim render', ['sim','render']]
]);
const validSidecar = suffix => /^(?:\.(?:json|txt)|-(?:passes|join)\.json|-[a-zA-Z][a-zA-Z0-9]*\.png)$/.test(suffix);
const fileOptions = new Set([
  'actions','adaptive-sampling','area-lights','art-direction','asset-pack','atmosphere-depth-bands','atmosphere-emitters','authoring','bounce-probes','camera-staging','celestial-tracks','cloud-field',
  'color-stack','composite','contact-shadows','cutaway','edge-filter','effect-palettes','horizon-bands','ink','lightning','look','lut','palette-constraints','plan','precipitation',
  'rain-impacts','relighting','scene-exposure','sdf-assist','shadow-art','shaped-atmosphere','silhouette-protection','sky-environment','sky-transitions',
  'splat-fields','sprite-atlas','sprite-cels','stable','stable-detail','volume-cutouts','weather-binding','wind-field'
]);
const omitted = new Set(['recipe','out','fail-on-flags']);
const fileDigest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isFile = file => fs.statSync(file, {throwIfNoEntry:false})?.isFile();
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));

function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

function atomicWrite(file, write) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary = path.join(path.dirname(file),'.ink-shot-'+randomUUID());
  try {
    write(temporary);
    fs.renameSync(temporary,file);
  } finally {
    fs.rmSync(temporary,{force:true});
  }
}

function modeFor(command, positional) {
  if (command === 'sim') return positional[0] === 'render' ? 'sim render' : undefined;
  return commands.has(command) ? command : undefined;
}

function createRecorder(filename, {mode,scene,options,root}) {
  requireValue(mode && typeof scene === 'string','Use --recipe <file.json> with render, clip, transition-review or sim render');
  requireValue(typeof filename === 'string' && /\.json$/i.test(filename),'--recipe needs a JSON filename');
  const file = path.resolve(root,filename), inputs = new Map();
  root = fs.realpathSync(root);
  const reference = value => {
    const absolute = path.resolve(root,value), relative = path.relative(root,absolute);
    if (path.isAbsolute(value) && relative.startsWith('..'+path.sep) &&
        fs.statSync(absolute,{throwIfNoEntry:false})) return path.relative(root,fs.realpathSync(absolute));
    return relative;
  };
  const dependency = value => {
    const relative = reference(value), source = path.resolve(root,relative);
    if (isFile(source) && !inputs.has(relative)) inputs.set(relative,fileDigest(source));
  };
  const source = isFile(path.resolve(root,scene)) ? reference(scene) : scene;
  dependency(scene);
  dependency('ink-studio.config.js');
  const settings = Object.fromEntries(Object.entries(options).filter(([key])=>!omitted.has(key)).map(([key,value])=>{
    if (typeof value === 'string' && fileOptions.has(key) && isFile(path.resolve(root,value))) {
      dependency(value);
      return [key,reference(value)];
    }
    if (key === 'sprite-atlas' && typeof value === 'string' &&
        fs.statSync(path.resolve(root,value),{throwIfNoEntry:false})?.isDirectory()) {
      const manifest = path.join(value,'atlas.json');
      dependency(manifest);
      return [key,reference(manifest)];
    }
    return [key,key === 'dir' && typeof value === 'string' ? reference(value) || '.' : value];
  }));
  const frames = [];
  let retainedWeather, seed, profileOverrides, runtime;
  const render = {
    shotFrame: frame => frames.push(frame),
    shotWeather: {
      capture(binding) { retainedWeather ??= binding?.surfaceCheckpoint(); }
    }
  };
  function destination(output, suffixes = []) {
    requireValue(/\.(?:a?png)$/i.test(output),'A shot recipe needs a PNG or APNG render output');
    const writing = [file,output,...suffixes.map(suffix=>sidecar(output,suffix))];
    requireValue(new Set(writing).size === writing.length,'Use separate paths for the shot recipe and review outputs');
    requireValue(writing.every(target=>!inputs.has(reference(target))),'Use output paths separate from the shot inputs');
  }
  function finish(output,{fps,suffixes=[]}={}) {
    requireValue(frames.length > 0,'The shot recipe has no rendered frames');
    const outputFiles = Object.fromEntries(['',...suffixes].map(suffix=>[suffix,fileDigest(sidecar(output,suffix))]));
    const recipe = {format,version:1,mode,scene:source,options:settings,inputs:[...inputs].map(([file,sha256])=>({file,sha256})),seed,profileOverrides:profileOverrides??{},
      fps,frames,weather:retainedWeather,runtime,output:{name:path.basename(output),sha256:outputFiles[''],
        sidecars:Object.fromEntries(suffixes.map(suffix=>[suffix,outputFiles[suffix]]))}};
    atomicWrite(file,temp=>{
      recipe.project = path.relative(fs.realpathSync(path.dirname(temp)),root) || '.';
      fs.writeFileSync(temp,JSON.stringify(recipe,null,2)+'\n');
    });
    console.log('wrote shot recipe',file);
  }
  return {render,dependency,destination,finish,
    seed(value) {
      if (!Number.isFinite(value)) return;
      seed=value;
      if (mode !== 'sim render') settings.seed=String(value);
    },
    profiles: value => { profileOverrides=value; },
    runtime: value => { runtime=value; }
  };
}

const sidecar = (output,suffix) => suffix ? output.replace(/\.(?:a?png)$/i,'')+suffix : output;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
function load(filename) {
  const recipe = read(filename);
  requireValue(recipe?.format === format && recipe.version === 1 && commands.has(recipe.mode),'Unsupported shot recipe format or version');
  requireValue(typeof recipe.scene === 'string' && recipe.scene.length && !recipe.scene.startsWith('--') &&
    typeof recipe.project === 'string' && isObject(recipe.options) &&
    Object.entries(recipe.options).every(([key,value])=>/^[a-z][a-z\d-]*$/.test(key) &&
      !omitted.has(key) && (value === true || typeof value === 'string' && !value.startsWith('--'))),
  'Invalid shot recipe source or options');
  requireValue(Array.isArray(recipe.inputs) && recipe.inputs.every(input=>
    typeof input?.file === 'string' && digest(input.sha256)) && Array.isArray(recipe.frames) && recipe.frames.length > 0,
  'Invalid shot recipe inputs or frames');
  requireValue(typeof recipe.output?.name === 'string' && path.basename(recipe.output.name) === recipe.output.name &&
    /\.(?:a?png)$/i.test(recipe.output.name) && digest(recipe.output.sha256) && isObject(recipe.output.sidecars) &&
    Object.entries(recipe.output.sidecars).every(([suffix,value])=>validSidecar(suffix) && digest(value)),
  'Invalid shot recipe output');
  if (recipe.mode === 'sim render')
    requireValue(recipe.runtime?.format === 'ink-studio/run' && recipe.runtime.version === 1 &&
      Array.isArray(recipe.runtime.commands) && Number.isSafeInteger(recipe.runtime.end?.tick) &&
      recipe.runtime.origin?.format === 'ink-studio/checkpoint','Invalid shot simulation recording');
  return recipe;
}

const replayEnvironment = 'INK_STUDIO_SHOT_REPLAY';
function replay(filename,{out,root,entry}) {
  requireValue(typeof filename === 'string','Use shot replay <recipe.json> --out <image.png>');
  requireValue(typeof out === 'string' && /\.(?:a?png)$/i.test(out),'Shot replay needs --out <image.png>');
  requireValue(root === undefined || typeof root === 'string','--root needs a project directory');
  const file = path.resolve(filename), output = path.resolve(out), recipe = load(file);
  const project = root ? path.resolve(root) : path.resolve(fs.realpathSync(path.dirname(file)),recipe.project);
  const protectedPaths = new Set([file]);
  for (const input of recipe.inputs) {
    const source = path.resolve(project,input.file);
    requireValue(isFile(source) && fileDigest(source) === input.sha256,'Shot input is missing or changed: '+input.file);
    protectedPaths.add(source);
  }
  const suffixes = Object.keys(recipe.output.sidecars);
  requireValue(['',...suffixes].every(suffix=>!protectedPaths.has(sidecar(output,suffix))),
    'Use a replay output path separate from the recipe and its inputs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-shot-'));
  try {
    const staged = path.join(directory,recipe.output.name);
    const state = path.join(directory,'recipe.json');
    fs.writeFileSync(state,JSON.stringify(recipe));
    const flags = Object.entries(recipe.options).flatMap(([key,value])=>value===true?['--'+key]:['--'+key,value]);
    const worker = spawnSync(process.execPath,[entry,...commands.get(recipe.mode),recipe.scene,...flags,'--out',staged],
      {cwd:project,env:{...process.env,[replayEnvironment]:state},stdio:'inherit'});
    if (worker.error) throw worker.error;
    requireValue(worker.status === 0,'Shot replay render failed');
    const outputs = {'':recipe.output.sha256,...recipe.output.sidecars};
    for (const [suffix,sha256] of Object.entries(outputs))
      requireValue(isFile(sidecar(staged,suffix)) && fileDigest(sidecar(staged,suffix)) === sha256,
        'Shot replay diverged from the saved '+(suffix || 'image')+' hash');
    for (const suffix of Object.keys(outputs)) atomicWrite(sidecar(output,suffix),temp=>{
      const source = sidecar(staged,suffix);
      if (suffix !== '-passes.json' || path.basename(output) === recipe.output.name)
        return fs.copyFileSync(source,temp);
      const manifest = read(source);
      manifest.files = Object.fromEntries(Object.keys(manifest.files).map(channel=>
        [channel,path.basename(sidecar(output,'-'+channel+'.png'))]));
      fs.writeFileSync(temp,JSON.stringify(manifest,null,2)+'\n');
    });
    console.log('verified shot replay',output,recipe.output.sha256);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

function replayState(mode) {
  const file = process.env[replayEnvironment];
  if (!file) return;
  const recipe = load(file);
  requireValue(mode === recipe.mode,'Shot replay mode does not match the recipe');
  let frame = 0, weather = recipe.weather;
  return {
    runtime: recipe.runtime,
    render: {
      shotFrame(actual) {
        requireValue(isDeepStrictEqual(JSON.parse(JSON.stringify(actual)),recipe.frames[frame]),'Shot camera or art resolution diverged at frame '+frame);
        frame++;
      },
      shotWeather: {
        restore(binding) {
          if (!binding || !weather) return;
          binding.restoreSurface(weather);
          weather = undefined;
        }
      }
    },
    verify() {
      requireValue(frame === recipe.frames.length,'Shot frame count diverged');
      requireValue(weather === undefined,'Shot retained weather checkpoint was not applied');
    }
  };
}
module.exports = { modeFor, createRecorder, replay, replayState };
