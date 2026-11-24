/* Structural layouts in a 2D chart. Rails, posts and bay braces may be
   realized as timber, sheet profiles, grilles or any caller-chosen material. */
(function (K) {
  const P = K.procedural || K.authoring;
  const choices = new Set(['none', 'ascending', 'descending', 'alternating', 'cross']);
  const rimNames=['sill','header','start','end'];
  const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const pair = v => Array.isArray(v) && v.length === 2 && Array.from(v).every(Number.isFinite);
  const boxDistance = ([x0,y0], [x1,y1], u, v) => Math.max(x0-u, u-x1, y0-v, v-y1);

  function panelFrames({ width, height, unit, beam, braceWidth = beam, braces = 'none', periodic = false,
    openings = [], budget = 4096 } = {}) {
    if (!Number.isFinite(beam) || beam <= 0 || !Number.isFinite(braceWidth) || braceWidth <= 0 ||
        typeof braces !== 'function' && !choices.has(braces) ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 32768)
      throw new Error('Panel frames need finite member widths, a brace policy and a bounded budget');
    const layout = P.fittedCourses({ width, height, unit, periodic, budget });
    const [du, dv] = layout.unit;
    if (beam >= Math.min(du, dv) * .8 || braceWidth >= Math.min(du, dv) * .8)
      throw new Error('Panel frame members must leave room in each bay');
    if (!Array.isArray(openings) || openings.length > 64) throw new Error('Panel frames support up to 64 opening bounds');
    const cols = layout.rows[0].cells.length, rows = layout.rows.length;
    const parts = [], bracesByBay = new Map();
    const half = beam / 2;
    function add(key, role, polygon) {
      if (parts.length >= budget) throw new Error('Panel frames exceed their member budget');
      const part = { key, role, polygon };
      parts.push(part);
      return part;
    }
    for (let row = 0; row <= rows; row++) {
      const y = row * dv;
      add('rail/' + row, 'rail', rectangle(0, Math.max(0, y - half), width, Math.min(height, y + half)));
    }
    for (let column = 0; column <= cols; column++) {
      const x = column * du;
      add('post/' + (periodic ? column % cols : column), 'post',
        rectangle(Math.max(0, x - half), 0, Math.min(width, x + half), height));
    }
    for (const cell of layout.cells) {
      let policy = typeof braces === 'function' ? braces(cell) : braces;
      if (!choices.has(policy)) throw new Error('Unknown panel frame brace policy');
      if (policy === 'alternating') policy = (cell.row + cell.column) % 2 ? 'ascending' : 'descending';
      if (policy === 'none') continue;
      const min = cell.bounds.min.map(v => v + half), max = cell.bounds.max.map(v => v - half);
      const domain = rectangle(min[0], min[1], max[0], max[1]);
      const members = [];
      for (const side of policy === 'cross' ? ['ascending', 'descending'] : [policy]) {
        const a = [min[0], side === 'ascending' ? min[1] : max[1]];
        const b = [max[0], side === 'ascending' ? max[1] : min[1]];
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
        const x = dx / length * braceWidth / 2, y = dy / length * braceWidth / 2;
        const polygon = [
          [a[0] - x + y, a[1] - y - x], [b[0] + x + y, b[1] + y - x],
          [b[0] + x - y, b[1] + y + x], [a[0] - x - y, a[1] - y + x]
        ];
        const key = 'brace/' + cell.id + '/' + side;
        const footprint = P.surfaceCells.clip([{ key, polygon }], { boundary: domain, budget: 1 });
        if (footprint.cells.length) members.push(add(key, 'brace', footprint.cells[0].fragments[0]));
      }
      bracesByBay.set(cell.id, members);
    }
    const holes = [], rims = [], openingIds = new Set();
    for (const {key, min, max, rim = true, rimEdges = rimNames} of openings) {
      if (typeof key !== 'string' || !key || openingIds.has(key) || !pair(min) || !pair(max) ||
          min[0] >= max[0] || min[1] >= max[1] || periodic && max[0]-min[0] > width || typeof rim !== 'boolean')
        throw new Error('Panel openings need unique keys and ordered bounds within one chart period');
      if(!Array.isArray(rimEdges)||rimEdges.length>4||new Set(rimEdges).size!==rimEdges.length||
         !Array.from(rimEdges).every(edge=>rimNames.includes(edge)))
        throw new Error('Panel rim edges must be unique sill, header, start or end roles');
      openingIds.add(key);
      const full=periodic&&max[0]-min[0]===width;
      const wrap=full?0:periodic?((min[0]%width)+width)%width:min[0];
      for(const shift of periodic&&!full?[-width,0,width]:[0]){
        const x0=wrap+shift,x1=x0+max[0]-min[0],[,y0]=min,[,y1]=max;
        if(x0>width+beam || x1 < -beam || y0 > height+beam || y1 < -beam)continue;
        holes.push({min:[x0,y0],max:[x1,y1],full});
        if(!rim)continue;
        const prefix='opening/'+key+'/';
        for(const [name,role,a,b] of [
          ['sill','rail',[x0-beam,y0-beam],[x1+beam,y0]],
          ['header','rail',[x0-beam,y1],[x1+beam,y1+beam]],
          ['start','post',[x0-beam,y0],[x0,y1]],
          ['end','post',[x1,y0],[x1+beam,y1]]
        ]){
          if(!rimEdges.includes(name)||full&&(name==='start'||name==='end'))continue;
          const low=[Math.max(a[0],0),Math.max(a[1],0)],high=[Math.min(b[0],width),Math.min(b[1],height)];
          if(low[0]>=high[0]||low[1]>=high[1])continue;
          add(prefix+name,role,rectangle(...low,...high));
          rims.push({min:low,max:high,full});
        }
      }
    }
    const roles=new Map(parts.map(part=>[part.key,part.role]));
    const visibleParts=holes.length ? P.surfaceCells.clip(parts,{
      holes:holes.map(h=>rectangle(...h.min,...h.max)),budget,work:650000
    }).cells.flatMap(({key,fragments})=>fragments.map(polygon=>({key,role:roles.get(key),polygon}))) : parts;

    let exposed;
    function openingEdges(){
      if(exposed)return exposed;
      const epsilon=1e-7,lines=[new Map(),new Map()];
      function union(ranges){
        const joined=[];
        for(const [lo,hi] of ranges.sort((a,b)=>a[0]-b[0])){
          const last=joined.at(-1);
          if(last&&lo<=last[1]+epsilon)last[1]=Math.max(last[1],hi);
          else joined.push([lo,hi]);
        }
        return joined;
      }
      function addLine(axis,at,sign,low,high){
        const limit=axis?height:width,extent=axis?width:height;
        low=Math.max(0,low);high=Math.min(extent,high);
        if(at<=epsilon||at>=limit-epsilon||high-low<=epsilon)return;
        const index=Math.round(at/epsilon),map=lines[axis];
        let entries=map.get(index);
        if(!entries)map.set(index,entries=[]);
        let line=entries.find(item=>item.at===at&&item.sign===sign);
        if(!line)entries.push(line={at,sign,cutouts:[],ranges:[]});
        line.cutouts.push([low,high]);
      }
      for(const {min,max,full} of holes)for(const axis of [0,1]){
        if(full&&axis===0)continue;
        const across=1-axis;
        addLine(axis,min[axis],1,min[across],max[across]);
        addLine(axis,max[axis],-1,min[across],max[across]);
      }
      if(!lines.some(map=>map.size))return exposed=Object.freeze([]);
      for(const map of lines)for(const entries of map.values())for(const line of entries)
        line.cutouts=union(line.cutouts);
      for(const {polygon} of visibleParts)for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const axis=Math.abs(a[0]-b[0])<=epsilon?0:Math.abs(a[1]-b[1])<=epsilon?1:-1;
        if(axis<0)continue;
        const at=a[axis],index=Math.round(at/epsilon),across=1-axis,
          low=Math.min(a[across],b[across]),high=Math.max(a[across],b[across]),
          // The clipped fragments are counterclockwise. Match their outward
          // edge direction to the face of the aperture.
          sign=Math.sign(b[across]-a[across])*(axis?-1:1);
        for(let slot=index-1;slot<=index+1;slot++)for(const line of lines[axis].get(slot)||[]){
          if(sign!==line.sign||Math.abs(at-line.at)>epsilon||Math.abs(b[axis]-line.at)>epsilon)continue;
          for(const [start,end] of line.cutouts){
            const lo=Math.max(low,start),hi=Math.min(high,end);
            if(hi-lo>epsilon)line.ranges.push([lo,hi]);
          }
        }
      }
      const edges=[];
      for(const [axis,map] of lines.entries())for(const entries of map.values())for(const {at,sign,ranges} of entries){
        const uv=t=>axis?[t,at]:[at,t],normal=axis?[0,sign]:[sign,0];
        for(const [lo,hi] of union(ranges))edges.push({start:uv(lo),end:uv(hi),normal});
      }
      return exposed=P.data.freeze(edges);
    }

    function braceDistance(part, u, v) {
      let distance = -Infinity;
      const points = part.polygon;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        distance = Math.max(distance, ((u - a[0]) * dy - (v - a[1]) * dx) / Math.hypot(dx, dy));
      }
      return distance;
    }
    function distance(u, v) {
      const cell = layout.at(u, v);
      if (!cell) return Infinity;
      if (periodic) u = ((u % width) + width) % width;
      let d = Math.min(Math.abs(u - Math.round(u / du) * du), Math.abs(v - Math.round(v / dv) * dv)) - half;
      for (const part of bracesByBay.get(cell.id) || []) d = Math.min(d, braceDistance(part, u, v));
      const clearance=({min,max,full})=>full?Math.max(min[1]-v,v-max[1]):boxDistance(min,max,u,v);
      for(const rim of rims)d=Math.min(d,clearance(rim));
      for(const hole of holes)d=Math.max(d,-clearance(hole));
      const boundary = Math.max(periodic ? -Infinity : Math.max(-u, u - width), -v, v - height);
      return Math.max(boundary, d);
    }
    return P.data.freeze({ layout, parts:visibleParts, distance, openingEdges,
      postCount: periodic ? cols : cols + 1, railCount: rows + 1 });
  }

  P.panelFrames = panelFrames;
})(KIT);
