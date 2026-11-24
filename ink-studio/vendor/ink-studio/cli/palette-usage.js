const Palette = require('./look-palette.js');
const EffectPalettes = require('../src/effect-palettes.js');
const TargetSelectors = require('../src/target-selectors.js');
const SurfaceLook = require('../src/surface-look.js');

const subjectFields = [['object','objectId','objects'],['material','materialId','materials']];
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const triplet = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
const pack = rgb => rgb.reduce((color,n)=>color*256+Math.round(n*255),0);

function selection(value = {}) {
  if (!record(value) || Object.keys(value).some(key=>!['object','material','region','effect'].includes(key)))
    throw new TypeError('Palette usage selects an object, material, region or effect');
  const { object, material, region, effect } = value;
  for (const [key,label] of [['object',object],['material',material]])
    if (label !== undefined) TargetSelectors.prepare({[key]:label});
  if (effect !== undefined && !EffectPalettes.kinds.includes(effect))
    throw new RangeError('Palette effect must be one of ' + EffectPalettes.kinds.join(', '));
  if (Array.isArray(region)) {
    if (region.length !== 4 || !Array.from(region).every(Number.isSafeInteger) || region[2] < 1 || region[3] < 1 ||
        !Number.isSafeInteger(region[0]+region[2]) || !Number.isSafeInteger(region[1]+region[3]))
      throw new RangeError('Palette region needs [x, y, width, height] in art pixels');
    return { ...value, region: region.slice() };
  }
  if (region !== undefined) {
    if (!record(region) || Object.keys(region).some(key=>key!=='min' && key!=='max') ||
        !triplet(region.min) || !triplet(region.max) || region.min.some((n,i)=>n>=region.max[i]))
      throw new RangeError('World palette region needs finite min and max XYZ bounds');
    return { ...value, region:{min:region.min.slice(),max:region.max.slice()} };
  }
  return { ...value };
}

function matchesLabels(select, table, read) {
  return subjectFields.every(([key,channel,names]) => select[key] === undefined ||
    table[names]?.[read(channel,key)] === select[key]);
}

/* Compile the inventory from the same sampled palette rules used for the frame. */
function inventory(world, select, { surface, paletteRules, targetSlots, stages, optics, effects }) {
  const declared = new Set(), baseSlots = new Set();
  const subject = select.object !== undefined || select.material !== undefined;
  const effect = select.effect !== undefined && effects?.ramps.get(select.effect);
  const full = !subject && !select.region && select.effect === undefined;
  const add = colors => { for (const color of colors ?? []) declared.add(color); };
  const addSurface = slot => {
    for (const row of surface?.paletteSlots?.[slot-1] ?? []) add(surface.palettes[row-1].map(pack));
  };
  if (full) {
    for (const colors of surface?.palettes ?? []) add(colors.map(pack));
    for (const policy of paletteRules?.palettes ?? []) add(policy.packed);
    add(stages?.palettes);
    add(optics?.palettes);
    for (const rule of effects?.ramps.values() ?? []) add(rule.packed);
  } else if (effect) add(effect.packed);

  let usesBase = full;
  if (subject && (select.effect === undefined || effect?.combine)) {
    const metadata = world.renderMetadata ?? {};
    const surfaces = new Set(), policies = new Set(), stageGroups = new Set(), ramps = new Set();
    for (let i=0; i<world.count; i++) {
      if (!matchesLabels(select,metadata,(channel)=>metadata[channel+'s']?.[i])) continue;
      const slot = world.surfaceData?.[i*SurfaceLook.STRIDE] ?? 0;
      const policy = targetSlots?.[i] || paletteRules?.defaultSlot || 0;
      const stageGroup = stages?.at(i);
      if (!surfaces.has(slot)) { surfaces.add(slot); addSurface(slot); }
      if (policy && !policies.has(policy)) { policies.add(policy); add(paletteRules.palettes[policy-1].packed); }
      if (stageGroup && !stageGroups.has(stageGroup)) {
        stageGroups.add(stageGroup);
        for (const rules of Object.values(stageGroup)) for (const rule of rules) add(rule.palette?.packed);
      }
      if (!surface?.paletteSlots?.[slot-1]?.length && !policy && !stageGroup?.palette?.length) {
        const ramp = world.ramps?.[(world.pix?.[i*8] ?? 0)-1];
        if (!ramp) usesBase = true;
        else if (!ramps.has(ramp)) {
          ramps.add(ramp);
          for (const index of ramp) baseSlots.add(index);
        }
      }
    }
  }
  return { declared, baseSlots, usesBase, full };
}

function pixelLookup(frame,passes) {
  if (frame.w === passes.w && frame.h === passes.h) return (x,y)=>y*passes.w+x;
  const columns = Uint32Array.from({length:frame.w},(_,x)=>Math.floor((x+.5)*passes.w/frame.w));
  const rows = Uint32Array.from({length:frame.h},(_,y)=>Math.floor((y+.5)*passes.h/frame.h)*passes.w);
  return (x,y)=>rows[y]+columns[x];
}

function scan(frame,select,rarePixels,rareShare) {
  const {w,h,rgb,alpha,passes,paletteInventory} = frame;
  const indexAt = pixelLookup(frame,passes);
  const colors = new Map(), seenOwners = new Set();
  const declared = new Set(paletteInventory.colors);
  const subject = select.object !== undefined || select.material !== undefined;
  let pixels = 0, excludedTransparentPixels = 0;
  const {region} = select, worldBox = region && !Array.isArray(region) ? region : null;
  const [left,top,width,height] = Array.isArray(region) ? region : [0,0,w,h];
  const add = swatches=> { for (const color of swatches ?? []) declared.add(color); };
  for (let y=Math.max(0,top); y<Math.min(h,top+height); y++) for (let x=Math.max(0,left); x<Math.min(w,left+width); x++) {
    const source = indexAt(x,y);
    if (subject && !matchesLabels(select,passes,channel=>passes[channel]?.[source])) continue;
    if (worldBox && (!passes.splatId[source] || worldBox.min.some((n,k)=>{
      const coordinate = passes.position[source*3+k];
      return !(coordinate >= n && coordinate <= worldBox.max[k]);
    }))) continue;
    const ownerId = passes.paletteOwner[source], owner = passes.paletteOwners[ownerId];
    if (select.effect !== undefined && owner?.effect !== select.effect) continue;
    const pixel = y*w+x;
    if (alpha?.[pixel] === 0) { excludedTransparentPixels++; continue; }
    if (!seenOwners.has(ownerId)) {
      seenOwners.add(ownerId);
      if ((!owner || owner.domain === 'composite') && !subject) add(paletteInventory.base);
      // A scoped authored ramp can narrow the scene fallback.
      else if (owner?.domain !== 'scene' || !subject) add(owner?.colors);
      add(owner?.sharedColors);
    }
    const offset = pixel*3, color = (rgb[offset]<<16)|(rgb[offset+1]<<8)|rgb[offset+2];
    colors.set(color,(colors.get(color) ?? 0)+1);
    pixels++;
  }
  let otherPixels = 0;
  const unused = [], rare = [];
  const keys = [...new Set([...declared,...colors.keys()])].sort((a,b)=>(colors.get(b) ?? 0)-(colors.get(a) ?? 0) || a-b);
  const swatches = keys.map(color=>{
    const count = colors.get(color) ?? 0, share = pixels ? count/pixels : 0, swatch = Palette.hex(color);
    const listed = declared.has(color);
    const status = !listed ? 'undeclared' : count === 0 ? 'unused' : count<=rarePixels || share<=rareShare ? 'rare' : 'used';
    if (!listed) otherPixels += count;
    if (status === 'unused') unused.push(swatch);
    if (status === 'rare') rare.push(swatch);
    return { swatch, pixels:count, share, declared:listed, status };
  });
  return {pixels,excludedTransparentPixels,otherPixels,swatches,unused,rare};
}

function paletteUsage(world,{select,rarePixels=3,rareShare=.001,...view}={}) {
  select = selection(select);
  if (!Number.isSafeInteger(rarePixels) || rarePixels < 0 || !Number.isFinite(rareShare) || rareShare < 0 || rareShare > 1)
    throw new RangeError('Palette rarity needs a nonnegative pixel count and a share in [0, 1]');
  const channels = ['paletteOwner', ...subjectFields.filter(([key])=>select[key]!==undefined).map(([,channel])=>channel)];
  if (select.region && !Array.isArray(select.region)) channels.push('position','splatId');
  const time = view.time ?? view.t ?? world.lookSnapshot?.time ?? 0;
  const frame = require('./render.js').render(world,{...view,t:time,samples:false,captureCoverage:false,
    passes:channels,paletteUsageSelection:select});
  return { scene:world.id ?? null,time,width:frame.w,height:frame.h,pixelSize:frame.px,select,
    thresholds:{rarePixels,rareShare}, ...scan(frame,select,rarePixels,rareShare) };
}

module.exports = { paletteUsage, inventory };
