/* One advected cloud coverage grid, sampled in world space for sky and shadows. */
const CloudField = (() => {
  const brand = Symbol.for('ink-studio.cloud-field');
  const namedFields = new Map();
  const recipes = typeof CloudRecipes === 'undefined' ? require('./cloud-recipes.js') : CloudRecipes;
  const shapes = typeof GeometryDensity === 'undefined' ? require('./geometry-density.js') : GeometryDensity;
  const volume = typeof VolumeField === 'undefined' ? require('./volume-field.js') : VolumeField;
  const art = typeof ArtDirection === 'undefined' ? require('./art-direction.js') : ArtDirection;
  const detail = typeof CloudDetail === 'undefined' ? require('./cloud-detail.js') : CloudDetail;
  const palettes = typeof AtmospherePalette === 'undefined' ? require('./atmosphere-palette.js') : AtmospherePalette;
  const clamp = n => Math.max(0,Math.min(1,n));
  const smooth = (lo,hi,n) => {
    const u = clamp((n-lo)/(hi-lo));
    return u*u*(3-2*u);
  };
  // Antiderivative of smoothstep. Integrating across a march segment keeps the cloud top from stepping between slices.
  const integral = (lo,hi,n) => {
    if (n<=lo) return 0;
    if (n>=hi) return n-(lo+hi)*.5;
    const u=(n-lo)/(hi-lo);
    return (hi-lo)*u*u*u*(1-u*.5);
  };
  const topOf = coverage => .25+.75*coverage*(1.28-.28*coverage);
  const wrap = (value, size) => ((value % size) + size) % size;
  const mix = (a, b, t) => a + (b - a) * t;
  const record = (value, name) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(name + ' needs an object');
    return value;
  };
  const vector = (value, size, name) => {
    if (!Array.isArray(value) || value.length !== size || !Array.from(value).every(Number.isFinite))
      throw new TypeError(name + ' needs ' + size + ' finite numbers');
    return value.slice();
  };
  const number = (value, lo, hi, name) => {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(name + ' is out of range');
    return value;
  };
  function shadowSettings(authored, override, profile = {}) {
    const enabled = override ?? authored;
    if (enabled === false || enabled === undefined) return null;
    const settings = value => value === true || value === false || value === undefined ? {} : record(value, 'Cloud shadows');
    const merged = { ...settings(authored), ...settings(override ?? undefined) };
    if (Object.keys(merged).some(key => !['strength', 'softness', 'direction'].includes(key)))
      throw new TypeError('Cloud shadows need strength, softness or direction settings');
    const { strength = profile.cloudShadowStrength ?? .72, softness = profile.cloudShadowSoftness ?? .7, direction } = merged;
    number(strength, 0, 1, 'Cloud shadow strength');
    number(softness, 0, 1000, 'Cloud shadow softness');
    if (direction !== undefined) {
      const length = Math.hypot(...vector(direction, 3, 'Cloud light direction'));
      if (!length || !Number.isFinite(length)) throw new RangeError('Cloud light direction must be nonzero');
    }
    return strength ? { strength, softness, direction } : null;
  }

  const colorRGB = (color, label) => {
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError(label + ' needs #rrggbb');
    return [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255);
  };
  function prepareLight(lighting) {
    if (!lighting) return null;
    const value = record(lighting,'Cloud lighting');
    if (Object.keys(value).some(key=>!['color','ambient','strength','rim','direction'].includes(key)))
      throw new RangeError('Unknown cloud lighting setting');
    const { color='#fff4dd', ambient=.26, strength=.66, rim=.24, direction } = value;
    const rgb = colorRGB(color,'Cloud light color');
    for (const [name,n] of Object.entries({ ambient,strength,rim })) number(n,0,1,'Cloud light ' + name);
    const sun = direction === undefined ? null : vector(direction,3,'Cloud lighting direction');
    if (sun && (!Math.hypot(...sun) || !Number.isFinite(Math.hypot(...sun))))
      throw new RangeError('Cloud lighting direction must be nonzero');
    return { rgb, ambient, strength, rim, sun };
  }
  function clip(range, origin, direction, low, high) {
    if (Math.abs(direction)<1e-10) return origin>=low && origin<=high;
    const a=(low-origin)/direction, b=(high-origin)/direction;
    range[0]=Math.max(range[0],Math.min(a,b));
    range[1]=Math.min(range[1],Math.max(a,b));
    return range[1]>range[0];
  }
  function compile(value) {
    if (value?.[brand] === true) return value;
    if (typeof value === 'string') {
      if (!namedFields.has(value)) namedFields.set(value,compile({ recipe:value }));
      return namedFields.get(value);
    }
    const source = record(value,'Cloud field');
    const isRecipe = source.recipe !== undefined, lod=source.lod;
    const geometry=source.field!==undefined ? shapes.resolve(source.field) : null;
    let settings=source, geometricDensity;
    if (geometry) {
      if (['recipe','coverage','bounds','height','thickness'].some(key=>source[key]!==undefined) || source.repeat)
        throw new TypeError('A shaped cloud derives its bounds, height and coverage from its nonrepeating field');
      const { min,max }=geometry.bounds;
      const { density=.48,bakeTime=0,densityResolution }=source;
      number(density,0,64,'Shaped cloud density');
      if (!Number.isFinite(bakeTime)) throw new RangeError('Shaped cloud bake time must be finite');
      const depth=max[1]-min[1];
      const snapshot=volume.sparse(volume.bounded({ bounds:geometry.bounds,sample:geometry.sample.bind(geometry) }),{ resolution:densityResolution,time:bakeTime });
      geometricDensity=(x,y,z) => snapshot.sample(x,y,z)*density;
      settings={ ...source, steps:source.steps??32, bounds:{ min:[min[0],min[2]], max:[max[0],max[2]] },
        height:min[1]+depth*.5, thickness:depth,
        coverage(x,z) {
          const length=depth/32;
          let optical=0;
          for (let i=0;i<32;i++) optical+=geometricDensity(x,min[1]+(i+.5)*length,z)*length;
          return -Math.expm1(-optical);
        }
      };
    } else if (isRecipe) settings=recipes.resolve(source);
    const { bounds, resolution = [48,48], coverage, velocity = [0,0], height = 8,
      color = '#d9e0ed', opacity = .85, repeat = false, visible = true, thickness=0,
      steps=12, lighting } = settings;
    const [minX,minZ] = vector(bounds?.min, 2, 'Cloud field minimum');
    const [maxX,maxZ] = vector(bounds?.max, 2, 'Cloud field maximum');
    const [width, rows] = vector(resolution, 2, 'Cloud resolution');
    const [vx,vz] = vector(velocity, 2, 'Cloud velocity');
    if (!(maxX > minX && maxZ > minZ) || !Number.isFinite((maxX-minX)+(maxZ-minZ)))
      throw new RangeError('Cloud bounds must have finite positive extent');
    if (![width,rows].every(n => Number.isInteger(n) && n >= 2 && n <= 256))
      throw new RangeError('Cloud resolution must be 2–256 samples per axis');
    number(height, -1e6, 1e6, 'Cloud height');
    number(opacity, 0, 1, 'Cloud opacity');
    if (typeof repeat !== 'boolean' || typeof visible !== 'boolean') throw new TypeError('Cloud repeat and visible must be boolean');
    const rgb = colorRGB(color,'Cloud color');
    const style = prepareLight(lighting);
    const paletteProgram = palettes.compile(source.paletteField, palettes.cloudDomains);
    number(thickness,0,1e5,'Cloud thickness');
    if (!Number.isInteger(steps) || steps<2 || steps>32) throw new RangeError('Cloud steps must be 2–32');
    const low=height-thickness*.5, high=height+thickness*.5;
    const horizon=4*Math.hypot(maxX-minX,maxZ-minZ)+thickness;
    const sx = (maxX-minX)/width, sz = (maxZ-minZ)/rows;
    const cells = new Float32Array(width*rows);
    const generate = typeof coverage === 'function';
    if (!generate && (!(Array.isArray(coverage) || ArrayBuffer.isView(coverage)) || coverage.length !== cells.length))
      throw new TypeError('Cloud coverage needs a row-major grid matching its resolution or a sample function');
    for (let z=0;z<rows;z++) for (let x=0;x<width;x++) {
      const i=z*width+x;
      cells[i]=number(generate ? coverage(minX+(x+.5)*sx,minZ+(z+.5)*sz) : coverage[i],0,1,'Cloud coverage');
    }
    function cell(data, x, z) {
      if (repeat) return data[wrap(z, rows)*width+wrap(x,width)];
      return x >= 0 && x < width && z >= 0 && z < rows ? data[z*width+x] : 0;
    }
    function sampleAt(data,x,z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
      const u=(x-minX)/sx-.5, v=(z-minZ)/sz-.5;
      if (!Number.isFinite(u) || !Number.isFinite(v)) return 0;
      const i=Math.floor(u), j=Math.floor(v);
      return mix(mix(cell(data,i,j),cell(data,i+1,j),u-i),
        mix(cell(data,i,j+1),cell(data,i+1,j+1),u-i),v-j);
    }
    function createDetail() {
      if (!thickness || repeat) throw new RangeError('Cloud representations need a bounded, nonrepeating field with positive thickness');
      return detail.compile({
        min:[minX,low,minZ], max:[maxX,high,maxZ], steps:Math.max(24,steps),
        density:geometricDensity ?? ((x,y,z) => {
          const cover=sampleAt(cells,x,z), top=topOf(cover), h=(y-low)/thickness;
          return cover*4.8/thickness*(smooth(0,.12,h)-smooth(top-.12,top,h));
        })
      },lod&&lod!==true ? lod : {});
    }
    let asset = lod || geometry ? createDetail() : null;
    function pass(data, sigma, across) {
      if (sigma < .2) return data;
      const dimension = across ? width : rows;
      const extent = Math.min(dimension, Math.ceil(3*sigma));
      const weights = Array.from({length:2*extent+1}, (_,i) => Math.exp(-.5*((i-extent)/sigma)**2));
      const total = weights.reduce((sum,n)=>sum+n,0);
      const result = new Float32Array(data.length);
      for (let z=0;z<rows;z++) for (let x=0;x<width;x++) {
        let sum=0;
        for (let d=-extent;d<=extent;d++)
          sum+=weights[d+extent]*cell(data,across?x+d:x,across?z:z+d);
        result[z*width+x]=sum/total;
      }
      return result;
    }
    const cache = new Map();
    function softened(softness) {
      if (!softness) return cells;
      if (!cache.has(softness)) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(softness, pass(pass(cells,softness/sx,true),softness/sz,false));
      }
      return cache.get(softness);
    }
    function frame(time, shadows, light = [-.52, .64, .57], displacement, representation, flashAt, cutouts, edge) {
      const paletteField = paletteProgram?.frame?.(time) ?? paletteProgram;
      const mode=representation ?? (lod || (geometry && lod!==false) ? 'auto' : 'off');
      if (!detail.modes.includes(mode)) throw new RangeError('Unknown cloud representation: ' + mode);
      const useDetail=mode!=='off';
      if (useDetail && !asset) asset=createDetail();
      if (!Number.isFinite(time)) throw new RangeError('Cloud time is out of range');
      const offset = vector(displacement ?? [0,0],2,'Cloud displacement');
      const drift = !displacement || isRecipe || geometry;
      const [dx,dz] = vector([offset[0]+(drift?vx*time:0),offset[1]+(drift?vz*time:0)],2,'Cloud displacement');
      const sample = (data,x,z) => sampleAt(data,x-dx,z-dz);
      let shadow = null;
      if (shadows) {
        const [lx,ly,lz] = shadows.direction ?? light;
        if (ly > 1e-5) {
          const map = softened(shadows.softness);
          const slopeX=lx/ly, slopeZ=lz/ly;
          shadow = (x,y,z) => {
            if (y>=height) return 1;
            const px=x+(height-y)*slopeX,pz=z+(height-y)*slopeZ;
            const blockage=shadows.strength*sample(map,px,pz);
            if (!blockage || !cutouts) return 1-blockage;
            if (!thickness) return 1-blockage*cutouts.gain(px,height,pz);
            const from=Math.max(y,low);
            const origin=[x,y,z], direction=[slopeX,1,slopeZ];
            const cutRay=cutouts.ray(origin,direction,from-y,high-y);
            const gain=cutRay ? cutRay.distance(from-y,high-y)/(high-from) : 1;
            return 1-blockage*gain;
          };
        }
      }
      const sun = style ? style.sun ?? light : [0,0,0];
      const length = Math.hypot(...sun) || 1;
      const [lx,ly,lz] = sun.map(value=>value/length);
      const daylight = smooth(-.13,.28,ly);
      const probe = 1.7*Math.max(sx,sz);
      const lit = (x,z,y,density,rim) => {
        const upstream = sample(cells,x+lx*probe,z+lz*probe);
        const relief = clamp(.52 + 1.45*(density-upstream));
        return clamp(style.ambient + daylight*(style.strength*(.24+.76*relief)*(.48+.52*y) + style.rim*rim));
      };
      const rendered=visible && opacity>0;
      const shift=[dx,0,dz], tint = [0,0,0];
      function cloudColor(out, height, density, light, flash) {
        const base = paletteField ? paletteField.apply(paletteField.source === 'altitude' ? height :
          paletteField.source === 'density' ? density : light, rgb, out) : rgb;
        for (let c=0;c<3;c++) out[c] = Math.min(1,(style ? mix(base[c],style.rgb[c],light) : base[c]) + (flash?.[c] ?? 0));
      }
      const shade=(origin,ray,depth,optical,out) => {
        const x=origin[0]+ray[0]*depth, y=origin[1]+ray[1]*depth, z=origin[2]+ray[2]*depth;
        const rim=style ? Math.max(0,lx*ray[0]+ly*ray[1]+lz*ray[2])**12 : 0;
        const density = style || paletteField?.source === 'density' ? sample(cells,x,z) : 0;
        const brightness=style ? lit(x,z,clamp((y-low)/thickness),density,rim)*(.49+.51*Math.exp(-optical*.58)) : 0;
        cloudColor(out, y, density, brightness, flashAt?.(x,y,z));
      };
      function shapedView(source) {
        if (!edge) return source;
        return { ...source, trace(origin, ray, start, stop, out, counters) {
          const sample = source.trace(origin,ray,start,stop,out,counters), amount = 1-sample[3];
          if (amount > 0) art.remapOpacity(sample,a=>opacity*edge(Math.min(1,a/opacity)));
          return sample;
        } };
      }
      const view=useDetail && rendered ? (eye,parallel) => {
        const result = shapedView(asset.view(eye,parallel,mode,shift,shade,opacity,cutouts));
        if (!result.card) return result;
        const lighting = style && { ...style, direction:[lx,ly,lz], daylight, probe, cells, width, rows,
          origin:[minX+dx,minZ+dz], cell:[sx,sz], low, thickness };
        return { ...result, card:{ ...result.card, rgb, lighting, paletteField } };
      } : null;
      const reflections=(useDetail || geometry) && rendered ? shapedView(asset.view([0,0,0],null,'volume',shift,shade,opacity,cutouts)) : null;
      const reflectionSample=[0,0,0,1];
      function paintVolume(origin, ray, out, flashAt, signal, counters) {
        const range = [0,horizon];
        if (!clip(range,origin[1],ray[1],low,high) || (!repeat &&
            (!clip(range,origin[0],ray[0],minX+dx,maxX+dx) || !clip(range,origin[2],ray[2],minZ+dz,maxZ+dz)))) return out;
        const cutRay=cutouts?.ray(origin,ray,...range);
        const step = (range[1]-range[0])/steps;
        if (!(step>0)) return out;
        const rim = style ? Math.max(0,lx*ray[0]+ly*ray[1]+lz*ray[2])**12 : 0;
        const half = Math.abs(ray[1])*step/(2*thickness);
        const lightSum = [0,0,0];
        let through = 1;
        for (let i=0; i<steps && through>.005; i++) {
          const t=range[0]+(i+.5)*step;
          const x=origin[0]+t*ray[0], y=origin[1]+t*ray[1], z=origin[2]+t*ray[2];
          if (counters) counters.cloudSamples++;
          const density=sample(cells,x,z);
          if (density<=0) continue;
          const h=(y-low)/thickness, top=topOf(density), cap=top-.12;
          const body = half>1e-6
            ? (integral(0,.12,h+half)-integral(0,.12,h-half)
              -integral(cap,top,h+half)+integral(cap,top,h-half))/(2*half)
            : smooth(0,.12,h)-smooth(cap,top,h);
          if (body<=0) continue;
          const near=range[0]+i*step;
          const occupied=cutRay?.distance(near,near+step)??step;
          const weight=through*-Math.expm1(-4.8*density*body*occupied/thickness);
          const brightness=style ? lit(x,z,h,density,rim) : 0;
          const flash=flashAt?.(x,y,z);
          cloudColor(tint, y, density, brightness, flash);
          for (let c=0;c<3;c++) lightSum[c] += weight * tint[c];
          through-=weight;
        }
        const a=1-through, amount=opacity*(edge ? edge(a) : a);
        const gain=edge && a>0 ? amount/a : opacity;
        if (signal) signal[0] = amount;
        for (let c=0;c<3;c++) out[c]=out[c]*(1-amount)+gain*lightSum[c];
        return out;
      }
      function paint(origin, direction, out, light, signal, counters) {
        if (signal) signal[0] = 0;
        if (!rendered) return out;
        if (reflections) {
          reflections.trace(origin,direction,0,Infinity,reflectionSample,counters);
          if (signal) signal[0] = 1-reflectionSample[3];
          for (let c=0;c<3;c++) out[c]=reflectionSample[c]+out[c]*reflectionSample[3];
          return out;
        }
        if (counters) counters.cloudTraces++;
        if (thickness>0) return paintVolume(origin,direction,out,light,signal,counters);
        if (Math.abs(direction[1]) < 1e-8) return out;
        const distance=(height-origin[1])/direction[1];
        if (distance <= 0) return out;
        const x = origin[0] + distance * direction[0], z = origin[2] + distance * direction[2];
        if (counters) counters.cloudSamples++;
        const coverage = sample(cells,x,z), amount = opacity*(edge ? edge(coverage) : coverage)*(cutouts?.gain(x,height,z)??1);
        if (!(amount>0)) return out;
        if (signal) signal[0] = amount;
        const flash = light?.(x,height,z);
        const rim = style ? Math.max(0,lx*direction[0]+ly*direction[1]+lz*direction[2])**12 : 0;
        const brightness = style ? lit(x,z,.5,coverage,rim) : 0;
        cloudColor(tint, height, coverage, brightness, flash);
        for (let i=0;i<3;i++) out[i] = mix(out[i],tint[i],amount);
        return out;
      }
      return { visible: rendered, coverage:(x,z)=>sample(cells,x,z), paint, shadow, view };
    }
    return Object.freeze({ [brand]:true, frame });
  }

  return Object.freeze({ compile, shadowSettings, recipes:recipes.names,
    recipe:(name, options={}) => compile({ ...options, recipe:name }),
    asset:(source, lod={}) => compile({ ...(typeof source==='string' ? { recipe:source } : record(source,'Cloud asset')), lod }),
    representations:detail.modes,
    dim: visibility => .35 + .65 * visibility });
})();
if (typeof module !== 'undefined') module.exports = CloudField;
