const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { render, FOV } = require('./render.js');
const ArtEffects = require('../src/art-effects.js');
const AtlasSprites = require('../src/atlas-sprites.js');

const mapNames = ['depth', 'normal', 'emission', 'silhouette'];
const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
const integer = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;

function exportViews(world,{directions=8,yaw=world.cam.yaw,pitch=world.cam.pitch,pitches}={}) {
  const elevations = pitches === undefined ? [pitch ?? world.cam.pitch] : pitches;
  if (!integer(directions,1,64) || !Number.isFinite(yaw) || !Array.isArray(elevations) || !elevations.length ||
      elevations.length>12 || !Array.from(elevations).every(p=>Number.isFinite(p)&&(pitches===undefined||Math.abs(p)<=Math.PI*.5)))
    throw new RangeError('Invalid sprite export directions or pitches');
  return elevations.flatMap(pitch => Array.from({length:directions},(_,direction)=>({
    direction, yaw:yaw+direction*Math.PI*2/directions, pitch
  })));
}

function spriteAtlas(world, options = {}) {
  const {
    width = 96, height = 96, directions = 8, times = [0], fps = 12, columns = directions,
    pivot = world.cam.target, yaw = world.cam.yaw, maps = [], pose, view = {}, depthRange, sourceTimes, pitches
  } = options;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) ||
      !integer(columns, 1, 256) || !Number.isFinite(fps) || fps <= 0 || fps > 240 ||
      !Array.isArray(times) || !times.length || times.length > 512 ||
      times.some((time, i) => !Number.isFinite(time) || time < 0 || (i && time <= times[i - 1])) ||
      (sourceTimes !== undefined && (!Array.isArray(sourceTimes) || sourceTimes.length !== times.length ||
        Array.from(sourceTimes).some(time => !Number.isFinite(time) || time < 0) || typeof pose !== 'function')) ||
      !Array.isArray(pivot) || pivot.length !== 3 || !pivot.every(Number.isFinite) ||
      !Array.isArray(maps) || maps.some(map => !mapNames.includes(map)) ||
      (pose !== undefined && typeof pose !== 'function'))
    throw new RangeError('Invalid sprite atlas dimensions, timing, directions, pivot or maps');
  const requested = [...new Set(maps)];
  const passes = requested.filter(name => name !== 'silhouette');
  const angles=exportViews(world,{directions,yaw,pitch:view.pitch,pitches}), views=angles.length;
  const count = times.length * views, cols = Math.min(count, columns);
  const rows = Math.ceil(count / cols), w = width * cols, h = height * rows;
  if (w * h * (requested.length + 1) > 32e6) throw new RangeError('Sprite atlas exceeds its pixel budget');
  if (depthRange && (!Array.isArray(depthRange) || depthRange.length !== 2 ||
      !depthRange.every(Number.isFinite) || depthRange[0] >= depthRange[1]))
    throw new RangeError('Sprite depth range must be an increasing finite pair');

  const images = Object.fromEntries(['color', ...requested].map(name => [name, new Uint8Array(w * h * 4)]));
  const depths = requested.includes('depth') ? new Float32Array(w * h).fill(Infinity) : null;
  let minDepth = Infinity, maxDepth = -Infinity;
  const entries = [];
  const history = Array.from({ length: views }, () => ArtEffects.history({ frames: 24 }));
  const { volumeHistory } = require('../src/scene-optics.js');
  const volumes = view.volumeQuality?.jitter === 'spatiotemporal' || world.volumeQuality?.jitter === 'spatiotemporal'
    ? Array.from({ length: views }, () => volumeHistory()) : [];
  for (let f = 0; f < times.length; f++) {
    const time = times[f], sourceTime = sourceTimes?.[f] ?? time;
    if (pose) pose(world, sourceTime);
    else world.anim?.update?.(f ? time - times[f - 1] : 0, time);
    const duration = f + 1 < times.length ? times[f + 1] - time : 1 / fps;
    for (let angle=0;angle<views;angle++) {
      const {direction,yaw,pitch}=angles[angle];
      const i = f * views + angle, ox = i % cols * width, oy = Math.floor(i / cols) * height;
      const image = render(world, { ...view, t: sourceTime, w: width, h: height, px: 1,
        yaw, pitch, ortho: true, target: pivot,
        transparent: true, passes, artHistory: history[angle], volumeHistory: volumes[angle] });
      const data = image.passes;
      let pixels = 0, left = width, top = height, right = -1, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = y * width + x, q = (y + oy) * w + x + ox, j = p * 3, k = q * 4;
        const alpha = image.alpha[p];
        if (alpha) {
          images.color[k] = image.rgb[j];
          images.color[k + 1] = image.rgb[j + 1];
          images.color[k + 2] = image.rgb[j + 2];
        }
        images.color[k + 3] = alpha;
        if (images.silhouette && alpha >= 128) {
          images.silhouette.fill(255, k, k + 4);
          pixels++;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
        if (depths && Number.isFinite(data.depth[p])) {
          minDepth = Math.min(minDepth, data.depth[p]);
          maxDepth = Math.max(maxDepth, data.depth[p]);
          depths[q] = data.depth[p];
        }
        if (images.normal && (data.normal[j] || data.normal[j + 1] || data.normal[j + 2])) {
          for (let c = 0; c < 3; c++) images.normal[k + c] = byte(.5 + data.normal[j + c] * .5);
          images.normal[k + 3] = 255;
        }
        if (images.emission) {
          for (let c = 0; c < 3; c++) images.emission[k + c] = byte(data.emission[j + c]);
          images.emission[k + 3] = Math.max(images.emission[k], images.emission[k + 1], images.emission[k + 2]);
        }
      }
      const distance=(view.dist||world.cam.dist/(view.zoom||1))/(world.anim?.zoom||1);
      const entry = { frame: f, direction, yaw, pitch,
        unitsPerPixel:2*distance*Math.tan(FOV/2)/((view.lensScale??1)*height),
        depthOrigin:distance+2*world.radius+4, time, duration, ...(sourceTimes && { sourceTime }),
        rect: { x: ox, y: oy, width, height }, pivot: { x: width / 2, y: height / 2 } };
      if (images.silhouette) entry.silhouette = { pixels, bounds: pixels ? [left, top, right, bottom] : null,
        touchesBorder: left === 0 || top === 0 || right === width - 1 || bottom === height - 1 };
      entries.push(entry);
    }
  }
  const range = depths && (depthRange || (Number.isFinite(minDepth) ? [minDepth, maxDepth] : null));
  if (range) {
    const [near, far] = range;
    for (let p = 0; p < depths.length; p++) if (Number.isFinite(depths[p])) {
      const z = Math.round(0xffffff * Math.max(0, Math.min(1, (depths[p] - near) / (far - near || 1))));
      const q = p * 4;
      images.depth[q] = z >> 16;
      images.depth[q + 1] = (z >> 8) & 255;
      images.depth[q + 2] = z & 255;
      images.depth[q + 3] = 255;
    }
  }
  const metadata = { width: w, height: h, tileWidth: width, tileHeight: height, directions, fps, ...(pitches && { pitches:pitches.slice() }),
    pivot: pivot.slice(), frames: entries, normalSpace:'asset', emissionMode:'baked',
    encodings: {
      color: 'straight RGBA',
      ...(images.silhouette && { silhouette: 'binary RGBA coverage at alpha >= 128' }),
      ...(images.depth && { depth: { range, encoding: 'camera-axis distance as RGB24, alpha marks a surface' } }),
      ...(images.normal && { normal: 'world XYZ mapped from [-1,1] to RGB, alpha marks a normal' }),
      ...(images.emission && { emission: 'visible premultiplied emissive RGB, alpha is max RGB' })
    } };
  return { images, metadata };
}

function writeAtlas(directory, { images, metadata }) {
  fs.mkdirSync(directory, { recursive: true });
  const files = {};
  for (const [name, rgba] of Object.entries(images)) {
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), PNG.encode(metadata.width, metadata.height, rgba, 4));
    files[name] = file;
  }
  fs.writeFileSync(path.join(directory, 'atlas.json'), JSON.stringify({ ...metadata, files }, null, 2) + '\n');
}

function readRgba(file, width, height) {
  const {w,h,data,max}=PNG.raster(file);
  if (w!==width||h!==height) throw new RangeError('Sprite PNG dimensions differ from its registered size: '+file);
  return Uint8Array.from(data,n=>Math.round(n*255/max));
}

function celSize(edit, definition, { frames = [], pitch = 0 }) {
  const frame=typeof edit.frame==='string'&&Object.hasOwn(definition.poses??{},edit.frame)
    ? definition.poses[edit.frame]:edit.frame;
  const views=frames.filter(entry=>(entry.frame??0)===frame &&
    (edit.direction===undefined||entry.direction===edit.direction) &&
    (edit.pitch===undefined||(entry.pitch??pitch)===edit.pitch));
  if (views.length!==1) throw new RangeError('Sprite cel replacement must uniquely identify one baked view');
  return views[0].rect;
}

function readCels(definition, dir, metadata) {
  if (typeof definition==='string') {
    const file=path.resolve(dir,definition);
    definition=JSON.parse(fs.readFileSync(file,'utf8'));
    dir=path.dirname(file);
  }
  if (!definition || typeof definition!=='object' || !Array.isArray(definition.replacements)) return definition;
  const replacements=definition.replacements.map(edit=>{
    if (!edit?.files || typeof edit.files!=='object' || Array.isArray(edit.files) || edit.images!==undefined)
      throw new TypeError('Sprite cel manifest replacements need PNG files');
    const { files, ...settings }=edit;
    const {width,height}=celSize(edit, definition, metadata);
    const images=Object.fromEntries(Object.entries(files).map(([name,file])=>{
      if (!['color','depth','normal','emission','effect'].includes(name)||typeof file!=='string')
        throw new TypeError('Unknown sprite cel PNG channel: '+name);
      return [name,readRgba(path.resolve(dir,file),width,height)];
    }));
    return {...settings,images};
  });
  return {...definition,replacements};
}

function readSpriteAtlas(file, { cels } = {}) {
  const manifest=fs.statSync(file).isDirectory()?path.join(file,'atlas.json'):file;
  const metadata=JSON.parse(fs.readFileSync(manifest,'utf8')), dir=path.dirname(manifest);
  if (typeof metadata.files?.color!=='string') throw new TypeError('Sprite atlas manifest needs a color PNG');
  const images={};
  for (const name of ['color','depth','normal','emission','silhouette']) {
    const asset=metadata.files[name];
    if (asset===undefined) continue;
    if (typeof asset!=='string') throw new TypeError('Sprite atlas '+name+' needs a PNG path');
    images[name]=readRgba(path.resolve(dir,asset),metadata.width,metadata.height);
  }
  if (cels===false) delete metadata.cels;
  else if (cels!==undefined || metadata.cels!==undefined)
    metadata.cels=readCels(cels??metadata.cels,dir,metadata);
  return AtlasSprites.compile({metadata,images});
}

function spriteAtlasManifest(source, emitImage) {
  const { metadata, images }=AtlasSprites.compile(source).snapshot();
  const save=(channels, width, height)=>Object.fromEntries(Object.entries(channels).map(([name, rgba])=>
    [name,emitImage(width,height,rgba)]));
  metadata.files=save(images,metadata.width,metadata.height);
  if (metadata.cels?.replacements) metadata.cels.replacements=metadata.cels.replacements.map(({images,...edit})=>{
    const {width,height}=celSize(edit,metadata.cels,metadata);
    return {...edit,files:save(images,width,height)};
  });
  return metadata;
}

function writeSpriteAtlas(source, { out } = {}) {
  if (typeof out !== 'string' || path.extname(out).toLowerCase() !== '.json') throw new TypeError('Choose a sprite atlas .json filename');
  const files=require('./asset-files.js'), file=path.resolve(out), directory=path.dirname(file);
  files.json(file,spriteAtlasManifest(source,(...image)=>files.image(directory,...image)));
  return { file };
}

module.exports = { spriteAtlas, writeAtlas, writeSpriteAtlas, readSpriteAtlas, exportViews, spriteAtlasManifest };
