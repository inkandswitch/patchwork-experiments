/* Orientation-aware contact for bounded solids. */
(function (K) {
  const P = K.procedural || K.authoring, { V } = K;
  const epsilon = 1e-8;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const boxes = new WeakSet();
  const prisms = new WeakMap();
  const volumeTrees = new WeakMap();
  const vertical = [0,1,0];
  function overlaps(a,b,pad) {
    for (let i=0; i<3; i++)
      if (a.bounds.min[i]-pad-epsilon>b.bounds.max[i] ||
          b.bounds.min[i]-pad-epsilon>a.bounds.max[i]) return false;
    return true;
  }

  function orientedBox(center, half, frame = [1,0,0,0,1,0,0,0,1]) {
    if (!vector(center) || !vector(half) || half.some(x => x <= 0) ||
      !Array.isArray(frame) || frame.length !== 9 || !frame.every(Number.isFinite))
      throw Error('An oriented box needs a center, positive half extents and an orthonormal frame');
    const axes = [0,1,2].map(i => [frame[i],frame[i+3],frame[i+6]]);
    if (axes.some((axis, i) => Math.abs(V.dot(axis,axis)-1) > epsilon ||
      axes.slice(0,i).some(other => Math.abs(V.dot(axis,other)) > epsilon)))
      throw Error('An oriented box needs an orthonormal frame');
    const extent = center.map((_, axis) => axes.reduce((sum, normal, i) => sum+Math.abs(normal[axis])*half[i],0));
    const bounds = { min:V.sub(center,extent),max:V.add(center,extent) };
    if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite))
      throw Error('An oriented box needs finite world bounds');
    const box = P.data.freeze({ center:center.slice(),half:half.slice(),axes,bounds });
    boxes.add(box);
    return box;
  }

  function boxContact(a, b, tolerance = 0) {
    if (!boxes.has(a) || !boxes.has(b) || !Number.isFinite(tolerance) || tolerance < 0)
      throw Error('Box contact needs two oriented boxes and a nonnegative tolerance');
    if (!overlaps(a,b,tolerance)) return false;
    const delta = V.sub(b.center,a.center);
    function separated(axis) {
      const cells = a.half[0]*Math.abs(V.dot(a.axes[0],axis)) +
        a.half[1]*Math.abs(V.dot(a.axes[1],axis)) + a.half[2]*Math.abs(V.dot(a.axes[2],axis)) +
        b.half[0]*Math.abs(V.dot(b.axes[0],axis)) + b.half[1]*Math.abs(V.dot(b.axes[1],axis)) +
        b.half[2]*Math.abs(V.dot(b.axes[2],axis));
      return Math.abs(V.dot(delta,axis))>cells+tolerance+epsilon;
    }
    if (a.axes.some(separated) || b.axes.some(separated)) return false;
    for (const x of a.axes) for (const y of b.axes) {
      const axis = V.cross(x,y), length = V.len(axis);
      if (length>epsilon && separated(V.mul(axis,1/length))) return false;
    }
    return true;
  }

  function verticalPrism(outline, bottom, top, {origin=[0,0],gradient=[0,0]}={}) {
    if (!Number.isFinite(bottom) || !Number.isFinite(top) || bottom >= top)
      throw Error('A vertical prism needs ordered finite heights');
    const plan = p => Array.isArray(p) && p.length===2 && Array.from(p).every(Number.isFinite);
    if (!plan(origin) || !plan(gradient)) throw Error('A prism datum and gradient need finite coordinates');
    const {cells} = P.surfaceCells.clip([{key:'base',polygon:outline}],{budget:1});
    const footprint = cells[0]?.fragments[0];
    if (!footprint) throw Error('A vertical prism needs a nonempty convex footprint');
    const [dx,dz] = gradient, sloped = dx!==0 || dz!==0;
    const rises = sloped ? footprint.map(([x,z])=>dx*(x-origin[0])+dz*(z-origin[1])) : null;
    const low = bottom+(rises?Math.min(...rises):0), high = top+(rises?Math.max(...rises):0);
    if (![low,high,Math.hypot(dx,dz)].every(Number.isFinite) ||
        rises?.some(y => y+top<=y+bottom))
      throw Error('Prism bands need finite, ordered bounds');
    const edges = footprint.map(([x,z],i) => {
      const [nextX,nextZ] = footprint[(i+1)%footprint.length];
      return V.norm([nextX-x,0,nextZ-z]);
    });
    const sides = edges.map(([x,,z]) => [z,0,-x]);
    const xs = footprint.map(([x]) => x), zs = footprint.map(([,z]) => z);
    const bounds = {min:[Math.min(...xs),low,Math.min(...zs)],max:[Math.max(...xs),high,Math.max(...zs)]};
    function containsPlan(x,z) {
      return sides.every(([nx,,nz],i) => {
        const [vx,vz] = footprint[i];
        return nx*(x-vx)+nz*(z-vz)<=epsilon;
      });
    }
    const prism = P.data.freeze({footprint,bounds,containsPlan});
    const up = sloped ? V.norm([-dx,1,-dz]) : vertical,
      capEdges = sloped ? edges.map(([x,,z])=>V.norm([x,dx*x+dz*z,z])) : edges;
    prisms.set(prism,{axes:[up,...sides],edges:[vertical,...capEdges],bottom,top,rises});
    return prism;
  }

  function project(volume, prism, axis, origin) {
    if (!prism) {
      const middle = V.dot(V.sub(volume.center,origin),axis);
      const radius = volume.half.reduce((sum,length,i) => sum+length*Math.abs(V.dot(volume.axes[i],axis)),0);
      return [middle-radius,middle+radius];
    }
    let low = Infinity, high = -Infinity;
    for (const [i,[x,z]] of volume.footprint.entries()) {
      const t = axis[0]*(x-origin[0])+axis[2]*(z-origin[2])+axis[1]*(prism.rises?.[i]??0);
      low = Math.min(low,t);
      high = Math.max(high,t);
    }
    const y0 = axis[1]*(prism.bottom-origin[1]), y1 = axis[1]*(prism.top-origin[1]);
    return [low+Math.min(y0,y1),high+Math.max(y0,y1)];
  }

  function volumeContact(a,b,tolerance=0) {
    const pa = prisms.get(a), pb = prisms.get(b);
    if (!pa && !pb) return boxContact(a,b,tolerance);
    if ((!pa && !boxes.has(a)) || (!pb && !boxes.has(b)) || !Number.isFinite(tolerance) || tolerance < 0)
      throw Error('Volume contact needs two boxes or prisms and a nonnegative tolerance');
    if (!overlaps(a,b,tolerance)) return false;
    const origin = a.bounds.min, pad = tolerance+epsilon;
    function separated(axis) {
      const [lo,hi] = project(a,pa,axis,origin), [otherLo,otherHi] = project(b,pb,axis,origin);
      return lo-pad>otherHi||otherLo-pad>hi;
    }
    if ((pa?.axes||a.axes).some(separated) || (pb?.axes||b.axes).some(separated)) return false;
    // Two level prisms already supply all the necessary axes.
    if (pa && pb && !pa.rises && !pb.rises) return true;
    for (const edgeA of pa?.edges||a.axes) for (const edgeB of pb?.edges||b.axes) {
      const axis = V.cross(edgeA,edgeB), length = V.len(axis);
      if (length>epsilon && separated(V.mul(axis,1/length))) return false;
    }
    return true;
  }

  function volumeNode(volumes) {
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    const first = [Infinity,Infinity,Infinity], last = [-Infinity,-Infinity,-Infinity];
    const center = (volume,i) => volume.bounds.min[i]/2+volume.bounds.max[i]/2;
    for (const volume of volumes) for (let i=0; i<3; i++) {
      min[i] = Math.min(min[i],volume.bounds.min[i]);
      max[i] = Math.max(max[i],volume.bounds.max[i]);
      const middle = center(volume,i);
      first[i] = Math.min(first[i],middle);
      last[i] = Math.max(last[i],middle);
    }
    const bounds = {min,max}, size = volumes.length;
    if (size<=8) return {bounds,size,volumes};
    const span = last.map((value,i) => value-first[i]), axis = span.indexOf(Math.max(...span));
    volumes.sort((a,b) => center(a,axis)-center(b,axis));
    const split = size>>1;
    return {bounds,size,left:volumeNode(volumes.slice(0,split)),right:volumeNode(volumes.slice(split))};
  }

  function volumeSet(volumes) {
    if (!Array.isArray(volumes) || volumes.length>16384 ||
        !Array.from(volumes).every(v => boxes.has(v)||prisms.has(v)))
      throw Error('A contact set needs at most 16384 boxes or prisms');
    const tree = volumes.length?volumeNode(volumes.slice()):null;
    const set = P.data.freeze({size:volumes.length,bounds:tree?.bounds??null});
    volumeTrees.set(set,tree);
    return set;
  }

  function volumeSetsContact(a,b,tolerance=0) {
    if (!volumeTrees.has(a) || !volumeTrees.has(b) || !Number.isFinite(tolerance) || tolerance<0)
      throw Error('Contact between sets needs two volume sets and a nonnegative tolerance');
    function meets(a,b) {
      if (!overlaps(a,b,tolerance)) return false;
      if (a.volumes&&b.volumes)
        return a.volumes.some(first => b.volumes.some(second => volumeContact(first,second,tolerance)));
      if (b.volumes||a.left&&a.size>=b.size)
        return meets(a.left,b)||meets(a.right,b);
      return meets(a,b.left)||meets(a,b.right);
    }
    const left=volumeTrees.get(a), right=volumeTrees.get(b);
    return Boolean(left&&right&&meets(left,right));
  }

  Object.assign(P.contacts ||= {}, {
    orientedBox, boxContact, verticalPrism, volumeContact, volumeSet, volumeSetsContact
  });
})(KIT);
