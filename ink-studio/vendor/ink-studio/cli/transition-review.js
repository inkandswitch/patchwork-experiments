const { render, upscale } = require('./render.js');
const ArtEffects = require('../src/art-effects.js');
const { history: transparencyHistory } = require('../src/splat-order.js');
const { volumeHistory } = require('../src/scene-optics.js');

const defaults = Object.freeze({ pixelDelta:.12, popFraction:.18, lightingDelta:.065, paletteDelta:.055 });
const kinds = ['midnight', 'storm', 'cut', 'transition'];
const fields = ['yaw', 'pitch', 'dist', 'zoom', 'lensScale', 'target', 'ortho'];
const checks = [
  ['pop', 'changedFraction', 'popFraction'],
  ['lighting-jump', 'lumaShift', 'lightingDelta'],
  ['palette-change', 'paletteShift', 'paletteDelta']
];
const round = n => +n.toFixed(6);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const record = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(name + ' needs an object');
  return value;
};

function camera(value, id) {
  const source = record(value, id + ' camera');
  for (const [field, n] of Object.entries(source)) {
    const valid = field === 'target' ? Array.isArray(n) && n.length === 3 && Array.from(n).every(Number.isFinite)
      : field === 'ortho' ? typeof n === 'boolean'
        : Number.isFinite(n) && (!['dist', 'zoom', 'lensScale'].includes(field) || n > 0);
    if (!fields.includes(field) || !valid) throw new RangeError(id + ' has an invalid camera ' + field);
  }
  return source;
}

function prepare(plan, view, world) {
  const { events, fps = 12, neighbors = 2, preroll = 0, thresholds: supplied = {}, paletteMode = 'entries' } = record(plan, 'Transition review plan');
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240 || !integer(neighbors, 2, 6) || !integer(preroll, 0, 48))
    throw new RangeError('Transition review needs a frame rate up to 240, 2 to 6 frames per side, and up to 48 preroll frames');
  if (!Array.isArray(events) || !events.length || events.length > 24) throw new RangeError('Transition review needs 1 to 24 events');
  if (!['entries','visible'].includes(paletteMode)) throw new RangeError('Transition paletteMode must be entries or visible');
  const thresholds = { ...defaults };
  for (const [key, value] of Object.entries(record(supplied, 'Transition thresholds'))) {
    if (!Object.hasOwn(defaults, key) || !Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Invalid transition threshold ' + key);
    thresholds[key] = value;
  }
  if (view.skyTime !== undefined && !Number.isFinite(view.skyTime)) throw new RangeError('Sky time must be finite');
  const base = camera({ yaw:world.cam.yaw, pitch:world.cam.pitch, target:world.cam.target, lensScale:1, ortho:false,
    ...Object.fromEntries(fields.filter(key => view[key] !== undefined).map(key => [key, view[key]])) }, 'Base');
  function freeze(patch) {
    const { zoom, dist, ...rest } = patch;
    const distance = dist ?? world.cam.dist / (zoom ?? 1);
    if (!Number.isFinite(distance) || distance <= 0) throw new RangeError('Review camera distance must be positive');
    return { ...rest, dist:distance, target:rest.target.slice() };
  }
  const ids = new Set();
  const rows = Array.from(events, entry => {
    const { id, kind = 'transition', at, skyTime, skyRate, camera: outgoing = {}, incomingCamera } = record(entry, 'Transition event');
    if (typeof id !== 'string' || !id.trim() || id.length > 80 || ids.has(id)) throw new TypeError('Transition events need unique names');
    ids.add(id);
    if (!kinds.includes(kind)) throw new TypeError(id + ' needs a kind of ' + kinds.join(', '));
    if (!Number.isFinite(at) || at - neighbors / fps < 0 || !(at + 1 / fps > at) ||
        (skyTime !== undefined && !Number.isFinite(skyTime)) || (skyRate !== undefined && !Number.isFinite(skyRate)))
      throw new RangeError(id + ' needs finite timing and enough scene time before the event');
    if (kind !== 'cut' && incomingCamera !== undefined) throw new TypeError(id + ' needs kind cut to set an incoming camera');
    const from = { ...base, ...camera(outgoing, id) };
    return { id, kind, at, skyTime, skyRate, outgoing:freeze(from),
      ...(kind === 'cut' && { incoming:freeze({ ...from, ...camera(incomingCamera, id + ' incoming') }) }) };
  });
  return { rows, fps, neighbors, preroll, thresholds, paletteMode };
}

function delta(before, after, thresholds, paletteMode) {
  let changed = 0, lumaShift = 0, chromaShift = 0, replaced = 0, visibleReplacement = 0;
  const a = before.rgb, b = after.rgb, count = a.length / 3, limit = thresholds.pixelDelta * 255;
  const aColors = new Set(before.palette), bColors = new Set(after.palette);
  const removed = new Set([...aColors].filter(color => !bColors.has(color)));
  const added = new Set([...bColors].filter(color => !aColors.has(color)));
  const paletteChanged = removed.size || added.size;
  for (let j = 0; j < a.length; j += 3) {
    const r = b[j] - a[j], g = b[j + 1] - a[j + 1], blue = b[j + 2] - a[j + 2];
    const visible = Math.max(Math.abs(r), Math.abs(g), Math.abs(blue)) > limit;
    if (visible) changed++;
    lumaShift += .2126*r + .7152*g + .0722*blue;
    chromaShift += Math.max(Math.abs(r-g), Math.abs(blue-g));
    if (paletteChanged && (removed.has((a[j]<<16) | (a[j+1]<<8) | a[j+2]) ||
        added.has((b[j]<<16) | (b[j+1]<<8) | b[j+2]))) {
      replaced++;
      if (visible) visibleReplacement++;
    }
  }
  chromaShift /= 510*count;
  const paletteReplacement = replaced / count;
  return { changedFraction:changed / count, lumaShift:lumaShift / (255*count), chromaShift, paletteReplacement,
    paletteShift:Math.max(chromaShift,paletteMode === 'visible' ? visibleReplacement/count : paletteReplacement) };
}

function difference(before, after) {
  const { w, h } = before;
  const rgb = new Uint8Array(w*h*3);
  for (let p = 0; p < rgb.length; p += 3) {
    const d = Math.max(Math.abs(before.rgb[p] - after.rgb[p]), Math.abs(before.rgb[p+1] - after.rgb[p+1]),
      Math.abs(before.rgb[p+2] - after.rgb[p+2]));
    rgb[p] = 13 + Math.min(242, 3*d);
    rgb[p+1] = 18 + Math.min(220, d);
    rgb[p+2] = 27 + Math.min(70, d*.16);
  }
  return { w, h, rgb };
}

function evidence(from, to, thresholds, paletteMode, comparison, flag = true) {
  const measured = delta(from, to, thresholds, paletteMode);
  const flags = flag ? checks.flatMap(([kind, metric, threshold]) => Math.abs(measured[metric]) > thresholds[threshold]
    ? [{ kind, value:round(measured[metric]), threshold:thresholds[threshold] }] : []) : [];
  const score = Math.max(...checks.map(([, metric, threshold]) => Math.abs(measured[metric]) / Math.max(1e-9, thresholds[threshold])));
  const metrics = Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, round(value)]));
  return { from, to, score, result:{ comparison, metrics, flags } };
}

function stream(camera) {
  return { ...camera, artHistory:ArtEffects.history({ frames:24 }), volumeHistory:volumeHistory(),
    transparencyHistory:transparencyHistory(), afterimageHistory:require('../index.js').load().KIT.afterimages.history() };
}

function capture(world, settings, { rows, fps, neighbors, preroll }, pose) {
  const schedule = new Map();
  const sequences = rows.map(event => {
    const outgoing = stream(event.outgoing), incoming = event.incoming && stream(event.incoming);
    const playback = incoming && stream(event.incoming);
    const frames = [], matched = incoming && { outgoing:[], incoming:[] };
    for (let offset = -neighbors-preroll; offset < neighbors; offset++) {
      const t = event.at + offset/fps;
      if (t < 0) continue;
      const skyTime = event.skyTime !== undefined || event.skyRate !== undefined
        ? (event.skyTime ?? event.at) + offset/fps * (event.skyRate ?? 1) : settings.skyTime;
      if (skyTime !== undefined && !Number.isFinite(skyTime)) throw new RangeError(event.id + ' sky time is out of range');
      if (!schedule.has(t)) schedule.set(t, []);
      schedule.get(t).push(() => {
        const draw = shot => {
          const { w,h,rgb,palette } = render(world,{ ...settings,...shot,t,skyTime });
          return { w,h,rgb, palette:settings.raw ? undefined : Array.from(palette ?? world.pal) };
        };
        if (offset === 0 && incoming) {
          matched.outgoing.push(draw(outgoing));
          matched.incoming.push(draw(incoming));
          outgoing.artHistory.clear();
          incoming.artHistory.clear();
          outgoing.volumeHistory.clear();
          incoming.volumeHistory.clear();
          outgoing.transparencyHistory.reset();
          incoming.transparencyHistory.reset();
          outgoing.afterimageHistory.clear();
          incoming.afterimageHistory.clear();
        }
        const image = draw(incoming && offset >= 0 ? playback : outgoing);
        if (offset === -1 && incoming) {
          matched.outgoing.push(image);
          matched.incoming.push(draw(incoming));
        } else if (offset < -1 && incoming) draw(incoming);
        if (offset >= -neighbors) frames.push({ offset, time:t, skyTime:skyTime ?? t, image });
        if (offset === neighbors - 1) {
          const active = playback || outgoing;
          active.artHistory.clear();
          active.volumeHistory.clear();
          active.transparencyHistory.reset();
          active.afterimageHistory.clear();
        }
      });
    }
    return { event, frames, matched };
  });
  let previous;
  for (const [t, queue] of [...schedule].sort(([a], [b]) => a-b)) {
    if (pose) pose(world, t);
    else world.anim?.update?.(previous === undefined ? 0 : t-previous, t);
    previous = t;
    for (const draw of queue) draw();
  }
  return sequences;
}

function analyze(sequence, neighbors, thresholds, paletteMode) {
  const { event, frames, matched } = sequence;
  const steps = [];
  let screenEvidence;
  let cutEvidence;
  for (let i = 1; i < frames.length; i++) {
    const from = frames[i - 1], to = frames[i];
    const expectedCut = Boolean(event.incoming && to.offset === 0);
    const display = evidence(from.image,to.image,thresholds,paletteMode,'screen',!expectedCut);
    const step = { from:from.time, to:to.time, offset:to.offset, expectedCut, screen:display.result };
    const candidate = { ...display, offset:to.offset, expectedCut };
    if (!screenEvidence || candidate.score > screenEvidence.score ||
        (candidate.score === screenEvidence.score && Math.abs(candidate.offset) < Math.abs(screenEvidence.offset)))
      screenEvidence = candidate;
    if (expectedCut) {
      const locked = Object.entries(matched).map(([shot,[a,b]]) => evidence(a,b,thresholds,paletteMode,shot));
      step.matched = locked.map(pair => pair.result);
      cutEvidence = locked.reduce((a,b) => b.score > a.score ? b : a);
    }
    steps.push(step);
  }
  const flagCount = steps.reduce((sum, step) => sum + step.screen.flags.length +
    (step.matched?.reduce((total,pair) => total + pair.flags.length,0) ?? 0),0);
  const { id, kind, at, outgoing, incoming } = event;
  return { ...sequence, screenEvidence, cutEvidence, report:{
    id, kind, at, outgoing, ...(incoming && {incoming}), flagCount, steps,
    frames:frames.map(({ image, ...sample }) => sample),
    evidence:{ offset:screenEvidence.offset, ...(cutEvidence && { matched:cutEvidence.result.comparison }) },
    boundaryStep:neighbors-1
  } };
}

function drawText(sheet, atlas, x, y, text, maxWidth, color) {
  const { per, chars, font } = atlas;
  const count = Math.min(Math.floor(maxWidth / 6), text.length);
  for (let i = 0; i < count; i++) {
    const glyph = chars.indexOf(text[i]);
    if (glyph < 0) continue;
    const u = glyph % per * 6, v = Math.floor(glyph / per) * 8;
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 6; dx++)
      if (font.data[(v+dy)*font.w+u+dx]) sheet.rgb.set(color, ((y+dy)*sheet.w+x+i*6+dx)*3);
  }
}

const margin = 4, gap = 4, header = 18, caption = 12;
function sheetLayout(width, height, columns, rows) {
  return { w:2*margin + columns*width + (columns-1)*gap,
    h:2*margin + rows*(header+caption+height) + (rows-1)*gap };
}

function montage(results, width, height, columns, size) {
  const sheet = { ...size, rgb:new Uint8Array(size.w*size.h*3) };
  for (let p = 0; p < sheet.rgb.length; p += 3) sheet.rgb.set([19,25,36],p);
  const atlas = require('../index.js').load().KIT.ascii.atlas();
  let y = margin;
  function row(title, tiles, flagged) {
    drawText(sheet,atlas,margin,y+3,title,sheet.w-2*margin,flagged ? [255,202,143] : [221,231,247]);
    const placements = tiles.map(({ label, image }, i) => {
      const x = margin+i*(width+gap), top = y+header+caption;
      drawText(sheet,atlas,x,y+header,label,width,[167,185,210]);
      for (let line = 0; line < height; line++)
        sheet.rgb.set(image.rgb.subarray(line*width*3,(line+1)*width*3),((top+line)*sheet.w+x)*3);
      return { label, x, y:top, width, height };
    });
    y += height+header+caption+gap;
    return placements;
  }
  for (const result of results) {
    const { report, frames, matched, screenEvidence, cutEvidence } = result;
    const title = report.id + '  ' + report.at.toFixed(3) + 's  ' + (report.flagCount ? report.flagCount + ' flags' : 'clear');
    const map = screenEvidence.expectedCut ? 'Expected cut' : 'Delta to ' + screenEvidence.offset;
    report.tiles = row(title,[
      ...frames.map(({ offset, image }) => ({ label:offset === 0 ? '0 / event' : (offset > 0 ? '+' : '') + offset,
        image })),
      { label:map, image:difference(screenEvidence.from,screenEvidence.to) }
    ],report.flagCount > 0);
    if (cutEvidence) {
      const ordered = [...matched.outgoing,...matched.incoming];
      const labels = ['Out before','Out after','In before','In after'];
      report.matchedTiles = row(report.id + ' / matched camera',[
        ...ordered.map((image,i) => ({ label:labels[i], image })),
        { label:'Delta / ' + cutEvidence.result.comparison, image:difference(cutEvidence.from,cutEvidence.to) }
      ],cutEvidence.result.flags.length > 0);
    }
  }
  return sheet;
}

function transitionReview(world, { plan = world.transitionReview, width = 160, height = 90, scale = 1, view = {}, pose } = {}) {
  if (!integer(width,1,2048) || !integer(height,1,2048) || !integer(scale,1,8) || (pose !== undefined && typeof pose !== 'function'))
    throw new RangeError('Invalid transition review dimensions, scale, or pose callback');
  if (world.anim?.stateful && !pose) throw new TypeError('A stateful scene needs a pose callback for transition review');
  const prepared = prepare(plan,view,world);
  const { rows, fps, neighbors, preroll, thresholds, paletteMode } = prepared;
  const cuts = rows.filter(event => event.incoming).length;
  const columns = neighbors*2+1, size = sheetLayout(width,height,columns,rows.length+cuts);
  const samples = rows.length*(neighbors*2+preroll) + cuts*(neighbors+preroll+2);
  if (size.w*size.h*scale*scale > 24e6 || samples*width*height > 72e6)
    throw new RangeError('Transition review exceeds its render or sheet pixel budget');
  const settings = { ...view,w:width,h:height,px:1,lockCamera:true,transparent:false,passes:false,samples:false,captureCoverage:false };
  const results = capture(world,settings,prepared,pose).map(sequence => analyze(sequence,neighbors,thresholds,paletteMode));
  const sheet = montage(results,width,height,columns,size);
  const events = results.map(result => result.report);
  return { image:scale === 1 ? sheet : upscale(sheet,scale),
    report:{ width,height,scale,fps,neighbors,preroll,thresholds,paletteMode,sheet:size,
      flagCount:events.reduce((sum,event) => sum+event.flagCount,0),events } };
}

module.exports = { transitionReview };
