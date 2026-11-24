/* Planar visibility paths and conservative clearance footprints, shared by authoring hosts. */
const RouteVisibility = (() => {
  const EPS = 1e-9,
    point = (p, n) => Array.isArray(p) && p.length === n && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    clamp = t => Math.max(0, Math.min(1, t)),
    plan = p => [p[0], p[2]],
    area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    dist2 = (a, b) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2,
    interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    bounds = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    overlap = (a, b) => a[0] <= b[2] + EPS && b[0] <= a[2] + EPS && a[1] <= b[3] + EPS && b[1] <= a[3] + EPS;

  // Clip one planar span against a convex ring's open interior.
  function convexInterval(a,b,edges,check){
    let low=0,high=1;
    const [ax,az]=a,[bx,bz]=b;
    for(const [x,z,nx,nz] of edges){
      check();
      const first=nx*(ax-x)+nz*(az-z)-EPS,last=nx*(bx-x)+nz*(bz-z)-EPS;
      if(first<=0&&last<=0)return null;
      if(first<=0)low=Math.max(low,first/(first-last));
      else if(last<=0)high=Math.min(high,first/(first-last));
      if(high-low<=EPS)return null;
    }
    return [low,high];
  }

  function convexRing(ring,check){
    const signed=ring.reduce((sum,p,i)=>sum+area2(ring[0],p,ring[(i+1)%ring.length]),0);
    if(Math.abs(signed)<=EPS)throw new Error('Prism footprints need positive area');
    const sign=Math.sign(signed),box=[Infinity,Infinity,-Infinity,-Infinity];
    const edges=ring.map(([x,z],i)=>{
      const [u,v]=ring[(i+1)%ring.length],dx=u-x,dz=v-z,len=Math.hypot(dx,dz);
      if(len<=EPS)throw new Error('Prism footprints need distinct successive points');
      const nx=-dz*sign/len,nz=dx*sign/len;
      for(const p of ring){
        check();
        if(nx*(p[0]-x)+nz*(p[1]-z)<-EPS)throw new Error('Prism footprints must be convex');
      }
      box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],z);
      box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],z);
      return [x,z,nx,nz];
    });
    return {box,edges};
  }

  function find(start, end, obstacles, {
    maxVertices = 600, maxTests = 2500000, links = [], waypoints = [], domain
  } = {}, acceptsEdge) {
    if (
      !point(start, 3) || !point(end, 3) || Math.hypot(...start.map((v, i) => end[i] - v)) <= EPS ||
      !Array.isArray(obstacles) || obstacles.length > 500 || !Array.isArray(links) || links.length > 64 ||
      !limit(maxVertices, 2, 3000) || !limit(maxTests, 1, 30000000) ||
      !Array.isArray(waypoints)
    ) throw new Error('Visibility paths need distinct finite pins, polygons, and work limits');
    const clearance=domain?.clearance, spacing=domain?.spacing??.12, minClearance=domain?.minClearance??0;
    if(domain!==undefined&&(typeof clearance!=='function'||!Number.isFinite(spacing)||spacing<=EPS||
      !Number.isFinite(minClearance)||minClearance<0))
      throw new Error('A visibility domain needs an XZ clearance field and valid sampling controls');
    if(waypoints.length+2>maxVertices)throw new Error('Visibility graph exceeds its vertex budget');
    if(!Array.from(waypoints).every(p=>point(p,2)))throw new Error('Visibility waypoints need finite XZ points');
    const first = plan(start), last = plan(end), vertices = [first, last,...waypoints],
      polygons = [], work = { pairs: 0, tests: 0 },
      exhausted = Symbol('visibility budget');
    for (const polygon of obstacles) {
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > maxVertices + 1 || !polygon.every(p => point(p, 2)))
        throw new Error('Visibility obstacles must be simple polygons with at least three XZ points');
      const loop = polygon.slice();
      if (dist2(loop[0], loop.at(-1)) <= EPS ** 2) loop.pop();
      const signedArea = loop.reduce((sum, p, i) => sum + area2(loop[0], p, loop[(i + 1) % loop.length]), 0);
      if (loop.length < 3 || loop.some((p, i) => dist2(p, loop[(i + 1) % loop.length]) <= EPS ** 2) ||
        Math.abs(signedArea) <= EPS)
        throw new Error('Visibility obstacles need a nondegenerate boundary');
      if (vertices.length + loop.length > maxVertices) throw new Error('Visibility graph exceeds its vertex budget');
      vertices.push(...loop);
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of loop) {
        box[0] = Math.min(box[0], p[0]);
        box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]);
        box[3] = Math.max(box[3], p[1]);
      }
      const sign = Math.sign(signedArea);
      // For a convex ring, its interior is the intersection of the signed
      // edge half-planes. Keep the original edge origin for stable distances.
      const convex = loop.every((p, i) => area2(p, loop[(i + 1) % loop.length],
        loop[(i + 2) % loop.length]) * sign >= 0);
      const edges = convex ? loop.map(([x, z], i) => {
        const next = loop[(i + 1) % loop.length], dx = next[0] - x, dz = next[1] - z,
          scale = sign / Math.hypot(dx, dz);
        return [x, z, -dz * scale, dx * scale];
      }) : null;
      polygons.push({ loop, box, edges });
    }
    const linksByVertex = new Map();
    let linkPoints = vertices.length;
    for (const [index, link] of links.entries()) {
      const through = Array.isArray(link?.through) ? Array.from(link.through) : [link?.through];
      const direction=link?.direction===undefined?'both':link.direction;
      if (!['forward','reverse','both'].includes(direction)||
          !point(link?.start, 2) || !point(link?.end, 2) || dist2(link.start, link.end) <= EPS ** 2 ||
          !through.length || through.length > polygons.length || new Set(through).size !== through.length ||
          through.some(id => !Number.isInteger(id) || id < 0 || id >= polygons.length))
        throw new Error('Visibility links need two distinct XZ points and valid obstacle indices');
      const via = link.via === undefined ? [] : link.via;
      if (!Array.isArray(via) || via.length > 16 || !Array.from(via).every(p => point(p, 2)))
        throw new Error('Visibility link waypoints need at most sixteen finite XZ points');
      const path = [link.start, ...via, link.end];
      let length = 0;
      for (let i = 1; i < path.length; i++) {
        const step = Math.sqrt(dist2(path[i-1], path[i]));
        if (step <= EPS) throw new Error('Visibility link waypoints must define nonzero spans');
        length += step;
      }
      linkPoints += path.length;
      if (linkPoints > maxVertices) throw new Error('Visibility graph exceeds its vertex budget');
      const a = vertices.push(link.start) - 1, b = vertices.push(link.end) - 1,
        bypass = new Set(through.map(id => polygons[id]));
      if(direction!=='reverse')linksByVertex.set(a, { next: b, index, bypass, path, length });
      if(direction!=='forward')linksByVertex.set(b, { next: a, index, bypass, path: path.slice().reverse(), length });
    }
    function check() {
      if (++work.tests > maxTests) throw exhausted;
    }
    const endpointAccess=domain&&new Map();
    function permits(x,z) {
      check();
      const value=clearance(x,z);
      if(typeof value!=='number'||Number.isNaN(value))throw new Error('A clearance field must return a signed distance');
      return value>=minClearance;
    }
    function permitsPoint(p){
      if(!endpointAccess.has(p))endpointAccess.set(p,permits(p[0],p[1]));
      return endpointAccess.get(p);
    }
    function inDomain(a,b,length){
      if(!permitsPoint(a)||!permitsPoint(b))return false;
      const steps=Math.ceil(length/spacing),dx=b[0]-a[0],dz=b[1]-a[1];
      for(let i=1;i<steps;i++){
        const t=i/steps;
        if(!permits(a[0]+t*dx,a[1]+t*dz))return false;
      }
      return true;
    }
    function inside(p, { loop, box, edges }) {
      if (!overlap(bounds(p, p), box)) return false;
      if (edges) {
        for (const [x, z, nx, nz] of edges) {
          check();
          if (nx * (p[0] - x) + nz * (p[1] - z) <= EPS) return false;
        }
        return true;
      }
      let odd = false;
      for (let i = 0; i < loop.length; i++) {
        check();
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if (Math.abs(area2(a, b, p)) <= EPS * Math.sqrt(dist2(a, b)) && overlap(bounds(a, b), bounds(p, p))) return false;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) odd = !odd;
      }
      return odd;
    }
    function clear(a, b, bypass) {
      work.pairs++;
      const box = bounds(a, b),
        dx = b[0] - a[0], dz = b[1] - a[1],
        sq = dx * dx + dz * dz;
      if (sq <= EPS * EPS) return !polygons.some(polygon => inside(a, polygon))&&(!domain||inDomain(a,b,0));
      for (const polygon of polygons) {
        if (bypass?.has(polygon) || !overlap(box, polygon.box)) continue;
        if (polygon.edges) {
          if (convexInterval(a, b, polygon.edges, check)) return false;
          continue;
        }
        const parameters = [0, 1], { loop } = polygon;
        for (let i = 0; i < loop.length; i++) {
          check();
          const c = loop[i], d = loop[(i + 1) % loop.length],
            ex = d[0] - c[0], ez = d[1] - c[1], rx = c[0] - a[0], rz = c[1] - a[1],
            determinant = dx * ez - dz * ex;
          if (Math.abs(determinant) > EPS * Math.sqrt(sq * (ex * ex + ez * ez))) {
            const t = (rx * ez - rz * ex) / determinant, u = (rx * dz - rz * dx) / determinant;
            if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) parameters.push(t);
          } else if (Math.abs(dx * rz - dz * rx) <= EPS * Math.sqrt(sq)) {
            parameters.push(clamp((rx * dx + rz * dz) / sq), clamp(((d[0] - a[0]) * dx + (d[1] - a[1]) * dz) / sq));
          }
        }
        parameters.sort((a, b) => a - b);
        for (let i = 1; i < parameters.length; i++) {
          if (parameters[i] - parameters[i - 1] <= EPS) continue;
          if (inside(interpolate(a, b, (parameters[i] + parameters[i - 1]) / 2), polygon)) return false;
        }
      }
      return (!acceptsEdge||acceptsEdge(a,b,check))&&(!domain||inDomain(a,b,Math.sqrt(sq)));
    }
    const result = (status, data = {}) => Object.freeze({ status, ...data, work: Object.freeze({ ...work }) });
    try {
      if ([first, last].some(p => (domain&&!permitsPoint(p))||polygons.some(polygon => inside(p, polygon))))
        return result('blocked-pin');
      if (clear(first, last)) return result('ok', { points: frozenPoints([start, end]) });
      const size = vertices.length,
        costs = new Float64Array(size).fill(Infinity), estimates = new Float64Array(size).fill(Infinity),
        parent = new Int32Array(size).fill(-1), used = new Map(), visited = new Uint8Array(size);
      const toEnd = vertices.map(p => Math.sqrt(dist2(p, last)));
      costs[0] = 0;
      estimates[0] = toEnd[0];
      for (;;) {
        // This visibility graph can be dense, so scan the bounded frontier.
        let id = -1, best = Infinity;
        for (let i = 0; i < size; i++) {
          if (!visited[i] && estimates[i] < best) {
            id = i;
            best = estimates[i];
          }
        }
        if (id === -1) break;
        const cost = costs[id];
        visited[id] = 1;
        if (id === 1) {
          const path = [1];
          for (let i = parent[1]; i >= 0; i = parent[i]) path.push(i);
          path.reverse();
          let travelled = 0;
          const points = [start], traversed = [];
          for (let i = 1; i < path.length; i++) {
            const a = vertices[path[i - 1]], b = vertices[path[i]], link = used.get(path[i]);
            const terminal = i === path.length - 1;
            if (!link && dist2(a, b) <= EPS * EPS) {
              if (terminal) points[points.length - 1] = end;
              continue;
            }
            const from = points.length - 1, leg = link?.path || [a,b];
            for (let j = 1; j < leg.length; j++) {
              const q = leg[j];
              travelled += Math.sqrt(dist2(leg[j-1],q));
              points.push(terminal && j === leg.length - 1
                ? end : [q[0], start[1] + (end[1] - start[1]) * travelled / cost, q[1]]);
            }
            if (link) traversed.push({ link: link.index, from, to: points.length - 1 });
          }
          return result('ok', { points: frozenPoints(points),
            ...(traversed.length && { links: Object.freeze(traversed.map(Object.freeze)) }) });
        }
        const tunnel = linksByVertex.get(id);
        for (let i = 1; i < size; i++) {
          if (visited[i]) continue;
          const a = vertices[id], b = vertices[i], direct = cost + Math.sqrt(dist2(a,b));
          if (direct >= costs[i]) continue;
          let link = tunnel?.next === i ? tunnel : null;
          let next = direct;
          if (!link) {
            if (!clear(a,b)) continue;
          } else if (link.path.length > 2 && clear(a,b)) {
            link = null;
          } else {
            next = cost + link.length;
            if (next >= costs[i]) continue;
            let open = true;
            for (let j = 1; j < link.path.length && open; j++)
              open = clear(link.path[j-1],link.path[j],link.bypass);
            if (!open) continue;
          }
          if (link) used.set(i, link); else used.delete(i);
          costs[i] = next;
          parent[i] = id;
          estimates[i] = next + toEnd[i];
        }
      }
      return result('unreachable');
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  function frozenPoints(points) {
    return Object.freeze(points.map(p => Object.freeze(p.slice())));
  }

  // In the profile plane X is distance along the guide and Z is elevation.
  // Visible forward edges keep the grade bound over their entire length.
  function elevationProfile(length, start, end, barriers, {
    maxGrade=1, minHeight=-1e6, maxHeight=1e6, maxVertices=360, maxTests=350000
  }={}){
    if(!Number.isFinite(length)||length<=EPS||length>1e6||!Number.isFinite(maxGrade)||maxGrade<=0||
      !point([minHeight,maxHeight],2)||minHeight>=maxHeight||
      ![start,end].every(y=>Number.isFinite(y)&&y>=minHeight&&y<=maxHeight)||
      !Array.isArray(barriers)||barriers.length>500||!limit(maxVertices,2,3000)||!limit(maxTests,1,30000000))
      throw new Error('An elevation profile needs bounded stations, pins and clearance controls');
    const obstacles=[];
    for(const band of barriers){
      if(!point([band?.from,band?.to,band?.min,band?.max],4)||
        band.from<0||band.to>length||band.to-band.from<=EPS||band.max-band.min<=EPS)
        throw new Error('Profile barriers need positive station and elevation intervals');
      const {from,to,min,max}=band;
      if(max<=minHeight||min>=maxHeight)continue;
      obstacles.push([[from,max],[to,max],[to,min],[from,min]]);
    }
    if(2+obstacles.length*4>maxVertices)return Object.freeze({status:'budget',work:Object.freeze({pairs:0,tests:0})});
    const {points,...result}=find([0,0,start],[length,0,end],obstacles,{maxVertices,maxTests},
      ([s,y],[t,z])=>t>=s&&z>=minHeight&&z<=maxHeight&&y>=minHeight&&y<=maxHeight&&
        Math.abs(z-y)<=maxGrade*(t-s)+EPS);
    return Object.freeze(points?{...result,points:frozenPoints(points.map(plan))}:result);
  }

  // Unroll an XZ guide into horizontal station space. Prism intersections
  // become elevation bands while the original bends stay in the output.
  function guideElevation(guide,start,end,prisms,{
    maxGrade=1,minHeight=-1e6,maxHeight=1e6,maxLength=1e7,maxVertices=360,maxTests=350000
  }={}){
    if(!Array.isArray(guide)||guide.length<2||guide.length>1024||!Array.from(guide).every(p=>point(p,2))||
      !Array.isArray(prisms)||prisms.length>500||!point([start,end,minHeight,maxHeight],4)||minHeight>=maxHeight||
      start<minHeight||start>maxHeight||end<minHeight||end>maxHeight||
      ![maxGrade,maxLength].every(v=>Number.isFinite(v)&&v>EPS)||
      !limit(maxVertices,2,3000)||!limit(maxTests,1,30000000))
      throw new Error('Guide elevations need finite XZ vertices, pins, clearance prisms and work limits');
    const stations=[0],segments=[];
    for(let i=1;i<guide.length;i++){
      const a=guide[i-1],b=guide[i],run=Math.sqrt(dist2(a,b)),from=stations.at(-1);
      if(run<=EPS||from+run>1e6)throw new Error('Guide elevations need nonzero spans within the station range');
      segments.push({a,b,run,from,box:bounds(a,b)});
      stations.push(from+run);
    }
    const run=stations.at(-1),crossings=[],barriers=[],exhausted=Symbol('guide elevation budget');
    let projectionTests=0;
    const check=()=>{if(++projectionTests>maxTests)throw exhausted;};
    const result=(status,work={pairs:0,tests:0},data={})=>Object.freeze({status,...data,
      work:Object.freeze({pairs:work.pairs,tests:Math.min(maxTests,projectionTests+work.tests)})});
    try{
      for(const [prism,item] of prisms.entries()){
        const {ring,min,max}=item||{};
        if(!Array.isArray(ring)||ring.length<3||ring.length>4096||!Array.from(ring).every(p=>point(p,2))||
          !point([min,max],2)||max-min<=EPS)
          throw new Error('Guide elevations need convex footprints and positive height intervals');
        const {box,edges}=convexRing(ring,check);
        for(const [pin,y] of [[guide[0],start],[guide.at(-1),end]]){
          if(y>min+EPS&&y<max-EPS&&overlap(bounds(pin,pin),box)&&convexInterval(pin,pin,edges,check))
            return result('blocked-pin');
        }
        let previous;
        for(const segment of segments){
          check();
          if(!overlap(segment.box,box))continue;
          const hit=convexInterval(segment.a,segment.b,edges,check);
          if(!hit)continue;
          const from=segment.from+hit[0]*segment.run,to=segment.from+hit[1]*segment.run;
          if(to-from<=EPS)continue;
          if(previous&&from-previous.to<=EPS)previous.to=to;
          else{
            previous={prism,from,to};
            crossings.push(previous);
          }
        }
      }
      // Merge adjacent bands of equal height before the visibility search.
      // Split walls can produce many equivalent overlapping footprint spans.
      const intervals=new Map();
      for(const {prism,from,to} of crossings){
        const {min,max}=prisms[prism];
        if(min>=maxHeight||max<=minHeight)continue;
        const key=min+'/'+max;
        if(!intervals.has(key))intervals.set(key,[]);
        intervals.get(key).push({from,to,min,max});
      }
      for(const bands of intervals.values()){
        let previous;
        for(const band of bands.sort((a,b)=>a.from-b.from||a.to-b.to)){
          if(previous&&band.from-previous.to<=EPS)previous.to=Math.max(previous.to,band.to);
          else{barriers.push(band);previous=band;}
        }
      }
      if(projectionTests>=maxTests||barriers.length>500)return result('budget');
      const profile=elevationProfile(run,start,end,barriers,{
        maxGrade,minHeight,maxHeight,maxVertices,maxTests:maxTests-projectionTests
      });
      if(profile.status!=='ok')return result(profile.status,profile.work);
      const points=[[guide[0][0],start,guide[0][1]]],samples=[0],distances=[0],flights=[];
      let guideIndex=1;
      function append(station,y){
        const leg=segments[guideIndex-1],t=clamp((station-leg.from)/leg.run);
        const [x,z]=t<=EPS?leg.a:t>=1-EPS?leg.b:interpolate(leg.a,leg.b,t),last=points.at(-1);
        points.push([x,y,z]);
        samples.push(station);
        distances.push(distances.at(-1)+Math.hypot(x-last[0],y-last[1],z-last[2]));
      }
      for(let i=1;i<profile.points.length;i++){
        const [from,low]=profile.points[i-1],[to,high]=profile.points[i];
        if(to-from<=EPS)continue;
        const first=points.length-1;
        while(guideIndex<stations.length-1&&stations[guideIndex]<to-EPS){
          const s=stations[guideIndex];
          append(s,low+(high-low)*(s-from)/(to-from));
          guideIndex++;
        }
        append(to,high);
        if(guideIndex<stations.length-1&&Math.abs(stations[guideIndex]-to)<=EPS)guideIndex++;
        flights.push({first,last:points.length-1});
      }
      const length=distances.at(-1);
      if(length>maxLength+EPS)return result('unreachable',profile.work);
      return result('ok',profile.work,{length,points:frozenPoints(points),stations:Object.freeze(samples),
        distances:Object.freeze(distances),flights:Object.freeze(flights.map(Object.freeze)),
        crossings:Object.freeze(crossings.map(Object.freeze))});
    }catch(error){
      if(error===exhausted)return result('budget');
      throw error;
    }
  }

  // The permitted path is the union of capsules along the replaced
  // interval of the guide. Clip a test segment to that union analytically
  // so it cannot jump between two parts of the corridor between samples.
  function withinGuide(a,b,guide,radius,check){
    const dx=b[0]-a[0],dz=b[1]-a[1],dd=dx*dx+dz*dz,r2=radius*radius,intervals=[];
    const add=(lo,hi)=>{if(lo<=hi+EPS&&hi>=-EPS&&lo<=1+EPS)intervals.push([Math.max(0,lo),Math.min(1,hi)]);};
    function slab(origin,speed,min,max){
      if(Math.abs(speed)<=EPS)return origin>=min-EPS&&origin<=max+EPS?[-Infinity,Infinity]:null;
      const first=(min-origin)/speed,last=(max-origin)/speed;
      return first<last?[first,last]:[last,first];
    }
    for(let i=0;i<guide.length;i++){
      check();
      const p=guide[i],x=a[0]-p[0],z=a[1]-p[1];
      if(dd<=EPS*EPS){
        if(x*x+z*z<=r2+EPS)add(0,1);
      }else{
        const mid=-(x*dx+z*dz)/dd,r=r2-(x+dx*mid)**2-(z+dz*mid)**2;
        if(r>=-EPS){
          const reach=Math.sqrt(Math.max(0,r)/dd);
          add(mid-reach,mid+reach);
        }
      }
      if(i+1===guide.length)continue;
      const q=guide[i+1],sx=q[0]-p[0],sz=q[1]-p[1],length=Math.hypot(sx,sz),tx=sx/length,tz=sz/length;
      const along=slab(x*tx+z*tz,dx*tx+dz*tz,0,length),
        across=slab(-x*tz+z*tx,-dx*tz+dz*tx,-radius,radius);
      if(along&&across)add(Math.max(along[0],across[0]),Math.min(along[1],across[1]));
    }
    let end=0;
    for(const [from,to] of intervals.sort((a,b)=>a[0]-b[0])){
      if(from>end+EPS)break;
      end=Math.max(end,to);
      if(end>=1-EPS)return true;
    }
    return false;
  }

  // Repair only obstructed station intervals of a named guide. Reserved
  // footprints constrain the splices without replacing the chosen guide.
  function guideVisibility(guide,obstacles,{
    reserved=[],maxDeviation=2,lead=.28,maxLength=1e6,maxVertices=360,maxTests=350000
  }={}){
    if(!Array.isArray(guide)||guide.length<2||guide.length>4096||!guide.every(p=>point(p,2))||
      !Array.isArray(obstacles)||!Array.isArray(reserved)||obstacles.length+reserved.length>500||
      !Number.isFinite(maxDeviation)||maxDeviation<=EPS||!Number.isFinite(lead)||lead<0||
      !Number.isFinite(maxLength)||maxLength<=EPS||!limit(maxVertices,2,3000)||!limit(maxTests,1,30000000))
      throw Error('Guide detours need finite pins, convex obstacles, and bounded clearance');
    const exhausted=Symbol('guide visibility budget');
    const work={pairs:0,tests:0};
    function check(){if(++work.tests>maxTests)throw exhausted;}
    function result(status,data={}){
      return Object.freeze({status,...data,work:Object.freeze({pairs:work.pairs,tests:Math.min(maxTests,work.tests)})});
    }
    const stations=[0],segments=[];
    for(let i=1;i<guide.length;i++){
      const a=guide[i-1],b=guide[i],run=Math.sqrt(dist2(a,b)),from=stations.at(-1);
      if(run<=EPS||from+run>1e6)throw Error('Guide detours need nonzero spans within the station range');
      segments.push({a,b,from,run,box:bounds(a,b)});
      stations.push(from+run);
    }
    const total=stations.at(-1);
    function at(value){
      if(value<=EPS)return guide[0];
      if(value>=total-EPS)return guide.at(-1);
      const leg=segments.find(s=>value<=s.from+s.run+EPS);
      return interpolate(leg.a,leg.b,clamp((value-leg.from)/leg.run));
    }
    function between(from,to){
      return [at(from),...guide.filter((p,i)=>stations[i]>from+EPS&&stations[i]<to-EPS),at(to)];
    }
    function prepare(ring){
      if(!Array.isArray(ring)||ring.length<3||ring.length>4096||!ring.every(p=>point(p,2)))
        throw Error('Guide detours need convex obstacle footprints');
      return {ring,...convexRing(ring,check)};
    }
    try{
      const strict=reserved.map(prepare),obstructions=obstacles.map(prepare),windows=[];
      const all=[...strict,...obstructions];
      for(const s of all)for(const pin of [guide[0],guide.at(-1)]){
        check();
        if(overlap(s.box,bounds(pin,pin))&&convexInterval(pin,pin,s.edges,check))
          return result('blocked-pin');
      }
      for(const segment of segments)for(const s of all){
        check();
        if(!overlap(s.box,segment.box))continue;
        const interval=convexInterval(segment.a,segment.b,s.edges,check);
        if(!interval)continue;
        // Reserved solids also trigger repairs if generated guide spans enter
        // them between pins. The pins themselves never move.
        windows.push([Math.max(0,segment.from+interval[0]*segment.run-lead),
          Math.min(total,segment.from+interval[1]*segment.run+lead)]);
      }
      const ranges=[];
      for(const [from,to] of windows.sort((a,b)=>a[0]-b[0])){
        const last=ranges.at(-1);
        if(last&&from<=last[1]+EPS)last[1]=Math.max(last[1],to);
        else ranges.push([from,to]);
      }
      if(!ranges.length)return total<=maxLength+EPS
        ?result('ok',{points:frozenPoints(guide),splices:Object.freeze([]),length:total})
        :result('unreachable');
      const out=[guide[0]],splices=[];
      let previous=0,length=0;
      function push(points){
        for(const p of points){
          const d=Math.sqrt(dist2(out.at(-1),p));
          if(d>EPS){out.push(p);length+=d;}
        }
      }
      for(const [from,to] of ranges){
        const local=between(from,to),first=local[0],last=local.at(-1);
        if(dist2(first,last)<=EPS*EPS)return result('unreachable');
        const box=[Infinity,Infinity,-Infinity,-Infinity];
        for(const [x,z] of local){
          box[0]=Math.min(box[0],x-maxDeviation);box[1]=Math.min(box[1],z-maxDeviation);
          box[2]=Math.max(box[2],x+maxDeviation);box[3]=Math.max(box[3],z+maxDeviation);
        }
        const nearby=all.filter(s=>overlap(s.box,box));
        const waypoints=local.slice(1,-1).filter(p=>!nearby.some(s=>{
          check();
          return overlap(s.box,bounds(p,p))&&convexInterval(p,p,s.edges,check);
        }));
        const rings=nearby.map(s=>s.ring);
        if(rings.reduce((n,ring)=>n+ring.length,2+waypoints.length)>maxVertices||work.tests>=maxTests)return result('budget');
        const found=find([first[0],0,first[1]],[last[0],0,last[1]],rings,
          {maxVertices,maxTests:maxTests-work.tests,waypoints},(a,b,count)=>withinGuide(a,b,local,maxDeviation,count));
        work.tests+=found.work.tests;work.pairs+=found.work.pairs;
        if(work.tests>maxTests)return result('budget');
        if(found.status!=='ok')return result(found.status==='blocked-pin'?'unreachable':found.status);
        push(between(previous,from).slice(1));
        const start=out.length-1;
        push(found.points.slice(1).map(plan));
        splices.push(Object.freeze({from,to,first:start,last:out.length-1}));
        previous=to;
      }
      push(between(previous,total).slice(1));
      return length<=maxLength+EPS
        ?result('ok',{points:frozenPoints(out),splices:Object.freeze(splices),length})
        :result('unreachable');
    }catch(error){
      if(error===exhausted)return result('budget');
      throw error;
    }
  }

  // Search a finite visibility graph in X/Y/Z. Tangency is allowed on the
  // clearance envelopes. Callers can widen a footprint and extend its
  // elevation interval to account for the shape that will travel the route.
  function prismVisibility(start, end, prisms, {
    minHeight = -1e6, maxHeight = 1e6, maxGrade = 1, maxLength = 1e7,
    maxVertices = 360, maxTests = 350000, waypoints = [], links = [], floor, spacing = .25
  } = {}) {
    const distance = (a,b) => Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    if (!point(start,3) || !point(end,3) || distance(start,end)<=EPS ||
        !point([minHeight,maxHeight],2) || minHeight>=maxHeight ||
        ![start,end].every(p=>p[1]>=minHeight&&p[1]<=maxHeight) ||
        ![maxGrade,maxLength,spacing].every(n=>Number.isFinite(n)&&n>EPS) ||
        !limit(maxVertices,2,3000) || !limit(maxTests,1,30000000) ||
        !Array.isArray(prisms) || prisms.length>500 ||
        !Array.isArray(waypoints) || !Array.from(waypoints).every(p=>point(p,3)) ||
        !Array.isArray(links) || links.length>64 ||
        floor!==undefined&&typeof floor!=='function')
      throw new Error('Prism routes need finite pins, clearance volumes and valid search limits');

    const work={pairs:0,tests:0}, exhausted=Symbol('prism route budget');
    const result=(status,points,traversed=[])=>Object.freeze({status,
      ...(points&&{points:frozenPoints(points)}),
      ...(traversed.length&&{links:Object.freeze(traversed.map(Object.freeze))}),
      work:Object.freeze({...work})});
    const check=()=>{if(++work.tests>maxTests)throw exhausted;};
    const solids=[],sites=new Map(),heights=new Set([start[1],end[1]]);
    const vertices=[start,end],ids=new Map(vertices.map((p,i)=>[p.join('/'),i]));
    const add=p=>{
      const key=p.join('/');
      if(ids.has(key))return ids.get(key);
      if(p[1]<minHeight||p[1]>maxHeight||
        distance(start,p)+distance(p,end)>maxLength+EPS)return null;
      if(floor&&!aboveFloor(...p))return null;
      if(vertices.length>=maxVertices)throw exhausted;
      const id=vertices.length;
      ids.set(key,id);
      vertices.push(p);
      return id;
    };

    const tunnels=Array.from(links,(link,index)=>{
      const {points,through=[],direction='both'}=link||{};
      if(!['forward','reverse','both'].includes(direction)||!Array.isArray(points)||points.length<2||points.length>18||
        !Array.from(points).every(p=>point(p,3))||distance(points[0],points.at(-1))<=EPS||
        !Array.isArray(through)||!Array.from(through).every(i=>limit(i,0,prisms.length-1)))
        throw new Error('Prism links need distinct XYZ endpoints, at most sixteen bends and valid prism indices');
      const spans=points.slice(1).map((p,i)=>distance(points[i],p));
      if(spans.some(length=>length<=EPS))throw new Error('Prism links require nonzero spans');
      return {index,points,spans,direction,bypass:new Set(through),length:spans.reduce((sum,len)=>sum+len,0)};
    });

    // Slab clipping along one segment parameter. The same interval gets
    // clipped by Y and the normalized footprint half-planes.
    function interval(a,b,solid,inside,clipHeight){
      let lo=0,hi=1;
      function clip(first,last){
        if(first<=0&&last<=0)return false;
        if(first<=0)lo=Math.max(lo,first/(first-last));
        else if(last<=0)hi=Math.min(hi,first/(first-last));
        return hi-lo>EPS;
      }
      if(clipHeight&&(!clip(a[1]-solid.min-inside,b[1]-solid.min-inside)||
        !clip(solid.max-a[1]-inside,solid.max-b[1]-inside)))return null;
      for(const [x,z,nx,nz] of solid.edges){
        check();
        if(!clip(nx*(a[0]-x)+nz*(a[2]-z)-inside,nx*(b[0]-x)+nz*(b[2]-z)-inside))return null;
      }
      return [lo,hi];
    }
    function aboveFloor(x,y,z){
      check();
      const height=floor(x,z);
      if(typeof height!=='number'||Number.isNaN(height))
        throw new Error('A prism route floor must return an elevation');
      return y>=height-EPS;
    }
    function blockedPin(point){
      return solids.some(s=>point[1]>s.min+EPS&&point[1]<s.max-EPS&&interval(point,point,s,EPS,false));
    }
    function permits(a,b,length,bypass){
      work.pairs++;
      if(Math.abs(b[1]-a[1])>maxGrade*Math.hypot(b[0]-a[0],b[2]-a[2])+EPS)return false;
      const box=bounds(plan(a),plan(b)),lo=Math.min(a[1],b[1]),hi=Math.max(a[1],b[1]);
      for(const solid of solids){
        check();
        if(!bypass?.has(solid.index)&&lo<solid.max-EPS&&hi>solid.min+EPS&&overlap(box,solid.box)&&
          interval(a,b,solid,EPS,true))return false;
      }
      if(floor){
        const steps=Math.ceil(length/spacing);
        for(let i=0;i<=steps;i++){
          const t=i/steps;
          if(!aboveFloor(a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),a[2]+t*(b[2]-a[2])))
            return false;
        }
      }
      return true;
    }

    try {
      for(const [index,prism] of prisms.entries()){
        const {ring,min,max}=prism||{};
        if(!Array.isArray(ring)||ring.length<3||ring.length>4096||
          !Array.from(ring).every(p=>point(p,2))||!point([min,max],2)||max-min<=EPS)
          throw new Error('Prism routes need convex footprints and positive height intervals');
        if(min>=maxHeight||max<=minHeight)continue;
        if(ring.length>maxVertices)throw exhausted;
        const {box,edges}=convexRing(ring,check);
        for(const p of ring)sites.set(p.join('/'),p);
        const solid={index,min,max,box,edges};
        solids.push(solid);
        for(const y of [min,max])if(y>=minHeight&&y<=maxHeight)heights.add(y);
        const hit=interval(start,end,solid,0,false);
        for(const t of hit||[]){
          if(t<=EPS||t>=1-EPS)continue;
          const x=start[0]+(end[0]-start[0])*t,z=start[2]+(end[2]-start[2])*t;
          sites.set(x+'/'+z,[x,z]);
        }
      }
      for(const p of [start,end]){
        if(floor&&!aboveFloor(...p))return result('blocked-pin');
        if(blockedPin(p))return result('blocked-pin');
      }
      const length=distance(start,end);
      if(length>maxLength+EPS)return result('unreachable');
      if(permits(start,end,length))return result('ok',[start,end]);
      const linked=new Map();
      function connect(from,to,tunnel,path){
        if(!linked.has(from))linked.set(from,[]);
        linked.get(from).push({to,index:tunnel.index,length:tunnel.length,path});
      }
      for(const tunnel of tunnels){
        const {points,spans,bypass}=tunnel,first=points[0],last=points.at(-1);
        if(tunnel.length+Math.min(distance(start,first)+distance(last,end),
          distance(start,last)+distance(first,end))>maxLength+EPS||
          points.some(p=>p[1]<minHeight||p[1]>maxHeight)||
          blockedPin(first)||blockedPin(last)||
          !spans.every((length,i)=>permits(points[i],points[i+1],length,bypass)))continue;
        const a=add(first),b=add(last);
        if(a===null||b===null)continue;
        if(tunnel.direction!=='reverse')connect(a,b,tunnel,points);
        if(tunnel.direction!=='forward')connect(b,a,tunnel,points.slice().reverse());
      }
      for(const p of waypoints)add(p);
      for(const [x,z] of sites.values())for(const y of heights)add([x,y,z]);
      const costs=new Float64Array(vertices.length).fill(Infinity),previous=new Int32Array(vertices.length).fill(-1),
        visited=new Uint8Array(vertices.length),guess=vertices.map(p=>distance(p,end)),used=new Map();
      costs[0]=0;
      for(;;){
        let current=-1,best=Infinity;
        for(let i=0;i<vertices.length;i++){
          const rank=costs[i]+guess[i];
          if(!visited[i]&&rank<best){best=rank;current=i;}
        }
        if(current===-1)return result('unreachable');
        if(current===1){
          const chain=[];
          for(let id=1;id!==0;id=previous[id])chain.push(id);
          const path=[start],traversed=[];
          for(const id of chain.reverse()){
            const tunnel=used.get(id),from=path.length-1;
            if(tunnel){
              path.push(...tunnel.path.slice(1));
              traversed.push({link:tunnel.index,from,to:path.length-1});
            }else path.push(vertices[id]);
          }
          return result('ok',path,traversed);
        }
        visited[current]=1;
        const a=vertices[current];
        for(let i=1;i<vertices.length;i++){
          if(visited[i]||current===0&&i===1)continue;
          const b=vertices[i],length=distance(a,b),cost=costs[current]+length;
          if(cost>=costs[i]||cost+guess[i]>maxLength+EPS||!permits(a,b,length))continue;
          costs[i]=cost;
          previous[i]=current;
          used.delete(i);
        }
        for(const tunnel of linked.get(current)||[]){
          const i=tunnel.to,cost=costs[current]+tunnel.length;
          if(visited[i]||cost>=costs[i]||cost+guess[i]>maxLength+EPS)continue;
          costs[i]=cost;
          previous[i]=current;
          used.set(i,tunnel);
        }
      }
    }catch(error){
      if(error===exhausted)return result('budget');
      throw error;
    }
  }

  function hull(points) {
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const distinct = sorted.filter((p, i) => i === 0 || dist2(p, sorted[i - 1]) > EPS ** 2);
    function chain(input) {
      const edge = [];
      for (const p of input) {
        while (edge.length >= 2 && area2(edge.at(-2), edge.at(-1), p) <= 0) edge.pop();
        edge.push(p);
      }
      return edge.slice(0, -1);
    }
    return [...chain(distinct), ...chain(distinct.reverse())];
  }

  function convexFootprint(points, { margin = 0, maxSides } = {}) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 4096 ||
        !points.every(p => point(p, 2)) || !Number.isFinite(margin) || margin < 0 || margin > 1e4 ||
        maxSides!==undefined&&!limit(maxSides,4,256))
      throw new Error('A clearance footprint needs finite XZ samples and a nonnegative margin');
    const outline = hull(points);
    if (outline.length < 3) throw new Error('A clearance footprint needs noncollinear samples');

    // The octagon circumscribes a circle of radius margin. Its Minkowski sum
    // with the hull bounds the swept clearance, including at sharp tips.
    const diagonal = margin * (Math.SQRT2 - 1);
    const offsets = [[-margin, -diagonal], [-margin, diagonal], [-diagonal, -margin], [-diagonal, margin],
      [margin, -diagonal], [margin, diagonal], [diagonal, -margin], [diagonal, margin]];
    const footprint=margin?hull(outline.flatMap(p=>offsets.map(q=>[p[0]+q[0],p[1]+q[1]]))):outline;
    if(maxSides===undefined||footprint.length<=maxSides)return frozenPoints(footprint);
    // Intersect adjacent support planes to reduce graph size at a rounded
    // obstacle. Each plane contains the expanded hull on its inner side.
    const planes=Array.from({length:maxSides},(_,i)=>{
      const angle=2*Math.PI*i/maxSides,x=Math.cos(angle),z=Math.sin(angle);
      const offset=footprint.reduce((max,p)=>Math.max(max,x*p[0]+z*p[1]),-Infinity);
      return [x,z,offset+1e-11*(1+Math.abs(offset))];
    });
    return frozenPoints(hull(planes.map(([ax,az,a],i)=>{
      const [bx,bz,b]=planes[(i+1)%planes.length],det=ax*bz-az*bx;
      return [(a*bz-az*b)/det,(ax*b-a*bx)/det];
    })));
  }


  // Work in a horizontal frame that shifts with elevation. Obstacles swept
  // across a height interval conservatively reserve their full footprint.
  function elevationFrame({ drift, datum=0 }={}) {
    if(!point(drift,2)||!point([datum],1))throw Error('An elevation frame needs finite drift and datum');
    const [dx,dz]=drift, speed=Math.hypot(dx,dz);
    const project=([x,y,z])=>[x-(y-datum)*dx,y,z-(y-datum)*dz];
    const lift=([x,y,z])=>[x+(y-datum)*dx,y,z+(y-datum)*dz];
    function prismFootprint(ring,min,max,options){
      if(!Array.isArray(ring)||ring.length<3||ring.length>2048||
        !Array.from(ring).every(p=>point(p,2))||!point([min,max],2)||min>max)
        throw Error('Frame footprints need a bounded ring and ordered heights');
      return convexFootprint(ring.flatMap(([x,z])=>[
        plan(project([x,min,z])),plan(project([x,max,z]))
      ]),options);
    }
    function grade(maxGrade){
      if(!Number.isFinite(maxGrade)||maxGrade<=0)throw Error('Frame grade must be positive and finite');
      return maxGrade/(1+maxGrade*speed);
    }
    return Object.freeze({project,lift,prismFootprint,grade,speed});
  }

  function clearanceBands({sectionBands,halfWidth,below,above}){
    if(sectionBands===undefined){
      if(![halfWidth,below,above].every(v=>Number.isFinite(v)&&v>=0))
        throw Error('A route section needs finite nonnegative dimensions');
      return [{lateral:[-halfWidth,halfWidth],vertical:[-below,above]}];
    }
    const range=values=>point(values,2)&&values[0]<=values[1];
    if(!Array.isArray(sectionBands)||!limit(sectionBands.length,1,16)||
      !Array.from(sectionBands).every(band=>range(band?.lateral)&&range(band?.vertical)))
      throw Error('Route section bands need ordered finite lateral and vertical intervals');
    return sectionBands;
  }

  // Every corner of the swept section gives linear constraints on the
  // two endpoint heights in an affine aperture chart.
  function profileSection(profile,start,end,{
    project,minHeight,maxHeight,maxGrade,halfWidth,below,above,sectionBands,clearance=0
  }={}){
    if(!Array.isArray(profile)||profile.length<3||profile.length>256||!profile.every(p=>point(p,2))||
      !point(start,2)||!point(end,2)||typeof project!=='function'||!point([minHeight,maxHeight],2)||
      minHeight>=maxHeight||![maxGrade,clearance].every(x=>Number.isFinite(x)&&x>=0))
      throw Error('A profile section needs a convex contour, affine chart and bounded sweep dimensions');
    const bands=clearanceBands({sectionBands,halfWidth,below,above});
    const dx=end[0]-start[0],dz=end[1]-start[1],run=Math.hypot(dx,dz);
    if(run<=EPS)throw Error('A profile section needs a nonzero horizontal run');
    const {edges}=convexRing(profile,()=>{});
    let polygon=[[minHeight,minHeight],[maxHeight,minHeight],[maxHeight,maxHeight],[minHeight,maxHeight]];
    function clip(a,b,c){
      const next=[];
      function push(p){if(!next.length||dist2(p,next.at(-1))>EPS*EPS)next.push(p);}
      for(let i=0;i<polygon.length;i++){
        const q=polygon[i],r=polygon[(i+1)%polygon.length],first=a*q[0]+b*q[1]+c,last=a*r[0]+b*r[1]+c;
        if(first>=-EPS)push(q);
        if((first>=-EPS)!==(last>=-EPS))push(interpolate(q,r,clamp(first/(first-last))));
      }
      if(next.length>1&&dist2(next[0],next.at(-1))<=EPS*EPS)next.pop();
      polygon=next;
    }
    clip(-1,1,maxGrade*run);
    clip(1,-1,maxGrade*run);
    for(const [i,[x,z]] of [start,end].entries()){
      for(const {lateral,vertical} of bands)for(const u of lateral)for(const y of vertical){
        const q=[x-u*dz/run,y,z+u*dx/run],
          a=project(q),b=project([q[0],q[1]+1,q[2]]);
        if(!point(a,2)||!point(b,2))throw Error('A profile section chart must return finite planar coordinates');
        for(const [u,v,nx,nz] of edges){
          const k=nx*(b[0]-a[0])+nz*(b[1]-a[1]),c=nx*(a[0]-u)+nz*(a[1]-v)-clearance;
          clip(i?0:k,i?k:0,c);
          if(!polygon.length)return null;
        }
      }
    }
    const area=polygon.reduce((sum,p,i)=>sum+area2(polygon[0],p,polygon[(i+1)%polygon.length]),0);
    function closest(target){
      if(!point(target,2))throw Error('Profile section heights must be finite');
      let nearest=polygon[0],distance=dist2(nearest,target),inside=area>EPS*EPS;
      for(const [i,a] of polygon.entries()){
        const b=polygon[(i+1)%polygon.length],d=dist2(a,b);
        if(area2(a,b,target)<-EPS)inside=false;
        if(d<=EPS*EPS)continue;
        const t=clamp(((target[0]-a[0])*(b[0]-a[0])+(target[1]-a[1])*(b[1]-a[1]))/d),
          q=interpolate(a,b,t),error=dist2(q,target);
        if(error<distance){nearest=q;distance=error;}
      }
      return Object.freeze((inside?target:nearest).slice());
    }
    return Object.freeze({heights:frozenPoints(polygon),closest});
  }

  function sweep(start, end, { halfWidth, below, above, sectionBands, spacing = 0.12, minClearance = 0,
    clearance, maxSamples = 10000 } = {}) {
    if (!point(start, 3) || !point(end, 3) || !Number.isFinite(minClearance) || minClearance < 0 ||
        !(spacing > EPS) || !Number.isFinite(spacing) || typeof clearance !== 'function' ||
        !limit(maxSamples, 1, 1000000)) throw new Error('A swept route needs a finite section, spacing and a clearance field');
    const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2], run = Math.hypot(dx, dz);
    if (run <= EPS) throw new Error('Swept routes need a nonzero horizontal run');
    const nx=-dz/run,nz=dx/run,rows=Math.ceil(Math.hypot(run,dy)/spacing);
    const grid=clearanceBands({sectionBands,halfWidth,below,above}).map(({lateral:[l,r],vertical:[b,a]})=>
      ({l,r,b,a,columns:Math.ceil((r-l)/spacing),layers:Math.ceil((a-b)/spacing)}));
    const rowSamples=grid.reduce((sum,band)=>sum+(band.columns+1)*(band.layers+1),0);
    if((rows+1)*rowSamples>maxSamples)return {status:'budget',samples:0};
    let samples = 0;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      for(const {l,r,b,a,columns,layers} of grid)for (let j = 0; j <= columns; j++) {
        const u = columns ? l+(r-l)*j/columns : l;
        for (let k = 0; k <= layers; k++) {
          const h = layers ? b+(a-b)*k/layers : b;
          const q = [start[0] + dx * t + nx * u, start[1] + dy * t + h, start[2] + dz * t + nz * u];
          const d = clearance(q);
          samples++;
          if (typeof d !== 'number' || Number.isNaN(d)) throw new Error('A clearance field must return a signed distance');
          if (d < minClearance) return { status: 'blocked', samples, point: q, clearance: d };
        }
      }
    }
    return { status: 'ok', samples };
  }

  function* joinFootprint(x,z,angle,turn,bands,spacing,rounded){
    if(rounded){
      const {lateral:[,radius],vertical:[low,high]}=bands[0],rings=Math.ceil(radius/spacing);
      if(!rings)return;
      for(let ring=0;ring<=rings;ring++){
        const r=radius*ring/rings,steps=ring?Math.ceil(2*Math.PI*r/spacing):1;
        for(let i=0;i<steps;i++){
          const a=2*Math.PI*i/steps;
          yield [x+r*Math.cos(a),z+r*Math.sin(a),low,high];
        }
      }
      return;
    }
    for(const {lateral:[left,right],vertical:[low,high]} of bands){
      for(const sign of [-1,1]){
        const near=Math.max(0,sign===1?left:-right),far=sign===1?right:-left;
        if(far<=0)continue;
        const angles=Math.max(1,Math.ceil(Math.abs(turn)*far/spacing));
        for(let i=0;i<=angles;i++){
          const a=turn*i/angles,theta=angle+a+(sign<0?Math.PI:0);
          // Cover the circular sweep and the straight bevel chord.
          const ratio=Math.cos(turn/2)/Math.max(EPS,Math.cos(a-turn/2)),
            inner=near*clamp(ratio),radial=Math.ceil((far-inner)/spacing);
          for(let j=0;j<=radial;j++){
            const r=radial?inner+(far-inner)*j/radial:inner;
            yield [x+r*Math.cos(theta),z+r*Math.sin(theta),low,high];
          }
        }
      }
    }
  }

  function turnBetween(dx,dz,ex,ez){
    const cross=dx*ez-dz*ex,dot=dx*ex+dz*ez;
    return Math.abs(cross)<=EPS*Math.hypot(dx,dz)*Math.hypot(ex,ez)&&dot>0?0:Math.atan2(cross,dot);
  }

  // Intersect the permitted center heights for each occupied part at every
  // station. Endpoints and bends are retained when fitting a grade afterwards.
  function sectionHeightBands(path,{
    spacing=.12,minHeight,maxHeight,clearHeights,maxStations=256,maxSamples=10000,...section
  }={}){
    if(!Array.isArray(path)||path.length<2||path.length>4097||!Array.from(path).every(q=>point(q,2))||
      !point([minHeight,maxHeight],2)||minHeight>maxHeight||!Number.isFinite(spacing)||spacing<=EPS||
      typeof clearHeights!=='function'||!limit(maxStations,2,4096)||!limit(maxSamples,1,1000000))
      throw Error('Section height bands need a finite planar guide, height range, spacing and clearance callback');
    const bands=clearanceBands(section),rounded=section.sectionBands===undefined,spans=[];
    let count=1,distance=0,samples=0;
    for(let i=1;i<path.length;i++){
      const [x,z]=path[i-1],dx=path[i][0]-x,dz=path[i][1]-z,run=Math.hypot(dx,dz);
      if(run<=EPS)throw Error('Section height bands need nonzero horizontal spans');
      const rows=Math.ceil(run/spacing);
      spans.push({dx,dz,run,rows});
      count+=rows;
    }
    if(count>maxStations)return {status:'budget',samples};
    const stations=[];
    function* crossSection(x,z,{dx,dz,run}){
      for(const {lateral:[left,right],vertical:[low,high]} of bands){
        const columns=Math.ceil((right-left)/spacing);
        for(let i=0;i<=columns;i++){
          const u=columns?left+(right-left)*i/columns:left;
          yield [x-dz/run*u,z+dx/run*u,low,high];
        }
      }
    }
    function* footprint(x,z,span,next){
      yield* crossSection(x,z,span);
      if(!next)return;
      const turn=turnBetween(span.dx,span.dz,next.dx,next.dz);
      if(!turn)return;
      yield* crossSection(x,z,next);
      yield* joinFootprint(x,z,Math.atan2(span.dx,-span.dz),turn,bands,spacing,rounded);
    }
    function station(x,z,at,keep,span,next){
      let min=minHeight,max=maxHeight;
      for(const [a,b,low,high] of footprint(x,z,span,next)){
        if(samples===maxSamples)return 'budget';
        const range=clearHeights(a,b,low,high);
        samples++;
        if(range===null)continue;
        if(!Array.isArray(range)||range.length!==2||
          typeof range[0]!=='number'||typeof range[1]!=='number'||Number.isNaN(range[0])||Number.isNaN(range[1]))
          throw Error('Section clearance must return a center height interval or null');
        min=Math.max(min,range[0]);
        max=Math.min(max,range[1]);
        if(min>max)return 'blocked';
      }
      stations.push({point:[x,z],at,min,max,keep});
      return 'ok';
    }
    let status=station(...path[0],0,true,spans[0]);
    if(status!=='ok')return {status,samples};
    for(const [i,span] of spans.entries()){
      const [x,z]=path[i],{dx,dz,run,rows}=span;
      for(let j=1;j<=rows;j++){
        const t=j/rows,keep=j===rows,point=keep?path[i+1]:[x+dx*t,z+dz*t];
        status=station(...point,distance+run*t,keep,span,keep?spans[i+1]:null);
        if(status!=='ok')return {status,samples};
      }
      distance+=run;
    }
    return {status:'ok',samples,stations};
  }

  function sweepPath(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 4097 ||
        !Array.from(points).every(p => point(p,3)))
      throw new Error('A swept path needs 2 to 4097 finite points');
    if (points.length === 2) return sweep(points[0],points[1],options);
    for (let i=1;i<points.length;i++)
      if (Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2]) <= EPS)
        throw new Error('Swept routes need a nonzero horizontal run');
    const {halfWidth,sectionBands,spacing=.12,minClearance=0,clearance,maxSamples=10000}=options;
    const bands=clearanceBands(options),rounded=sectionBands===undefined;
    let samples=0;
    for(let i=1;i<points.length;i++){
      if(i>1&&samples===maxSamples)return {status:'budget',samples};
      const span=sweep(points[i-1],points[i],{...options,maxSamples:maxSamples-samples});
      samples+=span.samples;
      if(span.status!=='ok')return {...span,samples};
      if(i===points.length-1||rounded&&!halfWidth)continue;
      const [a,b,c]=[points[i-1],points[i],points[i+1]],dx=b[0]-a[0],dz=b[2]-a[2],
        ex=c[0]-b[0],ez=c[2]-b[2],turn=turnBetween(dx,dz,ex,ez);
      if(!turn)continue;
      for(const [x,z,low,high] of joinFootprint(b[0],b[2],Math.atan2(dx,-dz),turn,bands,spacing,rounded)){
        const layers=Math.ceil((high-low)/spacing);
        if(layers+1>maxSamples-samples)return {status:'budget',samples};
        for(let k=0;k<=layers;k++){
          const q=[x,b[1]+(layers?low+(high-low)*k/layers:low),z],d=clearance(q);
          samples++;
          if(typeof d!=='number'||Number.isNaN(d))throw Error('A clearance field must return a signed distance');
          if(d<minClearance)return {status:'blocked',samples,point:q,clearance:d};
        }
      }
    }
    return {status:'ok',samples};
  }

  return Object.freeze({ find, convexFootprint, sweep, sweepPath, elevationProfile, guideElevation, guideVisibility, prismVisibility, profileSection, sectionHeightBands, elevationFrame });
})();
if (typeof module !== 'undefined') module.exports = RouteVisibility;
