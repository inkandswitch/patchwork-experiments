/* Seeded cloud shapes, baked once into the shared XZ coverage grid. */
const CloudRecipes = (() => {
  const clamp = n => Math.max(0, Math.min(1,n));
  const lerp = (a,b,t) => a+(b-a)*t;
  const smooth = (lo,hi,n) => {
    const u = clamp((n-lo)/(hi-lo));
    return u*u*(3-2*u);
  };
  const presets = {
    cirrus: { height:27, thickness:.95, scale:15, stretch:6.5, heading:-.22, coverage:.33,
      edgeBreakup:.56, velocity:[1.3,.34], color:'#9fb8d4', opacity:.63,
      lighting:{ color:'#fff2dc', ambient:.38, strength:.56, rim:.32 } },
    'coastal-stratus': { height:8.2, thickness:1.6, scale:22, stretch:2.8, heading:.14, coverage:.65,
      edgeBreakup:.25, velocity:[.64,.38], color:'#8193a8', opacity:.9,
      lighting:{ color:'#d9e4ee', ambient:.25, strength:.48, rim:.14 } },
    cumulus: { height:13, thickness:7.8, steps:28, scale:20, stretch:1, heading:0, coverage:.48,
      edgeBreakup:.48, velocity:[.44,.31], color:'#8095bc', opacity:.98,
      lighting:{ color:'#fff6e4', ambient:.32, strength:.78, rim:.37 } },
    'storm-front': { height:11, thickness:7.4, steps:20, scale:28, stretch:2.65, heading:.12, coverage:.69,
      edgeBreakup:.67, velocity:[1.12,.24], color:'#29334e', opacity:1,
      lighting:{ color:'#a6aabd', ambient:.10, strength:.52, rim:.29 } }
  };
  function hash(x,z,seed) {
    const n = Math.imul(x,374761393) ^ Math.imul(z,668265263) ^ Math.imul(seed,1013904223);
    return (Math.imul(n ^ n>>>13,1274126177)>>>0)/4294967296;
  }
  function noise(x,z,seed) {
    const i = Math.floor(x), j = Math.floor(z), u = smooth(0,1,x-i), v = smooth(0,1,z-j);
    return lerp(lerp(hash(i,j,seed),hash(i+1,j,seed),u),lerp(hash(i,j+1,seed),hash(i+1,j+1,seed),u),v);
  }
  function layered(x,z,seed) {
    return .59*noise(x,z,seed) + .28*noise(2.1*x+9.1,2.1*z-4.4,seed+7) +
      .13*noise(4.4*x-6.7,4.4*z+2.3,seed+23);
  }
  function billows(x,z,seed) {
    const i = Math.floor(x), j = Math.floor(z);
    let shape = 0;
    for (let dz=-1; dz<=1; dz++) for (let dx=-1; dx<=1; dx++) {
      const ix=i+dx, iz=j+dz;
      const a=ix+.14+.72*hash(ix,iz,seed+31), b=iz+.14+.72*hash(ix,iz,seed+57);
      const radius=.29+.44*hash(ix,iz,seed+93);
      shape=Math.max(shape,1-Math.hypot(x-a,z-b)/radius);
    }
    return .73*shape + .27*layered(x*1.65,z*1.65,seed+12);
  }
  const patterns = {
    cirrus(x,z,seed) {
      const curl = .93*(noise(x*.8,z*.42,seed+5)-.5);
      const main = layered(.8*x,2.8*z+curl,seed);
      return .81*main + .19*noise(x*2.4,(z+curl)*7.6,seed+8);
    },
    'coastal-stratus'(x,z,seed) {
      const swell = .35*(noise(x*.56,z*.45,seed+2)-.5);
      return .79*layered(x,z*.76,seed) + .21*noise(.82*x,2.65*z+swell,seed+8);
    },
    cumulus(x,z,seed) {
      const bend = .24*(noise(x*1.8,z*1.8,seed+17)-.5);
      return billows(x+bend,z-bend,seed);
    },
    'storm-front'(x,z,seed) {
      const axis = z + .80*(noise(x*.92,1.17,seed+7)-.5) + .21*(noise(x*3.1,1.7,seed+41)-.5);
      const shelf = smooth(-1.65,-.54,axis) * (1-smooth(.14,1.46,axis));
      return shelf*(.27 + .55*layered(x*1.1,z*1.84,seed) + .39*billows(x*1.74,z*1.7,seed+11));
    }
  };
  const bounded = (value,min,max,label) => {
    if (!Number.isFinite(value) || value<min || value>max) throw new RangeError('Cloud recipe ' + label + ' is out of range');
    return value;
  };
  function resolve(descriptor) {
    const { recipe, seed=1, bounds={ min:[-160,-160], max:[160,160] }, resolution=[192,192],
      shape={}, repeat=false } = descriptor;
    if (typeof recipe!=='string' || !Object.hasOwn(presets,recipe)) throw new RangeError('Unknown cloud recipe: ' + recipe);
    if (!Number.isSafeInteger(seed) || seed < -0x80000000 || seed > 0x7fffffff) throw new RangeError('Cloud recipe seed must be a signed 32-bit integer');
    if (!shape || Object.getPrototypeOf(shape)!==Object.prototype ||
        Object.keys(shape).some(key => !['scale','stretch','heading','center'].includes(key)))
      throw new TypeError('Cloud recipe shape needs scale, stretch, heading or center');
    const d=presets[recipe], min=bounds?.min, max=bounds?.max;
    if (![min,max].every(p=>Array.isArray(p)&&p.length===2&&Array.from(p).every(Number.isFinite)))
      throw new TypeError('Cloud recipe bounds need finite XZ vectors');
    const { coverage=d.coverage, edgeBreakup=d.edgeBreakup, height=d.height, thickness=d.thickness,
      opacity=d.opacity, color=d.color, velocity=d.velocity, visible, steps=d.steps } = descriptor;
    const { scale=d.scale, stretch=d.stretch, heading=d.heading,
      center=min.map((n,i)=>n*.5+max[i]*.5) } = shape;
    const lighting = descriptor.lighting === false ? false : { ...d.lighting, ...descriptor.lighting };
    if (descriptor.lighting !== undefined && descriptor.lighting !== false &&
        (!descriptor.lighting || Object.getPrototypeOf(descriptor.lighting)!==Object.prototype))
      throw new TypeError('Cloud recipe lighting must be an object or false');
    if (!Array.isArray(center)||center.length!==2||!Array.from(center).every(Number.isFinite))
      throw new TypeError('Cloud recipe center needs finite XZ coordinates');
    bounded(scale,.01,1e6,'shape scale');
    bounded(stretch,.05,100,'shape stretch');
    bounded(heading,-1e6,1e6,'shape heading');
    bounded(coverage,0,1,'coverage');
    bounded(edgeBreakup,0,1,'edge breakup');
    const cosine=Math.cos(heading), sine=Math.sin(heading), pattern=patterns[recipe];
    const threshold=lerp(.92,.12,coverage);
    const compute=(x,z) => {
      if (coverage===0) return 0;
      const dx=x-center[0], dz=z-center[1];
      const u=(dx*cosine+dz*sine)/(scale*stretch), v=(-dx*sine+dz*cosine)/scale;
      const breaking=edgeBreakup*(layered(u*7.5+17,v*8.2-20,seed+19)-.53);
      const mask=smooth(threshold-.09,threshold+.21,pattern(u,v,seed)+breaking*.56);
      if (repeat) return mask;
      const edge=Math.min((x-min[0])/(max[0]-min[0]),(max[0]-x)/(max[0]-min[0]),
        (z-min[1])/(max[1]-min[1]),(max[1]-z)/(max[1]-min[1]));
      return mask*smooth(0,.085,edge);
    };
    return { bounds, resolution, coverage:compute, repeat, height, thickness, opacity, color, velocity, visible, steps, lighting };
  }

  return Object.freeze({ names:Object.freeze(Object.keys(presets)), resolve });
})();
if (typeof module !== 'undefined') module.exports = CloudRecipes;
