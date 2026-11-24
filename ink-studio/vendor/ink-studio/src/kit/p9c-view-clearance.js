/* Camera-relative visibility for an explicitly selected layer of geometry. */
(function (K) {
  const P=K.procedural||K.authoring,{V}=K;
  const vector=v=>Array.isArray(v)&&v.length===3&&Array.from(v).every(Number.isFinite);
  const smooth=(lo,hi,v)=>{
    const t=K.clamp((v-lo)/(hi-lo),0,1);
    return t*t*(3-2*t);
  };

  function compile({eye,target,radius=1,feather=.55,endFade=.6,opacity=0,reach}={}) {
    if (!vector(eye)||!vector(target)||![radius,feather,endFade,opacity].every(Number.isFinite)||
        radius<=0||feather<=0||endFade<=0||opacity<0||opacity>1||
        reach!==undefined&&(!Number.isFinite(reach)||reach<=0))
      throw Error('View clearance needs finite camera points and valid profile dimensions');
    const delta=V.sub(target,eye), distance=V.len(delta), outer=radius+feather;
    if (!Number.isFinite(distance)||distance<=1e-6||!Number.isFinite(outer)||outer<=radius)
      throw Error('View clearance needs a camera direction and distinct radial limits');
    const origin=Object.freeze(eye.slice()), axis=Object.freeze(V.mul(delta,1/distance)),
      depth=reach??distance, fade=Math.min(endFade,depth);
    function opacityAt(point) {
      if (!vector(point)) throw Error('View clearance samples must be finite points');
      const offset=V.sub(point,origin), t=V.dot(offset,axis);
      if (t<0||t>=depth) return 1;
      const r=V.len(V.mad(offset,axis,-t));
      return 1-(1-opacity)*(1-smooth(radius,outer,r))*(1-smooth(depth-fade,depth,t));
    }
    return Object.freeze({eye:origin,axis,depth,radius,outer,fade,opacity,opacityAt});
  }

  const glsl=`
float viewClearanceOpacity(vec3 offset, vec4 axis, vec4 profile) {
  float t = dot(offset, axis.xyz);
  if (t < 0.0 || t >= axis.w) return 1.0;
  float r = length(offset - axis.xyz * t);
  float radial = 1.0 - smoothstep(profile.x, profile.y, r);
  float ending = 1.0 - smoothstep(axis.w - profile.z, axis.w, t);
  return 1.0 - (1.0 - profile.w) * radial * ending;
}`;
  P.viewClearance=Object.freeze({compile,glsl});
})(KIT);
