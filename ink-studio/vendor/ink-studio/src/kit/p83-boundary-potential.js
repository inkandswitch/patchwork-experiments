/* A cell-centered Laplace solve with pinned cells and insulated or fixed faces. */
(function (K) {
  const P = K.procedural, finite = Number.isFinite;
  const edges = ['xMin','xMax','zMin','zMax'];
  const channels = Object.freeze(['potential','gradient','flow','magnitude']);
  const vector = (p,n) => Array.isArray(p) && p.length === n && Array.from(p).every(finite);
  const record = v => v != null && [Object.prototype,null].includes(Object.getPrototypeOf(v));
  const valueOK = n => finite(n) && Math.abs(n) <= 1e9;
  const limit = (n,min,max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const check = (ok,message) => { if (!ok) throw new RangeError('Potential field: ' + message); };

  function potential(options = {}) {
    const grid = P.motion.gridDomain(options), {width,height,size,dx,dz,bounds,open,center,inside} = grid;
    const neighbors = new Int32Array(size*4).fill(-1), component = new Int32Array(size).fill(-1);
    const active = [], components = [], offsets = [-1,1,-width,width];
    const scale = Math.min(dx,dz), weights = [(scale/dx)**2,(scale/dx)**2,(scale/dz)**2,(scale/dz)**2];
    const points = new Float64Array(2*size), outer = new Uint8Array(size);
    const prior = new WeakMap();

    for (let i=0;i<size;i++) {
      if (!open[i]) continue;
      active.push(i);
      points.set(center(i),2*i);
      const x = i%width, z = Math.floor(i/width);
      const sides = [x===0,x===width-1,z===0,z===height-1];
      for (let k=0;k<4;k++) {
        if (sides[k]) outer[i] |= 1<<k;
        else if (open[i+offsets[k]]) neighbors[4*i+k] = i+offsets[k];
      }
    }
    check(active.length,'the mask must contain an open cell');
    for (const first of active) {
      if (component[first] >= 0) continue;
      const id = components.length, group = [first];
      component[first] = id;
      for (let k=0;k<group.length;k++) for (let face=0;face<4;face++) {
        const j = neighbors[4*group[k]+face];
        if (j < 0 || component[j] >= 0) continue;
        component[j] = id;
        group.push(j);
      }
      components.push(group);
    }

    function solve({ pins = [], pin, boundary = {}, floating = 0, initial, tolerance = 1e-8,
      maxIterations = 2400, maxWork = 16000000 } = {}) {
      check(Array.isArray(pins) && pins.length <= 256 && Array.from(pins).every(record) && (pin === undefined || typeof pin === 'function') &&
        record(boundary) && Object.entries(boundary).every(([edge,v]) => edges.includes(edge) &&
          (v === 'insulate' || valueOK(v) || typeof v === 'function')) && valueOK(floating) &&
        (initial === undefined || prior.has(initial)) && finite(tolerance) && tolerance > 0 &&
        limit(maxIterations,1,10000) && limit(maxWork,1,64000000),'invalid constraints or solver controls');
      const fixed = new Float64Array(size).fill(NaN), faceValues = new Float64Array(size*4).fill(NaN);
      const limits = components.map(() => [Infinity,-Infinity]);
      function anchor(i,v) {
        check(valueOK(v),'fixed values must be finite and at most 1e9 in magnitude');
        const band = limits[component[i]];
        band[0] = Math.min(band[0],v); band[1] = Math.max(band[1],v);
      }
      function pinCell(i,v) {
        check(Number.isNaN(fixed[i]) || fixed[i] === v,'conflicting pins cover the same cell');
        anchor(i,v);
        fixed[i] = v;
      }
      const sides = edges.map(edge => boundary[edge]);
      for (const i of active) {
        const x = points[2*i], z = points[2*i+1], v = pin?.(x,z,i);
        if (v != null) pinCell(i,v);
        for (let k=0;k<4;k++) {
          const rule = sides[k];
          if (!(outer[i] & (1<<k)) || rule === undefined || rule === 'insulate') continue;
          const result = typeof rule === 'function' ?
            rule(k<2 ? bounds[k===0 ? 'min' : 'max'][0] : x,k>=2 ? bounds[k===2 ? 'min' : 'max'][1] : z,i) : rule;
          if (result == null || result === 'insulate') continue;
          anchor(i,result);
          faceValues[4*i+k] = result;
        }
      }
      for (const { at, radius, value } of pins) {
        check(vector(at,2) && valueOK(value) &&
          (radius === undefined || finite(radius) && radius > 0 && radius <= 1e8),'pins need a finite point, value and optional radius');
        const [x,z] = at;
        if (radius === undefined) {
          check(inside(x,z),'point pin must lie in an open cell');
          const i = Math.min(width-1,Math.floor((x-bounds.min[0])/dx))+
            width*Math.min(height-1,Math.floor((z-bounds.min[1])/dz));
          pinCell(i,value);
          continue;
        }
        let hits = 0;
        const x0 = Math.max(0,Math.ceil((x-radius-bounds.min[0])/dx-.5));
        const x1 = Math.min(width-1,Math.floor((x+radius-bounds.min[0])/dx-.5));
        const z0 = Math.max(0,Math.ceil((z-radius-bounds.min[1])/dz-.5));
        const z1 = Math.min(height-1,Math.floor((z+radius-bounds.min[1])/dz-.5));
        for (let row=z0;row<=z1;row++) for (let col=x0;col<=x1;col++) {
          const i = row*width+col;
          if (!open[i] || Math.hypot(points[2*i]-x,points[2*i+1]-z) > radius) continue;
          pinCell(i,value);
          hits++;
        }
        check(hits,'pin radius did not reach an open cell center');
      }

      const u = new Float64Array(size), diag = new Float64Array(size), rhs = new Float64Array(size);
      const free = new Uint8Array(size), previous = prior.get(initial);
      let unanchored = 0;
      for (let k=0;k<components.length;k++) {
        const [lo,hi] = limits[k];
        if (lo > hi) unanchored++;
        for (const i of components[k]) {
          if (!Number.isNaN(fixed[i])) u[i] = fixed[i];
          else if (lo > hi) u[i] = floating;
          else if (lo === hi) u[i] = lo;
          else {
            u[i] = previous ? Math.max(lo,Math.min(hi,previous[i])) : (lo+hi)/2;
            free[i] = 1;
          }
        }
      }
      // Use row-major order for a deterministic incomplete Cholesky preconditioner.
      const cells = active.filter(i => free[i]), lowerX = new Float64Array(size), lowerZ = new Float64Array(size);
      const root = new Float64Array(size), pre = new Float64Array(size), residualVector = new Float64Array(size);
      const direction = new Float64Array(size), product = new Float64Array(size);
      for (const i of cells) {
        const start = 4*i;
        for (let k=0;k<4;k++) {
          const j = neighbors[start+k], face = faceValues[start+k], w = weights[k];
          if (j >= 0) {
            diag[i] += w;
            if (!free[j]) rhs[i] += w*u[j];
          } else if (!Number.isNaN(face)) {
            diag[i] += 2*w;
            rhs[i] += 2*w*face;
          }
        }
        const a = neighbors[start], b = neighbors[start+2];
        lowerX[i] = a >= 0 && free[a] ? -weights[0]/root[a] : 0;
        lowerZ[i] = b >= 0 && free[b] ? -weights[2]/root[b] : 0;
        // The floor avoids cancellation on extremely anisotropic grids.
        root[i] = Math.sqrt(Math.max(diag[i]*1e-12,diag[i]-lowerX[i]**2-lowerZ[i]**2));
      }

      function multiply(input,i) {
        let total = diag[i]*input[i];
        const next = 4*i;
        for (let k=0;k<4;k++) {
          const j = neighbors[next+k];
          if (j >= 0 && free[j]) total -= weights[k]*input[j];
        }
        return total;
      }
      function precondition() {
        for (const i of cells) {
          const a = neighbors[4*i], b = neighbors[4*i+2];
          pre[i] = (residualVector[i]-(lowerX[i] ? lowerX[i]*pre[a] : 0)-
            (lowerZ[i] ? lowerZ[i]*pre[b] : 0))/root[i];
        }
        let norm = 0;
        for (let k=cells.length-1;k>=0;k--) {
          const i = cells[k], a = neighbors[4*i+1], b = neighbors[4*i+3];
          pre[i] = (pre[i]-(a >= 0 && free[a] ? lowerX[a]*pre[a] : 0)-
            (b >= 0 && free[b] ? lowerZ[b]*pre[b] : 0))/root[i];
          norm += residualVector[i]*pre[i];
        }
        return norm;
      }
      function measure() {
        let largest = 0;
        for (const i of cells) {
          residualVector[i] = rhs[i]-multiply(u,i);
          largest = Math.max(largest,Math.abs(residualVector[i]/diag[i]));
        }
        return largest;
      }

      let residual = measure(), iterations = 0;
      const iterationsAllowed = Math.min(maxIterations,Math.floor(maxWork/Math.max(1,cells.length)));
      while (residual > tolerance && iterations < iterationsAllowed) {
        let norm = precondition();
        direction.set(pre);
        // Restart after an exact residual check if the recurrence rounded optimistically.
        do {
          let denominator = 0;
          for (const i of cells) {
            product[i] = multiply(direction,i);
            denominator += product[i]*direction[i];
          }
          if (!(denominator > 0 && norm > 0)) break;
          const alpha = norm/denominator;
          let error = 0;
          for (const i of cells) {
            u[i] += alpha*direction[i];
            residualVector[i] -= alpha*product[i];
            error = Math.max(error,Math.abs(residualVector[i]/diag[i]));
          }
          iterations++;
          if (error <= tolerance || iterations === iterationsAllowed) break;
          const next = precondition(), beta = next/norm;
          for (const i of cells) direction[i] = pre[i]+beta*direction[i];
          norm = next;
        } while (norm > 0);
        const nextResidual = measure();
        if (!(nextResidual < residual)) { residual = nextResidual; break; }
        residual = nextResidual;
      }

      const gx = new Float64Array(size), gz = new Float64Array(size);
      function difference(i,k) {
        const j = neighbors[4*i+k], value = faceValues[4*i+k];
        return j >= 0 ? u[j]-u[i] : Number.isNaN(value) ? 0 : 2*(value-u[i]);
      }
      for (const i of active) {
        gx[i] = (difference(i,1)-difference(i,0))/(2*dx);
        gz[i] = (difference(i,3)-difference(i,2))/(2*dz);
      }
      function connected(i,j,axis) {
        const k = axis===0 ? Number(j>i) : 2+Number(j>i);
        return neighbors[4*i+k]===j;
      }
      function interpolate(x,z,visit) {
        const qx = (x-bounds.min[0])/dx, qz = (z-bounds.min[1])/dz;
        const col = Math.min(width-1,Math.floor(qx)), row = Math.min(height-1,Math.floor(qz));
        const a = Math.floor(qx-.5), b = Math.floor(qz-.5), fx = qx-.5-a, fz = qz-.5-b;
        const i = row*width+col;
        let sum = 0;
        for (let v=0;v<2;v++) for (let u=0;u<2;u++) {
          const c = Math.max(0,Math.min(width-1,a+u)), r = Math.max(0,Math.min(height-1,b+v));
          const j = r*width+c, h = row*width+c, t = r*width+col;
          if (!open[j] || j!==i &&
            !(h!==i && connected(i,h,0) && (j===h || connected(h,j,1)) ||
              t!==i && connected(i,t,1) && (j===t || connected(t,j,0)))) continue;
          const weight = (u ? fx : 1-fx)*(v ? fz : 1-fz);
          sum += weight;
          visit(j,weight);
        }
        return sum;
      }
      function sample(channel,x,z) {
        check(channels.includes(channel),'unknown field channel');
        if (!inside(x,z)) return null;
        const scalar = channel==='potential';
        let a = 0, b = 0;
        const sum = interpolate(x,z,(i,w) => {
          a += (scalar ? u[i] : gx[i])*w;
          if (!scalar) b += gz[i]*w;
        });
        if (scalar) return a/sum;
        if (channel==='magnitude') return Math.hypot(a,b)/sum;
        const sign = channel==='flow' ? -1 : 1;
        return [sign*a/sum,sign*b/sum];
      }
      function source(channel = 'potential',{bounds:box,project,vectorToWorld,units = null} = {}) {
        const vectorField = channel==='gradient' || channel==='flow';
        check(channels.includes(channel) && (project===undefined || typeof project==='function' && box) &&
          (vectorToWorld===undefined || vectorField && typeof vectorToWorld==='function'),'invalid field source projection');
        const world = box ?? {min:[bounds.min[0],0,bounds.min[1]],max:[bounds.max[0],0,bounds.max[1]]};
        return K.fieldViews.source({type:vectorField ? 'vec3' : 'number',bounds:world,units,sample(x,y,z) {
          const point = [x,y,z], p = project ? project(point) : [x,z];
          if (!vector(p,2)) return null;
          const value = sample(channel,...p);
          return value===null || !vectorField ? value : vectorToWorld ? vectorToWorld(value,point) : [value[0],0,value[1]];
        }});
      }
      function data(channel = 'potential') {
        check(channels.includes(channel),'unknown field channel');
        if (channel==='potential') return u.slice();
        if (channel==='magnitude') return Float64Array.from(gx,(v,i) => Math.hypot(v,gz[i]));
        const sign = channel==='flow' ? -1 : 1;
        const output = new Float64Array(2*size);
        for (const i of active) { output[2*i] = sign*gx[i]; output[2*i+1] = sign*gz[i]; }
        return output;
      }
      const stats = Object.freeze({converged:residual<=tolerance,residual,iterations,components:components.length,unanchored});
      const result = Object.freeze({width,height,bounds,channels,stats,sample,source,data,contains:inside,
        frame:() => result,mask:() => open.slice(),contours:options => K.fieldViews.contours(source(),options)});
      prior.set(result,u);
      return result;
    }
    return Object.freeze({width,height,bounds,solve});
  }
  P.fields.potential = potential;
})(KIT);
