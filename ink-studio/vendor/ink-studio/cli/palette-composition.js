const PixelLook = require('../src/pixel-look.js');
const ArtStability = require('../src/art-stability.js');

const pack = rgb => rgb.reduce((n,value)=>n*256+Math.round(value*255),0);

function capture(w,h,palettes,policies,scene,grade,{diagnostic,lit}) {
  const slots = new Uint32Array(w*h);
  const samples = lit && new Float32Array(w*h*3);
  const bottomOf = p => (h-1-Math.floor(p/w))*w+p%w;
  const packed = palettes.map(row=>row.map(pack));
  function claim(pixel,slot,color) {
    slots[pixel] = slot;
    if (samples && color) for (let c=0;c<3;c++) samples[pixel*3+c] = color[c+1];
  }

  function view(frame,passes,{mask,maskedSlots,outlined,stable,time,base,resolved,composited}) {
    const ids = diagnostic && new Uint32Array(w*h);
    const rows = [null], lookup = new Map(), stages = new WeakMap();
    function row(id,make) {
      if (!lookup.has(id)) {
        lookup.set(id,rows.length);
        rows.push(make());
      }
      return lookup.get(id);
    }
    function selected(p,bottom) {
      if (outlined?.[bottom]) return 0;
      if (mask?.weights[p] > .5) return maskedSlots[bottom];
      return resolved?.[bottom] ?? slots[bottom];
    }
    function material(p,bottom) {
      const slot = selected(p,bottom);
      if (!slot) return undefined;
      const policy = policies?.[slot-1], swatches = palettes[slot-1];
      if (policy && policy.scope !== 'surface' && !policy.select) return undefined;
      const q = p*3, current = Array.from(frame.rgb.subarray(q,q+3),value=>value/255);
      return {slot,policy,swatches,reserved:policy?.reservedIndex(current) !== undefined};
    }
    function idAt(p) { return passes.materialId?.[p] ?? 0; }
    function nameAt(p) { return passes.materials?.[idAt(p)] ?? null; }
    function describe(p,slot) {
      const policy = policies?.[slot-1];
      if (!slot && composited) return {domain:'composite',colors:[]};
      const domain = policy?.scope === 'surface' || slot && !policy ? 'material' : policy?.select ? 'target' : 'scene';
      return {domain, material:domain === 'scene' ? null : nameAt(p),
        ...(policy?.select && {select:policy.select}), ...(policy?.assetId && {asset:policy.assetId}),
        colors:slot ? packed[slot-1] : base};
    }
    if (ids) for (let p=0;p<ids.length;p++) {
      if (frame.alpha?.[p] === 0) continue;
      const slot = selected(p,bottomOf(p));
      const policy = policies?.[slot-1];
      const name = slot && (policy?.select || policy?.scope === 'surface' || !policy) ? idAt(p) : 0;
      ids[p] = row(slot+'/'+name,()=>describe(p,slot));
    }
    function pick({policy,swatches},rgb,x,y,p,trace) {
      let slot;
      if (!policy) slot = PixelLook.nearest(rgb,swatches,false);
      else {
        const [dx,dy] = ArtStability.ditherCoordinates(stable,passes,p,x,y,policy.anchor);
        slot = PixelLook.paletteIndex(policy,rgb,dx,dy,{
          scene,grade,useDither:true,trace,
          placement: policy.tuning && ArtStability.placement(stable,passes,p,x,y,time)
        });
      }
      if (trace) trace.slot = slot;
      return swatches[slot];
    }
    function mark(p,{kind,ramp,local,winner}) {
      if (!ids) return;
      const key = kind+'/'+(local?.slot ?? 0)+'/'+winner+'/'+(local ? idAt(p) : 0);
      ids[p] = row(key,()=>{
        const previous = local && describe(p,local.slot);
        return { ...(previous ? {...previous,baseDomain:previous.domain} : {colors:[]}),
          domain:local ? 'combined' : 'effect',effect:kind,winner,sharedColors:ramp.packed };
      });
    }
    function stage(p,rule) {
      if (!ids) return;
      if (!stages.has(rule)) stages.set(rule,rows.length);
      const key = 'stage/'+stages.get(rule)+'/'+idAt(p);
      ids[p] = row(key,()=>({domain:'stage',stage:rule.name,material: nameAt(p),
        ...(rule.select && {select:rule.select}),colors:rule.palette.packed}));
    }
    function finish() {
      if (ids) Object.assign(passes,{paletteOwner:ids,paletteOwners:rows});
    }
    return {material,pick,mark,stage,finish,lit:samples,outlined};
  }
  return {claim,view};
}

function lighting(passes, bottom, p, {live, sun, contact, probes, probeReceiver, cloudShadow, cloudsReceive}) {
  const i = (passes.splatId?.[p] ?? 0)-1;
  if (i < 0) return;
  const q = p*3, point = passes.position.subarray(q,q+3), normal = passes.normal.subarray(q,q+3);
  if (!(normal[0] || normal[1] || normal[2])) return;
  let shadow = 0, bounce = 0;
  if (live?.normal(i)) {
    if (sun.intensity > 0) shadow = 1-live.visibility(i,...point);
    const indirect = live.indirectAt(i,...point);
    if (indirect) bounce = Math.max(...indirect);
  } else {
    if (cloudShadow && cloudsReceive(i)) shadow = 1-cloudShadow(...point);
    const local = probeReceiver(i) && probes.sample(point,normal);
    if (local) bounce = Math.max(...local.rgb)*local.mix;
  }
  const receiver = contact?.at(i);
  if (receiver) shadow = Math.max(shadow,1-contact.sample(receiver,bottom,Array.from(point),Array.from(normal)));
  return {shadow,bounce};
}

module.exports = {capture,lighting};
