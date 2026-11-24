/* A scene clock, height-dependent optical depth, and surface deposition. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const clamp = v => Math.max(0, Math.min(1, v)), TAU = 2 * Math.PI;
  const wrap = (v, span) => ((v % span) + span) % span;
  const within = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const ease = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const fogDefaults = { density: .038, height: 2.2, floor: 0, cling: .65, color: [.67, .74, .73] };
  const defaults = P.data.freeze({ hour: 12, rate: 0, latitude: 39, declination: 18, north: 0,
    fog: fogDefaults, autumn: 0, snow: 0, wind: [.18, .10] });

  function medium(options = {}) {
    const f = { ...fogDefaults, ...options };
    if (!within(f.density, 0, 2) || !within(f.height, .03, 128) || !within(f.floor, -256, 256) ||
        !within(f.cling, 0, 1) || !vector(f.color) || !f.color.every(v => within(v, 0, 1)))
      throw Error('Invalid height-fog medium');
    return { density: f.density, height: f.height, floor: f.floor, cling: f.cling, color: f.color.slice() };
  }

  function evaluate(options = {}, elapsed = 0) {
    const p = { ...defaults, ...options };
    if (!within(p.hour, 0, 24) || !within(p.rate, -24, 24) || !within(p.latitude, -90, 90) ||
        !within(p.declination, -90, 90) || !Number.isFinite(p.north) || !Number.isFinite(elapsed) ||
        !within(p.autumn, 0, 1) || !within(p.snow, 0, 1) || !Array.isArray(p.wind) ||
        p.wind.length !== 2 || !p.wind.every(v => within(v, -20, 20))) throw Error('Invalid environment clock or surface settings');
    const period = p.rate ? 24 / Math.abs(p.rate) : Infinity;
    const advance = (Number.isFinite(period) ? elapsed % period : elapsed) * p.rate;
    const hour = wrap(p.hour + advance, 24),
      a = (hour - 12) * TAU / 24, lat = p.latitude * TAU / 360, dec = p.declination * TAU / 360,
      north = wrap(p.north, 360) * TAU / 360;
    const east = -Math.sin(a) * Math.cos(dec), up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(a),
      south = Math.sin(lat) * Math.cos(dec) * Math.cos(a) - Math.cos(lat) * Math.sin(dec);
    const sun = [east * Math.cos(north) + south * Math.sin(north), up, -east * Math.sin(north) + south * Math.cos(north)];
    const daylight = ease(-.18, .31, up), twilight = (1 - ease(.02, .52, Math.abs(up))) * ease(-.24, -.05, up);
    const tint = [.67 + daylight * .33 + twilight * .2, .78 + daylight * .22 + twilight * .02, 1.08 - daylight * .08 - twilight * .16];
    return P.data.freeze({ hour, sun, daylight, twilight, ambient: .36 + .64 * daylight, tint,
      fog: medium(p.fog), autumn: p.autumn, snow: p.snow, wind: p.wind.slice(),
      ...(p.coating===undefined?{}:{coating:coatingProfile(p.coating)}) });
  }

  function opticalDepth(from, to, options) {
    if (!vector(from) || !vector(to)) throw Error('Fog segment needs finite XYZ endpoints');
    const f = medium(options), low = (Math.min(from[1], to[1]) - f.floor) / f.height,
      high = (Math.max(from[1], to[1]) - f.floor) / f.height, span = high - low;
    const below = Math.max(0, -low) - Math.max(0, -high);
    const mean = span < 1e-5 ? Math.exp(-Math.max(0, low)) :
      (below + Math.exp(-Math.max(0, low)) - Math.exp(-Math.max(0, high))) / span;
    return V.dist(from, to) * f.density * (1 - f.cling + f.cling * clamp(mean));
  }

  function deposition({ normal, load, exposure = 1, shelter = 0, texture = .5, slope = [.28, .88] }) {
    if (!vector(normal) || V.len(normal) < 1e-8 || ![load, exposure, shelter, texture].every(v => within(v, 0, 1)) ||
        !Array.isArray(slope) || slope.length !== 2 || !slope.every(v => within(v, -1, 1)) || slope[0] >= slope[1])
      throw Error('Deposition needs a surface normal and bounded coverage inputs');
    const angle = ease(slope[0], slope[1], normal[1] / V.len(normal));
    return clamp(load * angle * exposure * (.65 + .5 * texture + .26 * shelter));
  }

  const coatingRoles = Object.freeze(['other','foliage','wood','roof','stone','soil','metal','plaster']);
  const coatingDefaults = P.data.freeze({
    slope: [.28,.88], bias: 0, blend: [.12,.92], variation: .5, depth: 0,
    shadow: [.50,.60,.66], highlight: [.95,.96,.90],
    retention: { other:1, foliage:.84, wood:.80, roof:1, stone:1, soil:.94, metal:.58, plaster:.90 }
  });
  const compiledCoats = new WeakMap([[coatingDefaults,coatingDefaults]]);
  const orderedPair = (pair, min, max) => Array.isArray(pair) && pair.length === 2 &&
    within(pair[0],min,max) && within(pair[1],min,max) && pair[0] < pair[1];

  function coatingProfile(raw = coatingDefaults) {
    const compiled=compiledCoats.get(raw);
    if (compiled) return compiled;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        raw.retention !== undefined && (!raw.retention || typeof raw.retention !== 'object' || Array.isArray(raw.retention)))
      throw Error('Coating needs a profile and a material retention map');
    const p={...coatingDefaults,...raw,retention:{...coatingDefaults.retention,...raw.retention}};
    if (!orderedPair(p.slope,-1,1) || !orderedPair(p.blend,0,1) ||
        !within(p.bias,-.5,.5) || !within(p.variation,0,1) || !within(p.depth,0,16) ||
        ![p.shadow,p.highlight].every(color=>vector(color)&&Array.from(color).every(v=>within(v,0,1))) ||
        Object.keys(p.retention).length>64 ||
        !Object.entries(p.retention).every(([role,amount])=>/^[a-z][a-z0-9_-]{0,47}$/i.test(role)&&within(amount,0,1)))
      throw Error('Coating needs ordered slope and blend bounds, normalized colors, bounded depth and retention');
    const profile=P.data.freeze({slope:p.slope.slice(),blend:p.blend.slice(),bias:p.bias,variation:p.variation,
      depth:p.depth,shadow:p.shadow.slice(),highlight:p.highlight.slice(),retention:p.retention});
    compiledCoats.set(profile,profile);
    if (P.data.isImmutable(raw)) compiledCoats.set(raw,profile);
    return profile;
  }

  function coatingAmount({normal,load,texture=.5,exposure=1,material='other'}, raw) {
    if (!vector(normal) || !Array.from(normal).every(Number.isFinite) || V.len(normal)<1e-8 ||
        ![load,texture,exposure].every(v=>within(v,0,1)) || typeof material !== 'string')
      throw Error('Coating sample needs a normal and normalized load, texture and exposure');
    const p=coatingProfile(raw), keep=Object.hasOwn(p.retention,material)?p.retention[material]:p.retention.other;
    const vertical=normal[1]/V.len(normal), up=clamp(vertical);
    return clamp(load * exposure * keep * (.9+p.variation*(texture-.5)) *
      ease(...p.slope,vertical+p.bias*4*up*(1-up)));
  }

  function coatingColor(color, amount, raw) {
    if (!vector(color) || !Array.from(color).every(v=>within(v,0,1)) || !within(amount,0,1))
      throw Error('Coating color needs normalized RGB and amount');
    const p=coatingProfile(raw), light=.32+.68*V.dot(color,[.26,.64,.10]), blend=ease(...p.blend,amount);
    return color.map((c,i)=>c+(p.shadow[i]+(p.highlight[i]-p.shadow[i])*light-c)*blend);
  }

  function coatingThickness(amount, raw) {
    if (!within(amount,0,1)) throw Error('Coating thickness needs a normalized amount');
    const p = coatingProfile(raw);
    return p.depth * ease(...p.blend,amount);
  }

  // Preserve the lower three-sigma bound of the substrate in the normal direction.
  function coatingShape({point,normal,covariance,amount}, raw) {
    if (!vector(point) || !vector(normal) || V.len(normal)<1e-8 ||
        (!Array.isArray(covariance) && !ArrayBuffer.isView(covariance)) || covariance.length!==9 ||
        !Array.from(covariance).every(Number.isFinite)) throw Error('Coating shape needs a point, normal and finite 3x3 covariance');
    const depth = coatingThickness(amount,raw), n = V.norm(normal);
    const sigma = Math.sqrt(Math.max(0,V.dot(n,K.M.app(covariance,n)))), pad = depth / 6;
    const increase = pad * (2 * sigma + pad);
    return { depth, point:V.mad(point,n,depth*.5),
      covariance:Array.from(covariance,(c,i)=>c+increase*n[Math.floor(i/3)]*n[i%3]) };
  }

  const coatingGlsl = Object.freeze({
    amount: `
float coatingAmount(float vertical, float load, float grain, float keep, vec4 profile) {
  float up = clamp(vertical, 0.0, 1.0);
  return clamp(load * keep * (.9 + profile.w * (grain - .5)) *
    smoothstep(profile.x, profile.y, vertical + profile.z * 4.0 * up * (1.0 - up)), 0.0, 1.0);
}
`,
    shape: `
void coatingExpand(inout vec3 p, inout mat3 cov, vec3 n, float amount, vec3 profile) {
  float depth = profile.z * smoothstep(profile.x, profile.y, amount);
  if (depth <= 0.0) return;
  float sigma = sqrt(max(0.0, dot(n, cov * n)));
  float pad = depth / 6.0;
  cov += pad * (2.0 * sigma + pad) * outerProduct(n, n);
  p += n * (depth * .5);
}
`,
    color: `
vec3 coatingColor(vec3 base, float amount, vec2 blend, vec3 shadow, vec3 highlight) {
  float light = .32 + .68 * dot(base, vec3(.26, .64, .10));
  return mix(base, mix(shadow, highlight, light), smoothstep(blend.x, blend.y, amount));
}
`
  });

  function scatter(from, to, light, options) {
    if (!vector(from) || !vector(to) || !vector(light?.p) || !within(light.radius, .001, 1024) || !within(light.intensity, 0, 64))
      throw Error('Fog light needs finite endpoints, a position, radius and intensity');
    const f = medium(options), length = V.dist(from, to);
    if (!length || !f.density || !light.intensity) return 0;
    const ray = V.mul(V.sub(to, from), 1 / length), delta = V.sub(light.p, from),
      near = V.dot(delta, ray), perp2 = Math.max(0, V.dot(delta, delta) - near * near), rr = light.radius ** 2;
    if (perp2 >= rr) return 0;
    const chord = Math.sqrt(rr - perp2), enter = Math.max(0, near - chord), exit = Math.min(length, near + chord);
    if (exit <= enter) return 0;
    const y = from[1] + ray[1] * (enter + exit) * .5,
      density = f.density * (1 - f.cling + f.cling * Math.exp(-Math.max(0, y - f.floor) / f.height)),
      amount = (exit - enter) * density * (1 - perp2 / rr) * light.intensity;
    return -Math.expm1(-amount * .72) * Math.exp(-opticalDepth(from, to, f) * .38 * enter / Math.max(1, length));
  }

  const coating=Object.freeze({defaults:coatingDefaults,roles:coatingRoles,profile:coatingProfile,
    amount:coatingAmount,color:coatingColor,thickness:coatingThickness,shape:coatingShape,glsl:coatingGlsl});
  P.environmentFields = Object.freeze({ defaults, evaluate, medium, opticalDepth, deposition, scatter, coating });
})(KIT);
