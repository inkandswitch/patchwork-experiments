/* Camera-depth envelopes around world-space optical density. */
const AtmosphereDepthBands = (() => {
  const name = /^[a-zA-Z][ a-zA-Z0-9_-]{0,79}$/;
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const clamp = n => Math.max(0,Math.min(1,n));
  const smooth = n => { const t=clamp(n); return t*t*(3-2*t); };
  const within = (value,min,max) => Number.isFinite(value) && value >= min && value <= max;
  function fields(value, keys, label) {
    if (!plain(value) || Object.keys(value).some(key=>!keys.includes(key)))
      throw new TypeError('Invalid atmosphere depth band '+label);
    return value;
  }
  function interval(value,min,max,label) {
    if (!Array.isArray(value) || value.length!==2 || !Array.from(value).every(n=>within(n,min,max)) || value[0]>=value[1])
      throw new RangeError('Atmosphere depth band '+label+' needs two increasing scene distances');
    return value.slice();
  }
  function feather(value, span, label) {
    const sides=Array.isArray(value) ? value : [value,value];
    if (sides.length!==2 || !Array.from(sides).every(n=>within(n,0,span)) || sides[0]+sides[1]>span)
      throw new RangeError('Atmosphere depth band '+label+' needs nonnegative distances within its range');
    return sides.slice();
  }
  function texture(value) {
    if (value === undefined || value === false) return null;
    const { scale=2, strength=.85, seed=0, velocity=[0,0,0], windInfluence=0 } =
      fields(value,['scale','strength','seed','velocity','windInfluence'],'texture');
    const size=Array.isArray(scale) ? scale : [scale,scale,scale];
    if (!xyz(size) || !size.every(n=>within(n,.01,1e5)) || !within(strength,0,1) ||
        !Number.isSafeInteger(seed) || !xyz(velocity) || !velocity.every(n=>Math.abs(n)<=1e4) || !within(windInfluence,0,4))
      throw new RangeError('Invalid depth band texture scale, strength, seed or motion');
    return strength ? { scale:size.slice(), strength, seed, velocity:velocity.slice(), windInfluence } : null;
  }
  function settings(authored,override,palette) {
    const value=override===true ? authored : override ?? authored;
    if (value===undefined || value===false) return [];
    if (!Array.isArray(value) || value.length>16) throw new TypeError('Atmosphere depth bands need a list of up to 16 bands');
    const ids=new Set();
    return Array.from(value,item=>{
      const { id, depth, height, density=.06, color='#a7bdcc', texture:pattern, step, tags } =
        fields(item,['id','depth','feather','height','heightFeather','density','color','texture','step','tags'],'settings');
      if (typeof id!=='string' || !name.test(id) || ids.has(id)) throw new TypeError('Atmosphere depth bands require unique named IDs');
      ids.add(id);
      const validColor=typeof color==='string' && /^#[a-f0-9]{6}$/i.test(color) ||
        Number.isSafeInteger(color) && color>=0 && (!palette || color<palette.length) ||
        xyz(color) && color.every(n=>within(n,0,1));
      if (!validColor || !within(density,0,8) || step!==undefined && !within(step,.015,100) ||
          tags!==undefined && (!Array.isArray(tags) || !Array.from(tags).every(tag=>typeof tag==='string' && tag.trim())))
        throw new RangeError('Invalid depth band color, density, step or tags');
      const band=interval(depth,0,1e5,'depth'), span=band[1]-band[0];
      const elevation=height===undefined ? null : interval(height,-1e5,1e5,'height');
      if (!elevation && item.heightFeather!==undefined) throw new TypeError('Depth band height feather needs a height range');
      return { id,depth:band,density,color:Array.isArray(color)?color.slice():color, tags:tags?.slice(),
        feather:feather(item.feather??Math.min(2,span*.16),span,'feather'),
        height:elevation,heightFeather:elevation && feather(item.heightFeather??0,elevation[1]-elevation[0],'height feather'),
        texture:texture(pattern),step };
    });
  }

  function envelope(position,range,feathers) {
    const [from,to]=range, [enter,exit]=feathers;
    return (enter ? smooth((position-from)/enter) : 1)*(exit ? smooth((to-position)/exit) : 1);
  }

  function frame(bands,{origin,forward},time,seed,noiseFor) {
    if (!bands.length) return [];
    const length=xyz(forward) && Math.hypot(...forward);
    if (!xyz(origin) || !length || !Number.isFinite(length) || !Number.isFinite(time))
      throw new TypeError('Depth bands need a nominal camera origin, forward direction and finite time');
    const axis=forward.map(n=>n/length), offset=dot(origin,axis);
    return bands.filter(band=>band.density>0).map(band=>{
      const { id,depth,feather,height,heightFeather,density,color,texture,tags }=band;
      const fade=feather.some(Boolean), fadeHeight=heightFeather?.some(Boolean);
      const pattern=texture && noiseFor(texture.scale,(seed+texture.seed)|0);
      const vx=(texture?.velocity[0]??0)*time, vy=(texture?.velocity[1]??0)*time, vz=(texture?.velocity[2]??0)*time;
      const wind=texture?.windInfluence??0;
      const scales=[...feather,...(heightFeather??[]),...(texture?.scale??[])].filter(n=>n>0);
      const step=band.step??Math.max(.015,Math.min(1.25,...scales.map(n=>n*.44)));
      const sample=fade||fadeHeight||pattern ? (x,y,z,options)=>{
        const at=x*axis[0]+y*axis[1]+z*axis[2]-offset;
        const weight=(fade ? envelope(at,depth,feather) : 1)*(fadeHeight ? envelope(y,height,heightFeather) : 1);
        if (!pattern || !weight) return weight;
        const drift=wind && options?.windOffset?.(x,y,z);
        const dx=wind ? wind*(drift?.[0]??(options?.wind?.[0]??0)*time) : 0;
        const dz=wind ? wind*(drift?.[1]??(options?.wind?.[1]??0)*time) : 0;
        const noise=.52+.92*pattern(x-vx-dx,y-vy,z-vz-dz);
        const textured=smooth((noise-.18)/.67);
        return weight*(1-texture.strength+textured*texture.strength);
      } : undefined;
      return { type:'fog',id,mediumKind:'fog',tags,color,density,bottom:height?.[0],top:height?.[1],
        depthBand:{ axis, low:offset+depth[0], high:offset+depth[1], step,sample,wind } };
    });
  }

  return Object.freeze({settings,frame});
})();
if (typeof module !== 'undefined') module.exports = AtmosphereDepthBands;
