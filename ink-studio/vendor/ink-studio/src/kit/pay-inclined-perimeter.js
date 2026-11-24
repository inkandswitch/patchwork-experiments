/* Horizontal offset of the swept cross-section of an affine extrusion. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-8;
  const vector = (p, n) => Array.isArray(p) && p.length === n && Array.from(p).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  function convexPerimeter(outline, {offset = 0, drift = [0,0], below = 0, above = 0, miterLimit = Infinity} = {}) {
    if (!Array.isArray(outline) || outline.length < 3 || outline.length > 256 ||
      !Array.from(outline).every(q => vector(q, 2)) || !vector(drift, 2) ||
      ![offset, below, above].every(value => Number.isFinite(value) && value >= 0) ||
      !(miterLimit >= 1) || typeof miterLimit !== 'number')
      throw Error('A convex perimeter needs a valid outline and clearance');
    const points=outline.map(q=>q.slice()),base=points[0];
    const area=points.reduce((sum,[x,z],i)=>{
      const b=points[(i+1)%points.length];
      return sum+(x-base[0])*(b[1]-base[1])-(z-base[1])*(b[0]-base[0]);
    },0);
    if(!Number.isFinite(area)||Math.abs(area)<EPS)throw Error('Perimeter has no finite area');
    const winding=Math.sign(area);
    function pad(n){
      const speed=dot(n,drift);
      return offset+Math.max(0,-below*speed,above*speed);
    }
    const edges=points.map((a,i)=>{
      const b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<=EPS)throw Error('Perimeter has a repeated vertex');
      const n=[winding*dz/length,-winding*dx/length];
      return {a,n,pad:pad(n),edge:i,bevel:false};
    });
    let turn=0;
    const planes=edges.flatMap((edge,i)=>{
      const previous=edges[(i+edges.length-1)%edges.length],m=previous.n,n=edge.n,
        cross=winding*(m[0]*n[1]-m[1]*n[0]),cosine=dot(m,n);
      if(cross< -EPS||Math.abs(cross)<=EPS&&cosine<0)throw Error('Perimeter must be convex');
      turn+=Math.atan2(Math.max(0,cross),cosine);
      const sum=[m[0]+n[0],m[1]+n[1]],length=Math.hypot(...sum);
      if(offset===0||length/2>=1/miterLimit)return [edge];
      const normal=sum.map(value=>value/length);
      return [{...edge,n:normal,pad:pad(normal),bevel:true},edge];
    });
    if(Math.abs(turn-2*Math.PI)>1e-6)throw Error('Perimeter must make one convex turn');
    const poly=planes.map(({a,n,pad},i)=>{
      const previous=planes[(i+planes.length-1)%planes.length],m=previous.n,
        sum=[n[0]+m[0],n[1]+m[1]],delta=[n[0]-m[0],n[1]-m[1]],
        cosine=dot(sum,sum)/2,sine=dot(delta,delta)/2;
      if(cosine<.0008)throw Error('Perimeter offset is too acute');
      const d=previous.pad+dot(m,[previous.a[0]-a[0],previous.a[1]-a[1]]),
        normal=(pad+d)/(2*cosine),tangent=sine>EPS*EPS?(pad-d)/(2*sine):0;
      return [a[0]+normal*sum[0]+tangent*delta[0],a[1]+normal*sum[1]+tangent*delta[1]];
    });
    const sections=planes.map(({edge,bevel})=>({edge,bevel}));
    return P.data.freeze({poly,sections,planes});
  }

  function inclinedPerimeter(outline, pose, { offset = 0, below = 0, above = 0, miterLimit = Infinity } = {}) {
    if (!Array.isArray(outline) || outline.length < 3 || outline.length > 256 ||
      !Array.from(outline).every(q => vector(q, 2)) ||
      !vector(pose?.R, 9) || !vector(pose?.t, 3) ||
      ![offset, below, above].every(value => Number.isFinite(value) && value >= 0))
      throw new Error('An inclined perimeter needs a convex outline, an affine frame and nonnegative clearance');
    const R = pose.R, origin = pose.t.slice(), datum = origin[1], axis = Math.hypot(R[1], R[4], R[7]);
    if (!Number.isFinite(axis) || R[4] < EPS || R[4] < .2 * axis)
      throw new RangeError('Extrusion axis is too close to horizontal');
    const drift = [R[1] / R[4], R[7] / R[4]], frame=RouteVisibility.elevationFrame({drift,datum});
    function project([x, y, z]) {
      const q=frame.project([x,y,z]);
      q[1]=datum;
      return q;
    }
    function lift([x, , z], y) {
      return frame.lift([x,y,z]);
    }
    const points = outline.map(([x, z]) => {
      const y = R[3] * x + R[5] * z;
      return [origin[0] + R[0] * x + R[2] * z - drift[0] * y,
        origin[2] + R[6] * x + R[8] * z - drift[1] * y];
    });
    const contour=convexPerimeter(points,{offset,drift,below,above,miterLimit}),
      poly=contour.poly.map(([x,z])=>[x,datum,z]);
    const raw = points.map(([x, z]) => [x, datum, z]);

    function crossing(a, b, tolerance) {
      let lo = 0, hi = 1;
      for (const { a: q, n, pad } of contour.planes) {
        const u = n[0] * (a[0] - q[0]) + n[1] * (a[2] - q[1]) - pad + tolerance,
          v = n[0] * (b[0] - q[0]) + n[1] * (b[2] - q[1]) - pad + tolerance;
        if (u >= 0 && v >= 0) return false;
        if (u >= 0) lo = Math.max(lo, u / (u - v));
        if (v >= 0) hi = Math.min(hi, u / (u - v));
        if (lo >= hi - EPS) return false;
      }
      return true;
    }
    function allows(guide, tolerance = 1e-6) {
      if (!Array.isArray(guide) || !guide.length || !Array.from(guide).every(p => vector(p, 3)) ||
        !Number.isFinite(tolerance) || tolerance < 0)
        throw Error('An inclined clearance check needs guide vertices and a nonnegative tolerance');
      let a = project(guide[0]);
      for (let i = 0; i < guide.length; i++) {
        const b = i ? project(guide[i]) : a;
        if (crossing(a, b, tolerance)) return false;
        a = b;
      }
      return true;
    }
    return Object.freeze({ raw: P.data.freeze(raw), poly: P.data.freeze(poly), sections:contour.sections,
      frame, project, lift, allows });
  }

  P.geometry.convexPerimeter = convexPerimeter;
  P.geometry.inclinedPerimeter = inclinedPerimeter;
})(KIT);
