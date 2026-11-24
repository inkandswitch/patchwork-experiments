/* Geometry for bounded scalar and vector fields, independent of a renderer. */
(function (K) {
  const P = K.procedural, V = K.V, { freeze } = P.data;
  const finite = Number.isFinite, epsilon = 1e-9;
  const axes = {x:0,y:1,z:2}, componentsByName = {xy:[0,1],xz:[0,2],yz:[1,2]};
  const check = (ok,message) => { if (!ok) throw new TypeError('Field views: ' + message); };
  const vector = (p,size=3) => Array.isArray(p) && p.length === size && Array.from(p).every(finite);
  const limit = (n,min,max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const validBounds = bounds => vector(bounds?.min) && vector(bounds?.max) &&
    bounds.min.every((n,i) => n <= bounds.max[i] && finite(bounds.max[i]-n));
  const sources = new WeakSet();
  const inside = (bounds,point) => point.every((n,i) => n >= bounds.min[i] && n <= bounds.max[i]);

  function source({ type, sample, bounds, units = null, components = 'xz' } = {}) {
    const pair = Object.hasOwn(componentsByName,components) && componentsByName[components];
    check(['number','vec2','vec3'].includes(type) && (type !== 'vec2' || pair) && typeof sample === 'function' &&
      validBounds(bounds) && (units === null || typeof units === 'string' && units.trim().length),
      'expected a scalar or vector sampler, units and a finite XYZ box');
    const box = freeze({ min:bounds.min.slice(), max:bounds.max.slice() }), scalar = type === 'number';
    const roundoff = box.max.map((n,i) => Number.EPSILON*4*Math.max(Math.abs(n),Math.abs(box.min[i]),n-box.min[i]));
    const field = Object.freeze({ type:scalar ? type : 'vec3', units, bounds:box, sample(x,y,z) {
      const point = [x,y,z];
      check(point.every(finite),'sample coordinates must be finite');
      for (let axis=0;axis<3;axis++) {
        const n = point[axis], lo = box.min[axis], hi = box.max[axis];
        if (n < lo-roundoff[axis] || n > hi+roundoff[axis]) return null;
        point[axis] = Math.min(hi,Math.max(lo,n));
      }
      const value = sample(...point);
      if (value == null) return null;
      check(scalar ? finite(value) : vector(value,type === 'vec2' ? 2 : 3),'invalid field sample');
      if (type !== 'vec2') return scalar ? value : value.slice();
      const xyz = [0,0,0];
      xyz[pair[0]] = value[0];
      xyz[pair[1]] = value[1];
      return xyz;
    } });
    sources.add(field);
    return field;
  }

  function fromQuery(query,name,{ bounds, fallbackBounds, args } = {}) {
    const info = query?.field?.(name), spatial = info?.spatial;
    check(spatial && ['number','vec2','vec3'].includes(info.type),'unknown or non-numeric spatial field ' + name);
    const native = spatial.space === 'world' && spatial.axes === 'xyz' ? spatial.bounds : null;
    const box = bounds ?? native ?? fallbackBounds;
    return source({ type:info.type, units:info.units, bounds:box, components:spatial.components,
      sample:query.sampler(name,{args}) });
  }

  function requireType(field,type) {
    check(sources.has(field) && field.type === type,'expected a ' + (type === 'number' ? 'scalar' : 'vector') + ' field source');
  }

  function magnitude(field) {
    requireType(field,'vec3');
    return source({ ...field, type:'number', sample(x,y,z) {
      const value = field.sample(x,y,z);
      return value && V.len(value);
    } });
  }

  function frameFor(bounds,plane = {axis:'y'}) {
    if (plane && Object.hasOwn(axes,plane.axis)) {
      const fixed = axes[plane.axis], varying = [0,1,2].filter(i => i !== fixed);
      const origin = bounds.min.slice(), u = [0,0,0], v = [0,0,0];
      origin[fixed] = plane.at ?? bounds.min[fixed]+(bounds.max[fixed]-bounds.min[fixed])/2;
      u[varying[0]] = 1;
      v[varying[1]] = 1;
      plane = { origin, u, v, size:varying.map(i => bounds.max[i]-bounds.min[i]) };
    }
    check(vector(plane?.origin) && vector(plane.u) && vector(plane.v) && vector(plane.size,2) &&
      plane.size.every(n => n > 0),'expected a plane with an axis or origin, two directions and positive size');
    const uLength = V.len(plane.u), vLength = V.len(plane.v);
    check(finite(uLength) && uLength > epsilon && finite(vLength) && vLength > epsilon,
      'plane directions must be nonzero');
    const u = V.mul(plane.u,1/uLength), v = V.mul(plane.v,1/vLength);
    check(Math.abs(V.dot(u,v)) < 1e-6,'plane directions must be perpendicular');
    const frame = { origin:plane.origin.slice(),u,v,normal:V.norm(V.cross(u,v)),size:plane.size.slice() };
    check(onPlane(frame,...frame.size).every(finite),'plane extends beyond finite coordinates');
    return freeze(frame);
  }

  function onPlane({ origin,u,v },s,t) {
    return V.mad(V.mad(origin,u,s),v,t);
  }

  function countsFor(counts,dimensions,max) {
    check(Array.isArray(counts) && counts.length === dimensions &&
      Array.from(counts).every(n => limit(n,1,max)) && counts.reduce((n,k) => n*k,1) <= max,
      'grid exceeds the ' + max + ' sample budget');
    return counts;
  }

  function gridPoint(bounds,counts,index) {
    let stride = 1;
    return counts.map((n,i) => {
      const cell = Math.floor(index/stride)%n;
      stride *= n;
      return bounds.min[i]+(bounds.max[i]-bounds.min[i])*((cell+.5)/n);
    });
  }

  function planePoint(frame,counts,index) {
    const [cols,rows] = counts, [width,height] = frame.size;
    return onPlane(frame,((index%cols+.5)/cols)*width,((Math.floor(index/cols)+.5)/rows)*height);
  }

  function rangeOf(values) {
    let min = Infinity, max = -Infinity;
    for (const value of values) if (value !== null) {
      min = Math.min(min,value);
      max = Math.max(max,value);
    }
    return min <= max ? [min,max] : null;
  }

  function slice(field,{ plane, counts = [64,64] } = {}) {
    requireType(field,'number');
    const frame = frameFor(field.bounds,plane), [cols,rows] = countsFor(counts,2,65536);
    const values = Array.from({ length:cols*rows },(_,i) => field.sample(...planePoint(frame,counts,i)));
    return freeze({ kind:'slice', frame, counts:counts.slice(), values, range:rangeOf(values), units:field.units });
  }

  function contours(field,{ plane, levels = [0], cell, maxCells = 120000 } = {}) {
    requireType(field,'number');
    const frame = frameFor(field.bounds,plane), bounds = { min:[0,0],max:frame.size };
    check(Array.isArray(levels) && limit(levels.length,1,32) && Array.from(levels).every(finite) &&
      limit(maxCells,levels.length,500000),'invalid contour levels or cell budget');
    const spacing = cell ?? Math.max(...frame.size)/96;
    const budget = Math.floor(maxCells/levels.length), cache = new Map();
    const sample = (u,v) => {
      const key = u + ',' + v;
      if (!cache.has(key)) cache.set(key,field.sample(...onPlane(frame,u,v)));
      return cache.get(key);
    };
    const paths = levels.flatMap(level => P.contours.march(sample,{bounds,cell:spacing,iso:level,maxCells:budget})
      .map(row => ({ ...row, level,points:row.points.map(point => onPlane(frame,...point)) })));
    return freeze({ kind:'contours', frame, paths, range:rangeOf(levels), units:field.units });
  }

  function isosurface(field,{ level = 0, inside:mode = 'above', resolution, maxCells = 64000, maxTriangles = 250000, edgeRefinements = 0 } = {}) {
    requireType(field,'number');
    const { bounds } = field;
    check(finite(level) && ['above','below'].includes(mode) && limit(maxCells,8,160000) &&
      limit(maxTriangles,1,500000),
      'invalid isosurface level, interior or cell budget');
    const step = resolution ?? Math.max(...bounds.max.map((n,i) => n-bounds.min[i]))/36;
    const sign = mode === 'above' ? -1 : 1;
    const mesh = P.geometry.implicitSurface(point => {
      const value = field.sample(...point);
      return value === null ? null : sign*(value-level);
    },bounds,{ resolution:step,maxCells,maxTriangles,edgeRefinements,allowMissing:true });
    return Object.freeze({ kind:'isosurface',level,inside:mode,mesh,range:freeze([level,level]),units:field.units });
  }

  function streamlines(field,{ seeds, maxChecks = 240000, ...options } = {}) {
    requireType(field,'vec3');
    check(Array.isArray(seeds) && limit(seeds.length,1,512) && Array.from(seeds).every(p => vector(p)) &&
      limit(maxChecks,1,2000000),'expected bounded streamline seeds and a sample budget');
    const { bounds } = field, { mask, ...trace } = options;
    check(mask === undefined || typeof mask === 'function','invalid streamline mask');
    let checks = 0, exhausted = false, previous, velocity;
    function sample(x,y,z) {
      if (!previous || x !== previous[0] || y !== previous[1] || z !== previous[2]) {
        if (checks >= maxChecks) {
          exhausted = true;
          return null;
        }
        checks++;
        previous = [x,y,z];
        velocity = field.sample(x,y,z);
      }
      return velocity;
    }
    const valid = (x,y,z,t) => (!mask || mask(x,y,z,t)) && sample(x,y,z) !== null;
    const speeds = [];
    const paths = seeds.map(seed => {
      const remaining = maxChecks-checks;
      if (remaining <= 0) return { seed:seed.slice(),points:[],magnitudes:[],status:'budget' };
      if (!inside(bounds,seed) || !valid(...seed,trace.time ?? 0))
        return { seed:seed.slice(),points:[],magnitudes:[],status:'missing' };
      const result = P.motion.streamline(sample,seed,{...trace,bounds,mask:valid,maxChecks:remaining});
      const status = exhausted ? 'budget' : result.status;
      const magnitudes = result.points.map(point => {
        const value = sample(...point);
        return value === null ? null : V.len(value);
      });
      speeds.push(...magnitudes);
      return { ...result,status,seed:seed.slice(),magnitudes };
    });
    return freeze({ kind:'streamlines',paths,range:rangeOf(speeds),units:field.units,samples:checks });
  }

  function glyphs(field,{ points, plane, counts, scale = .4, normalize = false, minLength = 0, maxLength = Infinity } = {}) {
    requireType(field,'vec3');
    check(finite(scale) && scale > 0 && finite(minLength) && minLength >= 0 &&
      (maxLength === Infinity || finite(maxLength) && maxLength > 0) && maxLength >= minLength &&
      typeof normalize === 'boolean','invalid glyph length settings');
    check(points === undefined || Array.isArray(points) && points.length <= 16000 &&
      Array.from(points).every(p => vector(p)) && plane === undefined && counts === undefined,
      'explicit glyph points cannot be mixed with a grid or plane');
    const frame = plane === undefined ? null : frameFor(field.bounds,plane);
    if (!points) {
      counts = countsFor(counts ?? (frame ? [11,11] : [8,1,8]),frame ? 2 : 3,16000);
      const total = counts.reduce((n,k) => n*k,1);
      points = Array.from({length:total},(_,i) => frame ? planePoint(frame,counts,i) : gridPoint(field.bounds,counts,i));
    }
    const arrows = [];
    for (const point of points) {
      const vector = field.sample(...point);
      if (vector === null) continue;
      const magnitude = V.len(vector);
      if (magnitude <= epsilon) continue;
      const length = Math.min(maxLength,scale*(normalize ? 1 : magnitude));
      check(finite(length),'non-finite glyph length');
      if (length < minLength) continue;
      const to = V.mad(point,vector,length/magnitude);
      check(to.every(finite),'glyph extends beyond finite coordinates');
      arrows.push({ from:point.slice(),to,vector,magnitude });
    }
    return freeze({ kind:'glyphs',frame,arrows,range:rangeOf(arrows.map(row => row.magnitude)),units:field.units });
  }

  // Dense planar LIC. Sample the scene once per texel, then integrate in the chart.
  function lic(field, { plane, counts = [128,96], length, step, seed = 0, grain, texture, mask,
    kernel = 'hann', motion, minSpeed = 1e-8, maxWork = 12000000 } = {}) {
    requireType(field,'vec3');
    const frame = frameFor(field.bounds,plane), [cols,rows] = countsFor(counts,2,65536);
    const skew = V.dot(frame.u,frame.v), metric = 1-skew*skew, crossScale = Math.sqrt(metric);
    const dx = frame.size[0]/cols, dy = frame.size[1]/rows, pixel = Math.min(dx,dy), total = cols*rows;
    length ??= pixel*12;
    step ??= pixel/2;
    grain ??= pixel;
    const { wavelength, phase = 0 } = motion ?? {};
    check([length,step,grain,pixel].every(n => finite(n) && n > 0) &&
      Math.max(...frame.size)/grain <= 1e9 &&
      Number.isSafeInteger(seed) && Math.abs(seed) <= 0xffffffff &&
      ['box','tent','hann'].includes(kernel) && finite(minSpeed) && minSpeed >= 0 &&
      (texture === undefined || typeof texture === 'function') && (mask === undefined || typeof mask === 'function') &&
      (motion === undefined || motion && finite(wavelength) && wavelength > 0 && finite(phase) &&
        length/wavelength <= 1e6) && limit(maxWork,1,64000000),'invalid line integral convolution options');
    const steps = Math.ceil(length/Math.min(step,pixel/2));
    check(limit(steps,1,1024) && total*(1+4*steps) <= maxWork,'line integral convolution exceeds its work budget');
    const ds = length/steps, sx = ds/dx, sy = ds/dy, alive = new Uint8Array(total);
    const input = new Float64Array(total*3), output = new Float64Array(total*2);
    const values = new Array(total).fill(null), speeds = values.slice();
    const halfTurn = Math.PI, turn = 2*halfTurn;
    const weights = Float64Array.from({length:2*steps+1},(_,i) => {
      const distance = (i-steps)/steps, a = Math.abs(distance);
      const w = kernel === 'box' ? 1 : kernel === 'tent' ? 1-a : .5+.5*Math.cos(halfTurn*a);
      const moving = motion ? .5+.5*Math.cos(turn*(distance*length/wavelength+(phase%1))) : 1;
      return w*moving*(a === 1 ? .5 : 1);
    });

    function noise(u,v) {
      const key = Math.floor(u/grain) + ',' + Math.floor(v/grain);
      return K.grow.dice(P.data.hash(key,seed))();
    }
    for (let i=0;i<total;i++) {
      const u = (i%cols+.5)*dx, v = (Math.floor(i/cols)+.5)*dy, point = onPlane(frame,u,v);
      if (mask && !mask(...point)) continue;
      const velocity = field.sample(...point);
      if (velocity === null) continue;
      const along = V.dot(velocity,frame.u), across = V.dot(velocity,frame.v);
      const vx = (along-skew*across)/metric, vy = (across-skew*along)/metric;
      const speed = Math.hypot(along,vy*crossScale), ink = texture ? texture(u,v) : noise(u,v);
      check(finite(speed) && finite(ink) && ink >= 0 && ink <= 1,'expected finite projected velocity and texture coverage from 0 to 1');
      input[i*3] = vx;
      input[i*3+1] = vy;
      input[i*3+2] = ink;
      speeds[i] = output[i*2+1] = speed;
      alive[i] = 1;
    }

    // Samples are cell-centered. Do not blend diagonal cells through a sealed corner.
    function rasterSample(data,stride,x,y,out,fromX,fromY) {
      if (!(x >= 0 && y >= 0 && x <= cols && y <= rows)) return false;
      const col = Math.min(cols-1,Math.floor(x)), row = Math.min(rows-1,Math.floor(y));
      if (!alive[row*cols+col]) return false;
      if (fromX !== undefined) {
        const priorCol = Math.min(cols-1,Math.floor(fromX)), priorRow = Math.min(rows-1,Math.floor(fromY));
        if (priorCol !== col && priorRow !== row) {
          const xFirst = (Math.max(priorCol,col)-fromX)/(x-fromX);
          const yFirst = (Math.max(priorRow,row)-fromY)/(y-fromY);
          const aroundX = alive[priorRow*cols+col], aroundY = alive[row*cols+priorCol];
          if (Math.abs(xFirst-yFirst) <= epsilon ? !aroundX && !aroundY : xFirst < yFirst ? !aroundX : !aroundY)
            return false;
        }
      }
      const left = Math.floor(x-.5), top = Math.floor(y-.5), fx = x-.5-left, fy = y-.5-top;
      const x0 = Math.max(0,left), x1 = Math.min(cols-1,left+1);
      const y0 = Math.max(0,top), y1 = Math.min(rows-1,top+1);
      let weight = 0;
      out.fill(0);
      for (let b=0;b<2;b++) for (let a=0;a<2;a++) {
        const c = a ? x1 : x0, r = b ? y1 : y0, k = r*cols+c;
        if (!alive[k] || c !== col && r !== row && !alive[row*cols+c] && !alive[r*cols+col]) continue;
        const w = (a ? fx : 1-fx)*(b ? fy : 1-fy);
        for (let channel=0;channel<stride;channel++) out[channel] += w*data[k*stride+channel];
        weight += w;
      }
      for (let channel=0;channel<stride;channel++) out[channel] /= weight;
      return true;
    }

    const tap = new Float64Array(3);
    for (let i=0;i<total;i++) {
      if (!alive[i]) continue;
      const x0 = i%cols+.5, y0 = Math.floor(i/cols)+.5;
      const ink = input[i*3+2], centerSpeed = speeds[i];
      let mass = weights[steps], sum = mass*ink;
      for (const direction of [-1,1]) {
        let x = x0, y = y0, vx = input[i*3], vy = input[i*3+1], speed = centerSpeed;
        for (let j=1;j<=steps && speed>minSpeed;j++) {
          const mx = x+direction*.5*sx*(vx/speed), my = y+direction*.5*sy*(vy/speed);
          if (!rasterSample(input,3,mx,my,tap,x,y)) break;
          const middle = Math.hypot(tap[0]+skew*tap[1],tap[1]*crossScale);
          if (middle <= minSpeed) break;
          const qx = x+direction*sx*(tap[0]/middle), qy = y+direction*sy*(tap[1]/middle);
          if (!rasterSample(input,3,qx,qy,tap,x,y)) break;
          const weight = weights[steps+direction*j];
          mass += weight;
          sum += weight*tap[2];
          x = qx; y = qy;
          vx = tap[0]; vy = tap[1]; speed = Math.hypot(vx+skew*vy,vy*crossScale);
        }
      }
      values[i] = output[i*2] = mass ? Math.max(0,Math.min(1,sum/mass)) : ink;
    }

    function sample(u,v,channel = 'grain') {
      check(channel === 'grain' || channel === 'speed','unknown LIC channel');
      const result = [0,0];
      return rasterSample(output,2,u/dx,v/dy,result) ? result[channel === 'grain' ? 0 : 1] : null;
    }
    function fieldSource(channel = 'grain',{ bounds,project } = {}) {
      check((channel === 'grain' || channel === 'speed') &&
        (project === undefined || typeof project === 'function' && bounds),'invalid LIC field projection');
      const corners = [[0,0],[0,frame.size[1]],[frame.size[0],0],frame.size].map(uv => onPlane(frame,...uv));
      const box = bounds ?? {
        min:frame.origin.map((_,axis) => Math.min(...corners.map(p => p[axis]))),
        max:frame.origin.map((_,axis) => Math.max(...corners.map(p => p[axis])))
      };
      return source({type:'number',bounds:box,units:channel === 'speed' ? field.units : null,sample(x,y,z) {
        const point = [x,y,z];
        if (project) {
          const uv = project(point);
          return vector(uv,2) ? sample(...uv,channel) : null;
        }
        const offset = V.sub(point,frame.origin);
        if (Math.abs(V.dot(offset,frame.normal)) > epsilon*Math.max(1,...frame.size)) return null;
        const along = V.dot(offset,frame.u), across = V.dot(offset,frame.v);
        const [u,v] = [(along-skew*across)/metric,(across-skew*along)/metric].map((value,i) => {
          const edge = frame.size[i], slack = epsilon*Math.max(dx,dy,edge);
          return value >= -slack && value <= edge+slack ? Math.max(0,Math.min(edge,value)) : value;
        });
        return sample(u,v,channel);
      }});
    }
    return freeze({kind:'lic',frame,counts:counts.slice(),values,speeds,range:rangeOf(values),units:null,step:ds,length,
      sample,source:fieldSource});
  }

  K.fieldViews = { source,fromQuery,magnitude,slice,contours,isosurface,streamlines,glyphs,lic };
})(KIT);
