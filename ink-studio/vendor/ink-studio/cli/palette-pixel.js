const hex = color => '#' + color.toString(16).padStart(6, '0');
const pack = rgb => Array.from(rgb, n => Math.round(Math.max(0,Math.min(1,n))*255))
  .reduce((color, byte) => color*256 + byte, 0);
const colorAt = (rgb, pixel) => hex(rgb[pixel*3]*65536 + rgb[pixel*3+1]*256 + rgb[pixel*3+2]);

function choice(list, { colors, ...rule }, input, index, detail, weight = 1) {
  const { matchInput, dither, method = 'nearest', blended } = detail ?? {};
  list.push({ rule:{ ...rule, colors:Array.from(colors,hex) }, inputColor:hex(pack(input)),
    inputRgb:Array.from(input), ...(matchInput && { matchColor:hex(pack(matchInput)) }),
    index, swatch:hex(colors[index]), method, weight, ...(blended && {blended:true}), dither:dither ?
      { ...dither, ...(dither.pair && {pair:dither.pair.map(hex)}) } : null });
}

function policyChoice(list, policy, rgb, slot, detail, weight, rule = {}) {
  choice(list, { domain:policy?.select ? 'target' : policy?.scope === 'surface' || !policy ? 'material' : 'scene',
    stage:'resolve', colors:policy?.packed, select:policy?.select, source:policy?.source, match:policy?.match,
    asset:policy?.assetId, stack:policy?.stackName, ...rule }, rgb, slot, detail, weight);
}

function create(at, w, h) {
  const [x,y] = at;
  if (x >= w || y >= h) throw new RangeError('Palette pixel is outside the '+w+' x '+h+' art grid');
  const pixel = y*w+x, bottom = (h-1-y)*w+x, steps = [], mask = [];
  const stage = list => (rule,rgb,index,detail,weight) => {
    policyChoice(list,rule.palette,rgb,index,detail,weight,
      {domain:'stage',stage:rule.name,select:rule.select ?? undefined,asset:rule.assetId,order:rule.order,
        scope:rule.scope,source:'stage-input'});
  };
  const trace = { pixel,bottom,steps,mask,fragment:[],stage:stage(steps),forStage:stage,
    local(local,id,rgb,detail) {
      const policy = local.constraints?.[id-1], slot = detail.slot;
      const colors = policy?.packed ?? local.palettes[id-1].map(pack);
      policyChoice(steps,policy,rgb,slot,detail,1,{colors});
    },
    scene(rgb,colors,index,method,detail={}) {
      choice(steps,{domain:'scene',stage:'resolve',colors},rgb,index,{method,...detail});
    },
    ink(colors,index,rgb,effect,weight) {
      choice(steps,{domain:'ink',stage:'ink',effect,colors},rgb.map(n=>n/255),index,{blended:weight<1},weight);
    },
    effect(kind,ramp,local,winner,input,index,trace,weight) {
      if (winner === 'material') {
        policyChoice(steps,local.policy,input,trace.slot,trace,weight,
          {stage:'effect',effect:kind,colors:local.policy?.packed ?? local.swatches.map(pack)});
      } else choice(steps,{domain:'effect',stage:'effect',effect:kind,colors:ramp.packed},
        input,index,trace,weight);
    },
    finish(frame, passes) {
      const objectId = passes.objectId?.[pixel] ?? 0, materialId = passes.materialId?.[pixel] ?? 0;
      const alpha = frame.alpha?.[pixel] ?? 255, outputColor = colorAt(frame.rgb,pixel);
      const decisions = alpha ? [...trace.fragment,...steps] : [];
      const winner = decisions.findLast(step=>!step.blended || step.weight > .5) ?? decisions.at(-1) ?? null;
      return { x,y,width:w,height:h,pixelSize:frame.px,
        object:passes.objects?.[objectId] ?? null,material:passes.materials?.[materialId] ?? null,
        objectId,materialId,splatId:passes.splatId?.[pixel] || null,alpha,outputColor,
        winner, outputMatchesSwatch:winner ? winner.swatch === outputColor : null, decisions };
    }
  };
  return trace;
}

function inspectPalettePixel(world, { at, ...view } = {}) {
  if (!Array.isArray(at) || at.length !== 2 || !Array.from(at).every(n=>Number.isSafeInteger(n) && n>=0))
    throw new TypeError('Palette pixel needs [x, y] in nonnegative art pixels');
  if (view.raw) throw new RangeError('Palette pixel inspection needs a palette-enabled render');
  const time = view.time ?? view.t ?? world.lookSnapshot?.time ?? 0;
  if (!Number.isFinite(time)) throw new RangeError('Palette pixel inspection time must be finite');
  const result = require('./render.js').render(world,{ ...view,t:time,palettePixel:at,
    samples:false,captureCoverage:false,cameraGuides:false,inspection:false,renderGraph:false,
    passes:['objectId','materialId','splatId'] });
  return { scene:world.id ?? null,time,...result.palettePixel };
}

module.exports = { create,choice,policyChoice,inspectPalettePixel };
