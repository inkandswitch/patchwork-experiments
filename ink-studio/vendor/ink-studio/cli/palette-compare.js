const PixelLook = require('../src/pixel-look.js');
const FrameComposite = require('../src/frame-composite.js');
const Palette = require('./look-palette.js');
const { render } = require('./render.js');
const { measureQuantizationError } = require('./palette-error.js');

function preparePalettes(definitions, blueNoise) {
  if (!Array.isArray(definitions) || definitions.length < 2 || definitions.length > 12)
    throw new RangeError('A shot comparison needs 2 to 12 palette alternatives');
  const ids = new Set();
  return Array.from(definitions, definition => {
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype)
      throw new TypeError('Each alternative needs an ID and palette settings');
    const { id, palette, dither, ...policy } = definition;
    if (typeof id !== 'string' || !/^[a-z\d][a-z\d_-]{0,31}$/i.test(id) || ids.has(id.toLowerCase()))
      throw new TypeError('Use distinct palette IDs of 1 to 32 letters, numbers, dashes or underscores');
    ids.add(id.toLowerCase());
    if (Object.keys(policy).some(key => key !== 'match' && key !== 'reserved'))
      throw new TypeError('Palette alternatives accept id, palette, match, reserved and dither');
    if (!Array.isArray(palette) || !palette.length || palette.length > 48)
      throw new RangeError('Each palette alternative needs 1 to 48 swatches');
    if ((dither?.space !== undefined && dither.space !== 'screen') || dither?.regions !== undefined)
      throw new TypeError('Shot comparison dither uses the shared screen grid');
    const { entries } = Palette.colors(palette);
    const plan = PixelLook.preparePalette({ ...policy, dither, palette:entries.map(Palette.hex) },
      { palette:entries, blueNoise });
    return { id, plan };
  });
}

function resolve(reference, plan) {
  const { w, h, alpha, rgb:graded } = reference;
  const rgb = new Uint8Array(graded.length), counts = new Uint32Array(plan.packed.length), color = [0,0,0];
  let pixels = 0;
  for (let p = 0; p < w*h; p++) {
    if (alpha?.[p] === 0) continue;
    const q = p*3, x = p%w, y = Math.floor(p/w);
    for (let k = 0; k < 3; k++) color[k] = graded[q+k]/255;
    const slot = plan.index(color, x, y), packed = plan.packed[slot];
    rgb[q] = packed >> 16;
    rgb[q+1] = (packed >> 8) & 255;
    rgb[q+2] = packed & 255;
    counts[slot]++;
    pixels++;
  }
  return { image:{w,h,rgb,alpha}, usage:{
    pixels, transparentPixels:w*h-pixels,
    swatches:plan.packed.map((color,i)=>({swatch:Palette.hex(color),pixels:counts[i],share:pixels ? counts[i]/pixels : 0}))
  } };
}

function contactSheet(kit, reference, alternatives, report, columns) {
  const { w, h } = reference;
  const col = Math.max(216,w)+14, row = 2*h+120;
  const cols = Math.min(columns, alternatives.length+1), rows = Math.ceil((alternatives.length+1)/cols);
  const width = cols*col+14, height = rows*row+58;
  const layers = [], draw = [], dim = '#a9b9cc';
  function text(value,x,y,size,color = '#eff4fb') {
    draw.push({type:'text',text:value,at:[x,y],size,color});
  }
  function rect(x,y,w,h,color) {
    draw.push({type:'rect',rect:[x,y,w,h],color});
  }
  text('Matched shot palette comparison',width/2,20,cols === 1 ? 12 : 17);
  text(w+' x '+h+' art pixels   |   '+report.time.toFixed(3)+' s',width/2,42,10,dim);
  for (let i = 0; i <= alternatives.length; i++) {
    const x = 7+col*(i%cols+.5), y = 62+Math.floor(i/cols)*row, left = Math.floor(x-w/2);
    const alternative = alternatives[i-1];
    if (!alternative) {
      text('Shared reference',x,y+6,12);
      layers.push({source:reference,rect:[left,y+22,w,h]});
      text(report.referenceStage === 'legacy' ? 'Legacy resolve input' : 'Before palette resolution',x,y+h+34,9,dim);
      const legend = report.legend, top = y+h+63;
      text('OKLab distance',x,top,11);
      legend.forEach(({swatch,error},j)=>{
        const center = x+(j-2)*42;
        rect(center-20,top+18,40,14,swatch);
        text(error.toFixed(2),center,top+43,9,dim);
      });
      continue;
    }
    const {id, image, heatmap} = alternative;
    const { usage, error } = report.alternatives[i-1], swatches = usage.swatches;
    text(id,x,y+6,Math.min(12,Math.floor((col-14)/id.length)));
    layers.push({source:image,rect:[left,y+22,w,h]}, {source:heatmap,rect:[left,y+h+70,w,h]});
    const chip = Math.min(18,Math.floor(184/swatches.length));
    swatches.forEach(({swatch},j)=>rect(x-chip*swatches.length/2+j*chip,y+h+30,chip-1,10,swatch));
    text(swatches.filter(s=>s.pixels>0).length+' of '+swatches.length+' swatches used',x,y+h+53,9,dim);
    text('Mean error '+error.meanError.toFixed(3),x,y+2*h+86,9,dim);
    text(error.highErrorPixels+' high-error pixels',x,y+2*h+103,9,dim);
  }
  const plan = kit.frameComposite.prepare({layers:[...layers,{draw}]},width,height,1);
  return FrameComposite.compose({w:1,h:1,rgb:Uint8Array.of(18,25,37)},
    kit.frameComposite.layers(plan,{},0),width,height,'nearest');
}

function compareShotPalettes(world,{palettes,threshold,heatmapMax,regionLimit,columns=3,...view} = {}) {
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > 6)
    throw new RangeError('Shot comparison needs 1 to 6 sheet columns');
  if (view.raw) throw new RangeError('Shot comparison needs a palette-enabled render');
  const time = view.time ?? view.t ?? world.lookSnapshot?.time ?? 0;
  if (!Number.isFinite(time)) throw new RangeError('Shot comparison time must be finite');
  const { KIT } = require('../index.js').load();
  const plans = preparePalettes(palettes, KIT.procedural.materials.blueNoise);
  let sample;
  const { quantization, passes } = render(world, { ...view, time, t:time, captureQuantization:true,
    samples:false,captureCoverage:false,cameraGuides:false,inspection:false,renderGraph:false,composite:false,
    passes:['materialId'],shotFrame(info) { sample = info; view.shotFrame?.(info); } });
  const { w, h, alpha, px, graded, stage } = quantization;
  const reference = { w,h,alpha,rgb:graded };
  const report = { version:1,scene:world.id ?? null,seed:world.seed ?? null,time,width:w,height:h,pixelSize:px,
    sample,simulation:world.lookSnapshot?.tick !== undefined ?
      { tick:world.lookSnapshot.tick,time:world.lookSnapshot.time } :
      Number.isFinite(world.clock) ? {time:world.clock} : null,
    referenceStage:stage,alternatives:[] };
  const alternatives = plans.map(({id,plan})=>{
    const { image, usage } = resolve(reference,plan);
    const { heatmap, report:error } = measureQuantizationError({ ...quantization,resolved:image.rgb },
      { passes,threshold,heatmapMax,regionLimit });
    report.alternatives.push({id,match:plan.match,usage,error});
    return {id,image,heatmap};
  });
  report.legend = report.alternatives[0].error.legend;
  return {reference,alternatives,report,image:contactSheet(KIT,reference,alternatives,report,columns)};
}

module.exports = { compareShotPalettes };
