/* Feathered reductions in world-space density. An authored shape is the clear core. */
const VolumeCutouts = (() => {
  const geometry = typeof GeometryDensity === 'undefined' ? require('./geometry-density.js') : GeometryDensity;
  const volume = typeof VolumeField === 'undefined' ? require('./volume-field.js') : VolumeField;
  const brand = Symbol.for('ink-studio.volume-cutouts');
  const vector = (value,name) => {
    if (!Array.isArray(value)||value.length!==3||!Array.from(value).every(Number.isFinite))
      throw new TypeError(name+' needs a finite XYZ position');
    return value.slice();
  };
  const number = (value,min,max,name) => {
    if (!Number.isFinite(value)||value<min||value>max) throw new RangeError(name+' is out of range');
    return value;
  };
  const ease = t => {
    t=Math.max(0,Math.min(1,t));
    return t*t*(3-2*t);
  };
  const expand = ({ min,max }, n) => ({min:min.map(x=>x-n),max:max.map(x=>x+n)});
  const hitBox = ({min,max},origin,direction,from,to) => {
    for (let i=0;i<3;i++) {
      const d=direction[i], x=origin[i];
      if (Math.abs(d)<1e-10) {
        if (x<min[i]||x>max[i]) return null;
      } else {
        const a=(min[i]-x)/d,b=(max[i]-x)/d;
        from=Math.max(from,Math.min(a,b));
        to=Math.min(to,Math.max(a,b));
        if (to<=from) return null;
      }
    }
    return to>from ? [from,to] : null;
  };
  const hitSphere = (at,r,origin,direction,from,to) => {
    const x=origin[0]-at[0],y=origin[1]-at[1],z=origin[2]-at[2];
    const a=direction[0]**2+direction[1]**2+direction[2]**2;
    const b=x*direction[0]+y*direction[1]+z*direction[2];
    const discriminant=b*b-a*(x*x+y*y+z*z-r*r);
    if (!(discriminant>0)) return null;
    const d=Math.sqrt(discriminant);
    from=Math.max(from,(-b-d)/a);
    to=Math.min(to,(-b+d)/a);
    return to>from ? [from,to] : null;
  };
  const outside = ({min,max},x,y,z) =>
    x<min[0]||x>max[0]||y<min[1]||y>max[1]||z<min[2]||z>max[2];

  function shape(zone, feather, retain) {
    const gain = d => d<=0 ? retain : feather ? retain+(1-retain)*ease(d/feather) : 1;
    if (zone.type==='sphere') {
      const radius=number(zone.radius,Number.MIN_VALUE,1e6,'Cutout radius');
      const point=typeof zone.at==='function' ? zone.at : vector(zone.at,'Cutout center');
      const extent=radius+feather;
      return time => {
        const at=typeof point==='function' ? vector(point(time),'Cutout center') : point;
        const bounds={min:at.map(n=>n-extent),max:at.map(n=>n+extent)};
        return { bounds, gain:(x,y,z)=>gain(Math.hypot(x-at[0],y-at[1],z-at[2])-radius),
          ranges(o,d,a,b) {
            const outer=hitSphere(at,extent,o,d,a,b);
            return outer ? [outer,feather && hitSphere(at,radius,o,d,a,b)] : [];
          } };
      };
    }
    if (zone.type==='path') {
      const radius=Array.isArray(zone.radius)?zone.radius:[zone.radius,zone.radius];
      if(radius.length!==2) throw new TypeError('Cutout path radius needs one value or two endpoints');
      const widened=Array.from(radius,r=>number(r,Number.MIN_VALUE,1e6,'Cutout path radius')+feather);
      const field=geometry.fromPath({ path:zone.path, points:zone.points, radius:widened, aspect:zone.aspect, feather });
      const bounds=field.bounds;
      return () => ({ bounds, gain:(x,y,z)=>1-(1-retain)*field.sample(x,y,z),
        ranges(o,d,a,b) {
          if (!hitBox(bounds,o,d,a,b)) return [];
          const spans=[];
          for (const box of field.segmentBounds) {
            const hit=hitBox(box,o,d,a,b);
            if (hit) spans.push(hit);
          }
          return spans;
        } });
    }
    if (zone.type==='box' || zone.type==='sdf') {
      const core=volume.bounds(zone.bounds??zone), bounds=expand(core,feather);
      let distance=(x,y,z)=>Math.hypot(Math.max(core.min[0]-x,0,x-core.max[0]),
        Math.max(core.min[1]-y,0,y-core.max[1]),Math.max(core.min[2]-z,0,z-core.max[2]));
      if (zone.type==='sdf') {
        const sdf=zone.field;
        distance=typeof sdf==='function'?sdf:sdf?.sdf?.bind(sdf)??sdf?.sd?.bind(sdf);
        if (typeof distance!=='function') throw new TypeError('An SDF cutout needs a signed-distance function');
      }
      return time => ({ bounds, gain(x,y,z) {
        return gain(number(distance(x,y,z,time),-Infinity,Infinity,'Cutout distance'));
      },ranges(o,d,a,b) {
        const outer=hitBox(bounds,o,d,a,b);
        return outer ? [outer,feather && hitBox(core,o,d,a,b)] : [];
      } });
    }
    throw new TypeError('Volume cutout needs a sphere, box, path or sdf');
  }

  function channel(zones) {
    if (!zones.length) return null;
    function gain(x,y,z) {
      let value=1;
      for (const zone of zones) {
        if (!outside(zone.bounds,x,y,z)) value=Math.min(value,zone.gain(x,y,z));
        if (!value) break;
      }
      return value;
    }
    function ray(origin, direction, start, end) {
      const knots=[];
      for (const zone of zones) for (const range of zone.ranges(origin,direction,start,end))
        if (range) knots.push(...range);
      if (!knots.length) return null;
      knots.sort((a,b)=>a-b);
      function distance(from,to,baseline) {
        if (!(to>from)) return 0;
        let sum=0, lo=from;
        function span(hi) {
          const size=(hi-lo)*.25;
          if (!(size>0)) return;
          for (let i=0;i<4;i++) {
            const d=lo+(i+.5)*size;
            const x=origin[0]+direction[0]*d,y=origin[1]+direction[1]*d,z=origin[2]+direction[2]*d;
            const length=baseline ? baseline(lo+i*size,lo+(i+1)*size) : size;
            sum+=gain(x,y,z)*length;
          }
          lo=hi;
        }
        // Outside the cutouts' bounding intervals the original integration is exact.
        const first=knots[0], last=knots.at(-1);
        if (to<=first||from>=last) return baseline?baseline(from,to):Math.max(0,to-from);
        if (from<first) {
          sum+=baseline?baseline(from,first):first-from;
          lo=first;
        }
        const end=Math.min(to,last);
        for (const t of knots) if (t>lo&&t<end) span(t);
        span(end);
        if (to>last) sum+=baseline?baseline(last,to):to-last;
        return sum;
      }
      return { distance };
    }
    return { gain, ray };
  }

  function compile(source) {
    if (source?.[brand]) return source;
    if (!Array.isArray(source?.zones)) throw new TypeError('Volume cutouts need a zones array');
    const all=Array.from(source.zones,(zone,index)=>{
      if (!zone || typeof zone!=='object') throw new TypeError('Invalid volume cutout');
      const { feather=.32, retain=0, affects='both' }=zone;
      number(feather,0,1e6,'Cutout feather');
      number(retain,0,1,'Cutout retained density');
      if (!['fog','cloud','both'].includes(affects)) throw new RangeError('Cutout affects must be fog, cloud or both');
      return { index,id:typeof zone.id==='string' ? zone.id : null,type:zone.type,affects,frame:shape(zone,feather,retain),retain };
    }).filter(zone=>zone.retain<1);
    return Object.freeze({ [brand]:true, frame(time=0) {
      if (!Number.isFinite(time)) throw new RangeError('Volume cutout time must be finite');
      const fog=[], cloud=[];
      const sampled = all.map(({frame,...zone}) => {
        const sample=frame(time);
        if (zone.affects!=='cloud') fog.push(sample);
        if (zone.affects!=='fog') cloud.push(sample);
        return { ...zone,sample };
      });
      const fogChannel=channel(fog), cloudChannel=channel(cloud);
      return { fog:fogChannel, cloud:cloudChannel, inspect(x,y,z) {
        const zones=sampled.flatMap(({sample,...zone}) => {
          if (outside(sample.bounds,x,y,z)) return [];
          const gain=sample.gain(x,y,z);
          return gain>=1 ? [] : [{...zone,gain}];
        });
        return { fog:fogChannel?.gain(x,y,z) ?? 1,cloud:cloudChannel?.gain(x,y,z) ?? 1,zones };
      } };
    } });
  }
  function settings(authored,override) {
    const source=override===true ? authored : override??authored;
    return !source ? null : compile(source);
  }

  return Object.freeze({ compile, settings });
})();
if (typeof module !== 'undefined') module.exports = VolumeCutouts;
