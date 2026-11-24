/* Adapt scene geometry to the same bounded density used by fog and cloud rendering. */
const GeometryDensity = (() => {
  const volume = typeof VolumeField === 'undefined' ? require('./volume-field.js') : VolumeField;
  const clamp = (n, lo, hi) => Math.max(lo,Math.min(hi,n));
  const mix = (a,b,u) => a+(b-a)*u;
  const vector = (p,n) => Array.isArray(p) && p.length===n && Array.from(p).every(Number.isFinite);
  const positive = (n,name) => {
    if (!Number.isFinite(n) || n<=0) throw new RangeError(name+' must be positive');
    return n;
  };

  function fromPath({ path, points, radius=.6, aspect=1, feather=.24, ...appearance } = {}) {
    if (path!==undefined && points!==undefined) throw new TypeError('Density needs one path or point list');
    const line = points ?? path?.points;
    if (!Array.isArray(line)||line.length<2||line.length>8192||!Array.from(line).every(p=>vector(p,3)))
      throw new TypeError('Path density needs a route or 2–8192 finite XYZ points');
    const [start,end]=Array.isArray(radius)&&radius.length===2 ? radius : [radius,radius];
    positive(start,'Path start radius');
    positive(end,'Path end radius');
    positive(aspect,'Path vertical aspect');
    const pointsIn=Array.from(line,p=>p.slice());
    const extents=[Math.max(start,end),Math.max(start,end)*aspect,Math.max(start,end)];
    const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity], segments=[];
    let length=0;
    for (let i=0;i<pointsIn.length;i++) {
      const a=pointsIn[i];
      for (let axis=0;axis<3;axis++) {
        min[axis]=Math.min(min[axis],a[axis]-extents[axis]);
        max[axis]=Math.max(max[axis],a[axis]+extents[axis]);
      }
      if (i===pointsIn.length-1) continue;
      const b=pointsIn[i+1], dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2], size=Math.hypot(dx,dy,dz);
      if (!size) continue;
      segments.push({ a,b,dx,dy:dy/aspect,dz,start:length,size });
      length+=size;
    }
    if (!(length>0) || !Number.isFinite(length))
      throw new RangeError('Path density requires a finite nonzero route length');
    for (const segment of segments) {
      const {a,b,dx,dy,dz}=segment;
      segment.r0=mix(start,end,segment.start/length);
      segment.r1=mix(start,end,(segment.start+segment.size)/length);
      const reach=Math.max(segment.r0,segment.r1);
      segment.min=a.map((v,i)=>Math.min(v,b[i])-reach*(i===1?aspect:1));
      segment.max=a.map((v,i)=>Math.max(v,b[i])+reach*(i===1?aspect:1));
      segment.length2=dx*dx+dy*dy+dz*dz;
    }
    const field=volume.fromSdf({ ...appearance, feather, bounds:{min,max}, conservative:false,
      field(x,y,z) {
        let distance=0;
        for (const {a,dx,dy,dz,length2,r0,r1,min,max} of segments) {
          if (x<min[0]||x>max[0]||y<min[1]||y>max[1]||z<min[2]||z>max[2]) continue;
          const u=x-a[0], v=(y-a[1])/aspect, w=z-a[2];
          const t=clamp((u*dx+v*dy+w*dz)/length2,0,1);
          distance=Math.min(distance,Math.hypot(u-t*dx,v-t*dy,w-t*dz)-mix(r0,r1,t));
        }
        return distance;
      }
    });
    return Object.freeze({ ...field, segmentBounds:Object.freeze(segments.map(({min,max}) =>
      Object.freeze({min:Object.freeze(min),max:Object.freeze(max)}))) });
  }

  function terrainSampler(terrain, extent) {
    if (typeof terrain==='function') return terrain;
    if (typeof terrain?.heightAt==='function') return terrain.heightAt.bind(terrain);
    if (typeof terrain?.sample==='function') return terrain.sample.bind(terrain);
    const { resolution, values }=terrain??{};
    if (!vector(resolution,2) || !resolution.every(n=>Number.isInteger(n)&&n>=2&&n<=512) ||
        !(Array.isArray(values)||ArrayBuffer.isView(values)) ||
        values.length!==resolution[0]*resolution[1] || !Array.from(values).every(Number.isFinite))
      throw new TypeError('Terrain density needs a height sampler or a finite XZ height grid');
    const [width,rows]=resolution, copy=Float64Array.from(values);
    const xz=terrain.bounds??{ min:[extent.min[0],extent.min[2]], max:[extent.max[0],extent.max[2]] };
    if (!vector(xz?.min,2)||!vector(xz?.max,2)||xz.min.some((v,i)=>v>=xz.max[i]))
      throw new RangeError('Terrain height grid needs positive XZ bounds');
    const [x0,z0]=xz.min, [x1,z1]=xz.max;
    return (x,z) => {
      if (x<x0||x>x1||z<z0||z>z1) return null;
      const u=(x-x0)/(x1-x0)*(width-1), v=(z-z0)/(z1-z0)*(rows-1);
      const i=Math.min(width-2,Math.floor(u)), j=Math.min(rows-2,Math.floor(v));
      const row=j*width+i;
      return mix(mix(copy[row],copy[row+1],u-i),mix(copy[row+width],copy[row+width+1],u-i),v-j);
    };
  }

  function fromTerrain({ bounds, terrain, depth=1, ceiling, feather=.22, ...appearance } = {}) {
    const extent=volume.bounds(bounds);
    const height=terrainSampler(terrain,extent);
    positive(depth,'Terrain mist depth');
    if (ceiling!==undefined&&!Number.isFinite(ceiling)) throw new RangeError('Terrain mist ceiling must be finite');
    const {min,max}=extent;
    return volume.fromSdf({ ...appearance, feather, bounds:extent, conservative:false,
      field(x,y,z,time) {
        const sample=height(x,z,time);
        if (sample==null) return 0;
        const ground=typeof sample==='number' ? sample : sample.terrainHeight??sample.height??sample.elevation;
        if (!Number.isFinite(ground)) throw new RangeError('Terrain density needs finite heights');
        const top=Math.min(ground+depth,ceiling??Infinity);
        return Math.max(ground-y,y-top,min[0]-x,x-max[0],min[2]-z,z-max[2]);
      }
    });
  }

  function resolve(source) {
    if (typeof source?.sample==='function') {
      volume.bounds(source.bounds);
      return source;
    }
    switch (source?.type) {
      case 'path': return fromPath(source);
      case 'sdf': return volume.fromSdf({ ...source, bounds:source.bounds??source.field?.bounds });
      case 'terrain': return fromTerrain(source);
      default: throw new TypeError('Shaped density needs a bounded field, path, SDF or terrain');
    }
  }

  return Object.freeze({ fromPath, fromTerrain, resolve });
})();
if (typeof module !== 'undefined') module.exports = GeometryDensity;
