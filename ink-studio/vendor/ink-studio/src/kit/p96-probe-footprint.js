/* Track the regional reads of a sampled result as conservative boxes. */
(function(K) {
  const P=K.procedural || K.authoring;

  function probeFootprint({cell=.5,budget=512}={}) {
    if (!Number.isFinite(cell) || cell<=0 || !Number.isSafeInteger(budget) || budget<1 || budget>16384)
      throw new Error('A probe footprint needs a positive cell size and bounded budget');
    const cells=new Map();
    let overflow=null;
    function include(box, other) {
      for(let i=0;i<3;i++){
        box.min[i]=Math.min(box.min[i],other.min[i]);
        box.max[i]=Math.max(box.max[i],other.max[i]);
      }
    }
    function record(point,radius=0) {
      if (!Array.isArray(point) || point.length!==3 || !point.every(Number.isFinite) ||
          !Number.isFinite(radius) || radius<0)
        throw new Error('A probe needs a finite position and nonnegative radius');
      const bounds={min:point.map(v=>v-radius),max:point.map(v=>v+radius)};
      if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite))
        throw new Error('Probe bounds must stay finite');
      const key=point.map(v=>Math.floor(v/cell)).join('/');
      const present=cells.get(key);
      if(present)include(present,bounds);
      else if(cells.size<budget)cells.set(key,bounds);
      else if(overflow)include(overflow,bounds);
      else overflow=bounds;
    }
    function seal() {
      const regions=[...cells.values(),...(overflow?[overflow]:[])].map(b=>Object.freeze({
        min:Object.freeze(b.min.slice()),max:Object.freeze(b.max.slice())
      }));
      return Object.freeze({
        regions:Object.freeze(regions),
        intersects(bounds) {
          return regions.some(region=>P.spatial.overlap(region,bounds));
        }
      });
    }
    return Object.freeze({record,seal});
  }

  P.spatial.probeFootprint=probeFootprint;
})(KIT);
