/* Fit reusable relief layers in the local chart of a closed panel. */
(function (K) {
  const P = K.procedural || K.authoring;
  const finite = (value, length) => Array.isArray(value) && value.length === length &&
    Array.from(value).every(Number.isFinite);
  const motif = polygon => Array.isArray(polygon) && polygon.length>=3 && polygon.length<=128 &&
    Array.from(polygon).every(pt => finite(pt,2) && pt.every(v => v >= 0 && v <= 1));

  function panelRelief({outline, layers, base=0, depthScale=1, budget=256}={}) {
    if (!Array.isArray(outline) || outline.length<3 || outline.length>128 ||
        !Array.from(outline).every(pt=>finite(pt,2)) ||
        !Number.isFinite(base) || !Number.isFinite(depthScale) || depthScale<=0 ||
        !Number.isSafeInteger(budget) || budget<1 || budget>4096 ||
        !Array.isArray(layers) || layers.length>budget)
      throw new Error('Panel relief needs a finite outline, layers and a bounded positive depth scale');
    const x=outline.map(pt=>pt[0]), y=outline.map(pt=>pt[1]);
    const min=[Math.min(...x),Math.min(...y)], size=[Math.max(...x)-min[0],Math.max(...y)-min[1]];
    if (size.some(v=>!Number.isFinite(v)||v<=0)) throw new Error('Panel relief needs a nonzero chart');
    const keys=new Set(), parts=[];
    const fit=polygon=>polygon.map(([u,v])=>[min[0]+u*size[0],min[1]+v*size[1]]);
    for (const layer of layers) {
      const {key,material,polygon,holes=[],levels}=layer||{};
      if (typeof key!=='string'||!key||keys.has(key)||typeof material!=='string'||!material||
          !motif(polygon)||!Array.isArray(holes)||holes.length>4096||!Array.from(holes).every(motif)||
          !finite(levels,2)||levels[0]>=levels[1])
        throw new Error('Relief layers need unique keys, material roles, normalized polygons and ordered levels');
      keys.add(key);
      const [lo,hi]=levels.map(level=>base+level*depthScale);
      if (!Number.isFinite(lo)||!Number.isFinite(hi)||lo>=hi)
        throw new Error('Relief levels must remain finite and distinct after scaling');
      const {cells}=P.surfaceCells.clip([{key,polygon:fit(polygon)}],{
        boundary:outline,holes:holes.map(fit),budget:Math.max(1,budget-parts.length)
      });
      const fragments=cells[0]?.fragments||[];
      if (parts.length+fragments.length>budget) throw new RangeError('Panel relief exceeds its fragment budget');
      for (const [i,outer] of fragments.entries()) parts.push({key,fragment:i,material,lo,hi,outer});
    }
    return P.data.freeze(parts);
  }

  P.panelRelief=panelRelief;
})(KIT);
