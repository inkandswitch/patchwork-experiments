const Palette = require('./look-palette.js');
const PixelLook = require('../src/pixel-look.js');

function reviewRampShot(world, options = {}) {
  const { role, pixels, stops, positions, direction, maxDeviation, maxGap, reversalTolerance, ...view } = options;
  const { KIT } = require('../index.js').load();
  if ((role === undefined) === (stops === undefined) ||
      role !== undefined && (typeof role !== 'string' || !role.trim() || role.startsWith('#')))
    throw new TypeError('A ramp shot needs a named scene role or explicit stops');
  const roleSlots = role === undefined ? null : PixelLook.paletteSelector(world.pal,world.paletteRoles ?? {})(role);
  const definition = {
    stops:roleSlots ? roleSlots.map(slot=>world.pal[slot]) : stops, positions,direction,maxDeviation,maxGap,reversalTolerance
  };
  const authored = KIT.palette.reviewRamp(definition);
  if (pixels !== undefined && (!Array.isArray(pixels) || pixels.length !== authored.stops.length ||
      !Array.from(pixels).every(point=>point===null || Array.isArray(point) && point.length===2 &&
        Array.from(point).every(n=>Number.isSafeInteger(n) && n>=0))))
    throw new TypeError('Supply one [x, y] export pixel or null per ramp stop');

  const time = view.time ?? view.t ?? world.lookSnapshot?.time ?? 0;
  const frame = require('./render.js').render(world,{...view,t:time,samples:false,captureCoverage:false,
    captureScenePalette:!pixels});
  const { w:width,h:height } = frame;
  let method, samples;
  if (pixels) {
    method='export-pixels';
    samples=pixels.map(point=>{
      if (point===null) return {pixel:null,color:null};
      const [x,y]=point;
      if (x>=width || y>=height) throw new RangeError('Ramp probe is outside the ' + width + '×' + height + ' export grid');
      const p=y*width+x, offset=p*3;
      const color=frame.alpha?.[p]===0 ? null : Palette.hex(
        frame.rgb[offset]*65536+frame.rgb[offset+1]*256+frame.rgb[offset+2]);
      return {pixel:point.slice(),color};
    });
  } else {
    const sceneSlots = frame.scenePalette;
    method=sceneSlots ? 'scene-palette' : 'unavailable';
    samples=authored.stops.map(({index,color})=>{
      const source=parseInt(color.slice(1),16);
      const first=world.pal.indexOf(source);
      const slot=roleSlots?.[index] ?? (first>=0 && first===world.pal.lastIndexOf(source) ? first : null);
      return {slot,color:slot!==null && sceneSlots ? Palette.hex(sceneSlots[slot]) : null};
    });
  }

  const counts=new Map(samples.flatMap(({color})=>color===null ? [] : [[parseInt(color.slice(1),16),0]]));
  if (counts.size) for (let p=0;p<width*height;p++) {
    if (frame.alpha?.[p]===0) continue;
    const i=p*3, color=frame.rgb[i]*65536+frame.rgb[i+1]*256+frame.rgb[i+2];
    if (counts.has(color)) counts.set(color,counts.get(color)+1);
  }
  const report=KIT.palette.reviewRamp({...definition,resolved:samples.map(({color})=>color)});
  return { ...report, shot:{scene:world.id ?? null,time,width,height,pixelSize:frame.px, ...(role!==undefined && {role}), method,
    samples:samples.map(sample=>({...sample,visiblePixels:sample.color===null ? null : counts.get(parseInt(sample.color.slice(1),16))}))} };
}

module.exports = { reviewRampShot };
