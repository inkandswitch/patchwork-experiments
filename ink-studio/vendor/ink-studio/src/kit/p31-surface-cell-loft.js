/* Close fitted chart footprints between two levels on the same carrier. Caps
   and side walls share their sampled perimeter, including clipped cell edges. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { V } = K;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  function build(layout, spec, out, emitPrism) {
    const {
      sample,
      levels = [0, 1],
      step = Infinity,
      budget = 150000,
      planar = false,
      metadata = { surface: 'fitted-piece' }
    } = spec || {};
    if (
      !Array.isArray(layout?.cells) ||
      typeof sample !== 'function' ||
      !Array.isArray(levels) || levels.length !== 2 || !levels.every(Number.isFinite) || levels[1] <= levels[0] ||
      typeof step !== 'number' || !(step > 0) ||
      !Number.isSafeInteger(budget) || budget < 1 || budget > 1000000
    ) throw new Error('Surface cell lofts need a carrier, ordered levels and a bounded triangle budget');
    let emitted = 0;
    function pair(uv, key) {
      const points = levels.map(level => sample(uv, level, key));
      if (!points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)))
        throw new Error('Surface cell carrier samples must be finite 3D points');
      return { uv, points };
    }
    for (const cell of layout.cells) {
      const meta = typeof metadata === 'function' ? metadata(cell.key) : metadata;
      for (const polygon of cell.fragments) {
        if(emitPrism&&(typeof planar==='function'?planar(cell.key,polygon):planar)){
          if(++emitted>budget)throw new RangeError('Surface cell prisms exceed their piece budget');
          emitPrism(cell.key,polygon.map(uv=>pair(uv,cell.key)),()=>true);
          continue;
        }
        const center = polygon.reduce((sum, uv) => [sum[0] + uv[0] / polygon.length, sum[1] + uv[1] / polygon.length], [0, 0]);
        const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const rings = Math.max(1, Math.ceil(Math.max(...polygon.map(uv => distance(uv, center))) / step));
        const sections = polygon.map((a, i) => Math.max(1, Math.ceil(distance(a, polygon[(i + 1) % polygon.length]) / step)));
        const count = sections.reduce((sum, size) => sum + size, 0);
        const cost=emitPrism?count*(rings*2-1):count*rings*4;
        if(emitted+cost>budget){
          if(emitPrism)throw new RangeError('Surface cell prisms exceed their piece budget');
          throw new Error('Surface cell loft exceeds its triangle budget');
        }
        emitted+=cost;
        const boundary = polygon.flatMap((a, i) => {
          const b = polygon[(i + 1) % polygon.length];
          return Array.from({ length: sections[i] }, (_, j) => mix(a, b, j / sections[i]));
        });
        const middle = pair(center, cell.key), shell = boundary.map(uv => pair(uv, cell.key));
        const edgeEnds=emitPrism&&new Map(shell.map((a,i)=>[a,shell[(i+1)%count]]));
        const along = V.sub(middle.points[1], middle.points[0]);
        let winding = 0;
        for (let i = 0; i < count; i++) {
          const a = V.sub(shell[i].points[1], middle.points[1]);
          const b = V.sub(shell[(i + 1) % count].points[1], middle.points[1]);
          const value = V.dot(V.cross(a, b), along);
          if (Math.abs(value) > Math.abs(winding)) winding = value;
        }
        if (winding === 0) throw new Error('Surface cell carrier levels must enclose a volume');
        function triangle(a, b, c, layers) {
          if (winding < 0) {
            [b, c] = [c, b];
            layers = [layers[0], layers[2], layers[1]];
          }
          out.triangle(a.points[layers[0]], b.points[layers[1]], c.points[layers[2]], meta, [a.uv, b.uv, c.uv]);
        }
        function cap(a, b, c) {
          if(emitPrism)emitPrism(cell.key,[a,b,c],(u,v)=>edgeEnds.get(u)===v||edgeEnds.get(v)===u);
          else{
            triangle(a, b, c, [1, 1, 1]);
            triangle(a, c, b, [0, 0, 0]);
          }
        }
        let inner = null;
        for (let ring = 1; ring <= rings; ring++) {
          const outer = ring === rings ? shell : boundary.map(uv => pair(mix(center, uv, ring / rings), cell.key));
          for (let i = 0; i < count; i++) {
            const j = (i + 1) % count;
            if (inner) {
              cap(inner[i], outer[i], outer[j]);
              cap(inner[i], outer[j], inner[j]);
            } else cap(middle, outer[i], outer[j]);
          }
          inner = outer;
        }
        if(emitPrism)continue;
        for (let i = 0; i < count; i++) {
          const a = shell[i], b = shell[(i + 1) % count];
          triangle(a, b, b, [0, 0, 1]);
          triangle(a, b, a, [0, 1, 1]);
        }
      }
    }
    return out;
  }

  function loft(layout,spec,out=P.geometry.builder()){
    return build(layout,spec,out,null);
  }

  // The sampled caps use local vertical columns. Internal tessellation edges
  // stay unpadded when the resulting prisms are used as contact keepouts.
  function prisms(layout,spec){
    const result=[];
    build(layout,spec,null,(key,vertices,exterior)=>{
      const lower=vertices.map(v=>v.points[0]),upper=vertices.map(v=>v.points[1]);
      const planes=P.geometry.heightPrismPlanes({lower,upper}).map(plane=>{
        const i=plane.edge;
        return {...plane,exterior:plane.kind!=='side'||exterior(vertices[i],vertices[(i+1)%vertices.length])};
      });
      const points=lower.concat(upper), axes=[0,1,2];
      const bounds={min:axes.map(i=>Math.min(...points.map(p=>p[i]))),max:axes.map(i=>Math.max(...points.map(p=>p[i])))};
      result.push({key,planes,bounds});
    });
    return result;
  }

  P.surfaceCells.loft=loft;
  P.surfaceCells.prisms=prisms;
})(KIT);
