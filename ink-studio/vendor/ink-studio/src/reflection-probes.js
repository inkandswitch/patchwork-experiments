/* Box-projected directional captures and roughness filtering for local reflections. */
const ReflectionProbes = (() => {
  let selectors, shadows, colors;
  try { selectors = TargetSelectors; shadows = ShadowArt; colors = ColorSpace; }
  catch {
    selectors = require('./target-selectors.js');
    shadows = require('./shadow-art.js');
    colors = require('./color-space.js');
  }
  const centerTap = [[0, 1]];
  const linear = colors.prepare('srgb', 'srgb-linear');
  const srgb = colors.prepare('srgb-linear', 'srgb');
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const faces = [
    [[1,0,0],[0,1,0]], [[-1,0,0],[0,1,0]], [[0,1,0],[0,0,-1]],
    [[0,-1,0],[0,0,1]], [[0,0,1],[0,1,0]], [[0,0,-1],[0,1,0]]
  ].map(([forward,up]) => ({ forward, up, right:cross(forward,up) }));

  function probe(value) {
    if (!record(value) || Object.keys(value).some(key => !['id','at','size','near','bounds','capture'].includes(key)))
      throw new TypeError('Invalid reflection probe settings');
    const { id, at, size = 64, near = 0.05, bounds, capture } = value;
    if (!selectors.name(id) || !vector(at) || ![32,64,128,256].includes(size) ||
        !Number.isFinite(near) || near < .005 || near > 10)
      throw new RangeError('Reflection probes need an ID, an XYZ position, a size of 32, 64, 128 or 256, and near in .005–10');
    let region;
    if (bounds !== undefined) {
      if (!record(bounds) || Object.keys(bounds).some(key=>!['min','max','feather'].includes(key)) ||
          !vector(bounds.min) || !vector(bounds.max) ||
          at.some((n,i)=>n <= bounds.min[i] || n >= bounds.max[i]) ||
          !Number.isFinite(bounds.feather ?? 0) || (bounds.feather ?? 0) < 0)
        throw new RangeError('Reflection probe bounds must enclose the capture position and have a nonnegative feather');
      region = { min:bounds.min.slice(), max:bounds.max.slice(), feather:bounds.feather ?? 0 };
    }
    const cast = shadows.prepare({ cast:capture })?.cast;
    return { id, at:at.slice(), size, near, ...(region && { bounds:region }), ...(cast && { capture:cast }) };
  }

  function prepare(value) {
    if (value === undefined || value === false) return [];
    if (!Array.isArray(value) || value.length > 8) throw new TypeError('Use a list of up to eight reflection probes');
    const ids = new Set();
    return Array.from(value, row => {
      const result = probe(row);
      if (ids.has(result.id)) throw new RangeError('Duplicate reflection probe ' + result.id);
      ids.add(result.id);
      return result;
    });
  }

  function view(at, face) {
    const { right, up, forward } = faces[face], back = forward.map(n=>-n);
    return [
      right[0],up[0],back[0],0, right[1],up[1],back[1],0, right[2],up[2],back[2],0,
      -dot(right,at),-dot(up,at),-dot(back,at),1
    ];
  }

  function directionFor(face, x, y, size) {
    const { right, up, forward } = faces[face];
    const u = (x+.5)*2/size-1, v = (y+.5)*2/size-1;
    return [0,1,2].map(i=>forward[i]+right[i]*u+up[i]*v);
  }

  function coordinates(direction, size) {
    const [x,y,z] = direction, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    const face = ax >= ay && ax >= az ? Number(x<0) : ay >= az ? 2+Number(y<0) : 4+Number(z<0);
    const { forward, right, up } = faces[face];
    const scale = size*.5/dot(direction,forward);
    return [face, (size-1)*.5 + dot(direction,right)*scale, (size-1)*.5 + dot(direction,up)*scale];
  }

  function levels(frames, size) {
    const temp = [0,0,0], rgb = [0,0,0];
    const result = [{ size, faces:frames.map(frame=>{
      if (frame.w !== size || frame.h !== size || frame.coverage?.length !== size*size ||
          frame.rgb?.length !== size*size*3) throw new RangeError('Invalid reflection probe face');
      const packed = new Float32Array(size*size*4);
      for (let i=0;i<size*size;i++) {
        const alpha=frame.coverage[i];
        if (alpha <= 0) continue;
        for(let c=0;c<3;c++) rgb[c]=frame.rgb[i*3+c]/alpha;
        linear(rgb,temp);
        for(let c=0;c<3;c++) packed[i*4+c]=temp[c]*alpha;
        packed[i*4+3]=alpha;
      }
      return packed;
    }) }];
    while (size>1) {
      const prior = result.at(-1).faces, from = size;
      size /= 2;
      result.push({ size, faces:prior.map(face=>{
        const packed=new Float32Array(size*size*4);
        for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
          const i=(y*size+x)*4, p=(y*from+x)*8;
          for(let c=0;c<4;c++)
            packed[i+c]=(face[p+c]+face[p+c+4]+face[p+c+from*4]+face[p+c+from*4+4])*.25;
        }
        return packed;
      }) });
    }
    return result;
  }

  function bilinear(level, direction, gain, out) {
    const { size, faces:images } = level;
    const [face, x, y] = coordinates(direction,size), ix=Math.floor(x), iy=Math.floor(y);
    const rx=x-ix, ry=y-iy;
    for(let j=0;j<2;j++) for(let i=0;i<2;i++) {
      let row=face, X=ix+i, Y=iy+j;
      const amount=gain*(i ? rx : 1-rx)*(j ? ry : 1-ry);
      if (!amount) continue;
      if (X<0 || X>=size || Y<0 || Y>=size) {
        [row,X,Y]=coordinates(directionFor(face,X,Y,size),size);
        X=clamp(Math.round(X),0,size-1);
        Y=clamp(Math.round(Y),0,size-1);
      }
      const offset=(Y*size+X)*4, pixels=images[row];
      for(let c=0;c<4;c++) out[c]+=pixels[offset+c]*amount;
    }
  }

  function parallax(probe, point, ray) {
    if (!probe.bounds) return ray;
    const { min, max } = probe.bounds;
    let exit=Infinity;
    for(let i=0;i<3;i++) {
      if (ray[i] > 1e-8) exit=Math.min(exit,(max[i]-point[i])/ray[i]);
      else if(ray[i] < -1e-8) exit=Math.min(exit,(min[i]-point[i])/ray[i]);
    }
    const result=point.map((n,i)=>n+exit*ray[i]-probe.at[i]);
    return Math.hypot(...result)>1e-8 ? result : ray;
  }

  function sampler(definitions, capture, cache = new Map()) {
    const byId = new Map(definitions.map(entry=>[entry.id,entry]));
    const filtered = [0,0,0,0], rgb = [0,0,0], sample = { rgb, coverage:0 };
    const taps = [[-1,.12],[-.5,.23],[0,.30],[.5,.23],[1,.12]];
    function read(id, point, ray, roughness, axis) {
      const probe=byId.get(id);
      if (!probe) return null;
      let influence=1;
      if(probe.bounds) {
        const { min,max,feather }=probe.bounds;
        const edge=Math.min(point[0]-min[0],point[1]-min[1],point[2]-min[2],max[0]-point[0],max[1]-point[1],max[2]-point[2]);
        if(edge<0) return null;
        if(feather) {
          const t=clamp(edge/feather,0,1);
          influence=t*t*(3-2*t);
          if(!influence) return null;
        }
      }
      const key=JSON.stringify([probe.id,probe.size]);
      if(!cache.has(key)) cache.set(key,levels(faces.map((_,i)=>capture(probe,i)),probe.size));
      const mip=cache.get(key), [along,across]=roughness;
      const minor=Math.min(along,across), spread=Math.abs(along*along-across*across)*.9;
      const lod=Math.min(mip.length-1,Math.log2(1+(minor*minor+spread*.29)*probe.size*.65));
      const low=Math.floor(lod), high=Math.min(low+1,mip.length-1), fraction=lod-low;
      filtered.fill(0);
      for(const [offset,weight] of spread && axis ? taps : centerTap) {
        const direction=parallax(probe,point,offset ? ray.map((n,i)=>n+axis[i]*offset*spread) : ray);
        bilinear(mip[low],direction,weight*(1-fraction),filtered);
        if(fraction) bilinear(mip[high],direction,weight*fraction,filtered);
      }
      const alpha=filtered[3];
      if(alpha<=1e-6) return null;
      for(let c=0;c<3;c++) rgb[c]=filtered[c]/alpha;
      srgb(rgb,rgb);
      sample.coverage=clamp(alpha*influence,0,1);
      return sample;
    }
    read.has=id=>byId.has(id);
    return read;
  }

  return Object.freeze({ probe, prepare, view, sampler });
})();
if (typeof module !== 'undefined') module.exports = ReflectionProbes;
