/* Scoped core appearance, shaped light spill, and native art-pixel halos. */
const EmissiveFinishes = (() => {
  let targets, area;
  try { targets = TargetSelectors; area = AreaLights; }
  catch { targets = require('./target-selectors.js'); area = require('./area-lights.js'); }
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const vector = values => Array.isArray(values) && values.length === 3 && Array.from(values).every(Number.isFinite);
  const clamp = value => Math.max(0, Math.min(1, value));
  const unscoped = 255;
  function value(n, low, high, name, integer = false) {
    if (!Number.isFinite(n) || n < low || n > high || integer && !Number.isSafeInteger(n))
      throw new RangeError(name + ' must be in [' + low + ', ' + high + ']');
    return n;
  }
  function color(raw, palette) {
    if (vector(raw) && raw.every(n => n >= 0 && n <= 1)) return raw.slice();
    const hex = typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? parseInt(raw.slice(1), 16) :
      Number.isSafeInteger(raw) ? palette[raw] : undefined;
    if (!Number.isInteger(hex)) throw new TypeError('Emissive colors need a palette index, #rrggbb or normalized RGB');
    return [hex >> 16, hex >> 8 & 255, hex & 255].map(n => n / 255);
  }

  function halo(raw, palette, fallback) {
    if (!fields(raw, ['color', 'strength', 'radius', 'falloff', 'threshold', 'depthBias', 'small']))
      throw new TypeError('Invalid emissive glow settings');
    const { radius = 3, strength = .55, falloff = 1.35, threshold = .24, depthBias = .06, small = {} } = raw;
    if (small !== false && !fields(small, ['belowPixels', 'radius', 'strength']))
      throw new TypeError('Small emissive glow needs belowPixels, radius, or strength');
    return {
      color: raw.color === undefined ? fallback : color(raw.color, palette),
      radius: value(radius,1,8,'Glow radius',true),
      strength: value(strength,0,1,'Glow strength'),
      falloff: value(falloff,.25,8,'Glow falloff'),
      threshold: value(threshold,.02,1,'Glow source coverage'),
      depthBias: value(depthBias,0,100,'Glow depth bias'),
      small: small && {
        belowPixels: value(small.belowPixels ?? 96,1,8192,'Small glow threshold',true),
        radius: value(small.radius ?? 1,1,8,'Small glow radius',true),
        strength: value(small.strength ?? strength * .68,0,1,'Small glow strength')
      }
    };
  }

  function prepare(definition, palette = []) {
    if (definition === undefined || definition === false) return [];
    if (!Array.isArray(definition) || definition.length > 16) throw new TypeError('Use up to 16 emissive finishes in a list');
    const ids = new Set();
    return Array.from(definition, profile => {
      if (!fields(profile, ['id', 'select', 'core', 'spill', 'glow']) || !targets.name(profile.id) || ids.has(profile.id))
        throw new TypeError('Emissive finishes need unique IDs and named target selectors');
      const { id, select, core, spill, glow } = profile;
      ids.add(id);
      const result = { id, select: targets.prepare(select) };
      if (core !== undefined && core !== false) {
        if (!fields(core, ['color','strength'])) throw new TypeError('Emissive core accepts color and strength');
        result.core = { strength:value(core.strength ?? 1,0,8,'Core strength'),
          ...(core.color !== undefined && { color:color(core.color,palette) }) };
      }
      if (spill !== undefined && spill !== false) {
        if (!record(spill) || spill.at !== undefined && spill.offset !== undefined)
          throw new TypeError('Emissive spill needs area light settings and either at or offset');
        const { at, offset = [0,0,0], ...settings } = spill;
        if (!vector(offset) || ['id','visible','reflection'].some(key => Object.hasOwn(settings,key)))
          throw new TypeError('Emissive spill needs an XYZ offset and supplies its own invisible light');
        const light = area.prepare([{ size:[.16,.16], twoSided:true, radius:2, sampleGrid:3,
          ...settings, id, at:at ?? [0,0,0], visible:false, reflection:false }])[0];
        result.spill = { ...light, follow:at === undefined, offset:offset.slice() };
      }
      if (glow !== undefined) result.glow = glow === false ? false :
        halo(glow, palette, result.core?.color ?? color('#ffbd77',palette));
      return result;
    });
  }

  function bind(profiles, world) {
    if (!profiles.length) return null;
    const { row } = targets.index(world), cache = new WeakMap();
    const slots = new Uint8Array(world.count);
    let any = false;
    for (let i=0; i<slots.length; i++) {
      if (!(Math.round(world.data[i*16+11]) & 32) || world.renderMetadata?.muteEmission?.[i]) continue;
      const target = row(i);
      if (!cache.has(target)) cache.set(target, profiles.findIndex(profile => targets.matches(profile.select,target)) + 1);
      slots[i] = cache.get(target);
      any ||= slots[i] !== 0;
    }
    return any ? { profiles, slots } : null;
  }

  function coreRgb(core, r, g, b) {
    if (core.color) {
      const level = Math.max(r, g, b) * core.strength;
      return core.color.map(value => clamp(value * level));
    }
    return [r,g,b].map(value => clamp(value * core.strength));
  }

  function spillLights(binding, { x, y, z, alpha }) {
    if (!binding?.profiles.some(profile=>profile.spill?.intensity)) return [];
    const { profiles, slots } = binding;
    const sums = profiles.map(() => [0,0,0,0]);
    for (let i=0; i<slots.length; i++) {
      const sum = sums[slots[i]-1], light = profiles[slots[i]-1]?.spill;
      if (!light?.intensity || !(alpha[i]>0) || y[i] < -30) continue;
      const amount = Math.min(1,alpha[i]);
      sum[0]+=x[i]*amount;
      sum[1]+=y[i]*amount;
      sum[2]+=z[i]*amount;
      sum[3]+=amount;
    }
    return profiles.flatMap(({spill}, i) => {
      const sum = sums[i], weight = sum[3];
      if (!spill?.intensity || !weight) return [];
      if (!spill.follow) return [spill];
      const at = spill.offset.map((offset,k)=>offset+sum[k]/weight);
      return [{ ...spill, at, points:spill.points.map(point=>point.map((n,k)=>n+at[k])) }];
    });
  }

  function applyGlow(frame, passes, profiles) {
    const scope = passes?.scopedEmission;
    if (!scope) return frame;
    const { w,h,rgb,alpha } = frame, { depth, emissionDepth } = passes;
    const scores = new Float32Array(w*h), slots = new Uint8Array(w*h);
    const halo = profiles.map(({glow}) => {
      if (!glow?.strength) return null;
      if (!glow.small || Math.min(w,h) >= glow.small.belowPixels) return glow;
      return { ...glow, radius:Math.min(glow.radius,glow.small.radius), strength:glow.small.strength };
    });
    for (let p=0; p<slots.length; p++) {
      const id=scope.slots[p], layer=halo[id-1], coverage=scope.coverage[p], z=emissionDepth[p];
      if (!layer?.strength || coverage<layer.threshold || !Number.isFinite(z)) continue;
      const x=p%w, y=Math.floor(p/w), radius=layer.radius;
      for (let dy=-radius; dy<=radius; dy++) for (let dx=-radius; dx<=radius; dx++) {
        const targetX=x+dx, targetY=y+dy, distance=Math.hypot(dx,dy);
        if (targetX<0 || targetX>=w || targetY<0 || targetY>=h || distance>radius+.35) continue;
        const target=targetY*w+targetX;
        if (scope.coverage[target]>.03 || depth[target]+layer.depthBias<z) continue;
        const score=coverage*layer.strength*(1-distance/(radius+1))**layer.falloff;
        if (score<=scores[target]) continue;
        slots[target]=id;
        scores[target]=score;
      }
    }
    for (let p=0; p<slots.length; p++) {
      if (!slots[p]) continue;
      const tint=halo[slots[p]-1].color, gain=scores[p], oldAlpha=alpha ? alpha[p]/255 : 1;
      const added=(1-oldAlpha)*gain, opacity=oldAlpha+added;
      for(let c=0;c<3;c++) {
        const at=p*3+c, original=rgb[at]/255;
        const screened=1-(1-original)*(1-tint[c]*gain);
        rgb[at]=Math.round((screened*oldAlpha+tint[c]*added)/opacity*255);
      }
      if(alpha) alpha[p]=Math.round(opacity*255);
    }
    return frame;
  }

  return Object.freeze({ prepare, bind, coreRgb, spillLights, applyGlow, unscoped });
})();
if (typeof module !== 'undefined') module.exports = EmissiveFinishes;
