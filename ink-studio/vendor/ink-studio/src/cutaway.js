/* A shared cutaway predicate for native fragments and contribution rays. */
const Cutaway = (() => {
  const maxPlanes = 8, maxRegions = 8, unbounded = 1e30;
  const prepared = new WeakSet();
  const finite = n => Number.isFinite(n) && Math.abs(n) < 1e20;
  const xyz = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(finite);
  function check(ok,message) {
    if (!ok) throw new TypeError('Cutaway: ' + message);
  }
  const shape = (o,keys) => o && typeof o === 'object' && !Array.isArray(o) &&
    Object.keys(o).every(key => keys.includes(key));
  const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  function plane(row) {
    check(shape(row,['normal','point','offset','keep']) && xyz(row.normal), 'expected a section plane with an XYZ normal');
    const { normal,point,offset,keep = 'positive' } = row;
    const length = Math.hypot(...normal);
    check(length > 1e-9 && (point === undefined || xyz(point)) &&
      (offset === undefined || finite(offset) && point === undefined) &&
      (keep === 'positive' || keep === 'negative'),'invalid plane position or kept side');
    const norm = normal.map(n => n/length), sign = keep === 'positive' ? 1 : -1;
    return Object.freeze([...norm.map(n=>Math.fround(n*sign)),Math.fround(sign*(point ? -dot(norm,point) : -(offset ?? 0)))]);
  }
  function region(row) {
    if (row?.type === 'sphere') {
      check(shape(row,['type','center','radius']) && xyz(row.center) && finite(row.radius) && Math.fround(row.radius)>0,
        'expected a sphere center and positive radius');
      return Object.freeze({ a:Object.freeze([...row.center.map(Math.fround),Math.fround(row.radius)]), b:Object.freeze([0,0,0,0]) });
    }
    check(shape(row,['type','min','max']) && row.type === 'box' && xyz(row.min) && xyz(row.max) &&
      row.min.every((n,i)=>Math.fround(n)<Math.fround(row.max[i])),'expected an ordered XYZ box or sphere');
    return Object.freeze({ a:Object.freeze([...row.min.map(Math.fround),0]), b:Object.freeze([...row.max.map(Math.fround),0]) });
  }

  function prepare(definition) {
    if (definition === undefined || definition === false || definition === null) return null;
    if (prepared.has(definition)) return definition;
    check(shape(definition,['planes','depth','regions','edge']),'expected planes, depth, regions or edge');
    const { planes = [], depth, regions = {}, edge } = definition;
    check(Array.isArray(planes) && planes.length <= maxPlanes,'too many section planes');
    check(shape(regions,['include','exclude']),'expected include and exclude region lists');
    const { include=[],exclude=[] } = regions;
    check(Array.isArray(include) && Array.isArray(exclude) && include.length+exclude.length <= maxRegions,
      'too many region masks');
    let range = null, style = null;
    if (depth !== undefined) {
      check(Array.isArray(depth) && depth.length === 2 && Array.from(depth).every(n=>n === null || finite(n)) &&
        (depth[0] === null || depth[1] === null || Math.fround(depth[0]) < Math.fround(depth[1])),
        'depth needs increasing near and far distances, with null for an open end');
      if (depth[0] !== null || depth[1] !== null)
        range = Object.freeze([depth[0] === null ? -unbounded : Math.fround(depth[0]),
          depth[1] === null ? unbounded : Math.fround(depth[1])]);
    }
    if (edge !== undefined && edge !== false) {
      check(shape(edge,['color','width','strength']),'expected a section edge style');
      const { color='#ffbf70',width=.035,strength=1 } = edge;
      check(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && finite(width) && Math.fround(width)>0 &&
        Number.isFinite(strength) && strength>=0 && strength<=1,'invalid section edge color, width or strength');
      if (strength>0) style=Object.freeze({ width:Math.fround(width), strength,
        color:Object.freeze([1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)) });
    }
    const section=Object.freeze({ planes:Object.freeze(Array.from(planes,plane)), range,
      include:Object.freeze(Array.from(include,region)), exclude:Object.freeze(Array.from(exclude,region)), edge:style });
    if (!section.planes.length && !range && !include.length && !exclude.length) return null;
    prepared.add(section);
    return section;
  }

  function regionDistance({a,b},x,y,z) {
    return a[3]>0 ? a[3]-Math.hypot(x-a[0],y-a[1],z-a[2]) :
      Math.min(x-a[0],y-a[1],z-a[2],b[0]-x,b[1]-y,b[2]-z);
  }

  // A nonnegative margin is retained. Its magnitude controls the optional section ink.
  function margin(section,x,y,z,depth) {
    const { range,planes,include,exclude } = section;
    let distance=range ? Math.min(depth-range[0],range[1]-depth) : unbounded;
    for (const [a,b,c,d] of planes) distance=Math.min(distance,a*x+b*y+c*z+d);
    if (include.length) {
      let union=-unbounded;
      for (const region of include) union=Math.max(union,regionDistance(region,x,y,z));
      distance=Math.min(distance,union);
    }
    for (const region of exclude) distance=Math.min(distance,-regionDistance(region,x,y,z));
    return distance;
  }

  function edgeWeight(edge,distance) {
    if (!edge || distance >= edge.width) return 0;
    const t = Math.max(0,distance/edge.width);
    return edge.strength*(1-t*t*(3-2*t));
  }

  function uniforms(section,setback=0) {
    const regions=[...section.include,...section.exclude];
    return {
      u_sectionCounts:[section.planes.length,section.include.length,regions.length],
      ...(section.planes.length && {u_sectionPlanes:section.planes.flat()}),
      ...(regions.length && {u_sectionRegionA:regions.flatMap(row=>row.a),u_sectionRegionB:regions.flatMap(row=>row.b)}),
      u_sectionDepth:section.range??[-unbounded,unbounded],u_sectionSetback:setback,
      u_sectionEdge:section.edge ? [...section.edge.color,section.edge.width] : [0,0,0,0],
      u_sectionStrength:section.edge?.strength??0
    };
  }

  const glsl = `
uniform ivec3 u_sectionCounts;
uniform vec4 u_sectionPlanes[${maxPlanes}], u_sectionRegionA[${maxRegions}], u_sectionRegionB[${maxRegions}];
uniform vec2 u_sectionDepth;
uniform float u_sectionSetback, u_sectionStrength;
uniform vec4 u_sectionEdge;
float sectionRegion(int i, vec3 p) {
  vec4 a = u_sectionRegionA[i];
  if (a.w > 0.0) return a.w - distance(a.xyz, p);
  vec3 d = min(p - a.xyz, u_sectionRegionB[i].xyz - p);
  return min(d.x, min(d.y, d.z));
}
float sectionMargin(vec3 p, float axial) {
  float depth = axial - u_sectionSetback;
  float allowed = min(depth - u_sectionDepth.x, u_sectionDepth.y - depth);
  for (int i = 0; i < ${maxPlanes}; i++) {
    if (i >= u_sectionCounts.x) break;
    allowed = min(allowed, dot(u_sectionPlanes[i], vec4(p, 1.0)));
  }
  float included = -1e30;
  for (int i = 0; i < ${maxRegions}; i++) {
    if (i >= u_sectionCounts.z) break;
    float region = sectionRegion(i, p);
    if (i < u_sectionCounts.y) included = max(included, region);
    else allowed = min(allowed, -region);
  }
  return u_sectionCounts.y > 0 ? min(allowed, included) : allowed;
}
float sectionInk(float margin) {
  return u_sectionEdge.w > 0.0 ? u_sectionStrength * (1.0 - smoothstep(0.0, u_sectionEdge.w, margin)) : 0.0;
}`;
  return Object.freeze({ prepare,margin,edgeWeight,uniforms,glsl });
})();
if (typeof module !== 'undefined') module.exports = Cutaway;
