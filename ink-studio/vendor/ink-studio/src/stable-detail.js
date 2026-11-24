/* Continuous detail weights measured in native art pixels. */
const StableDetail = (() => {
  const channels = { texture:[.55,1.65], geometry:[.35,1.45], specular:[.5,1.6] };
  // Small static strokes can fade independently of the opaque surface underneath.
  const stroke = 16, mask = 15 | stroke | 32 | 64 | 128 | 256 | 2048 | 32768;
  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !Object.hasOwn(channels,key)))
      throw new TypeError('Stable detail needs texture, geometry and specular fade ranges');
    return Object.fromEntries(Object.entries(channels).map(([name, defaults]) => {
      const range = value[name] === undefined ? defaults : value[name];
      if (range === false) return [name, null];
      if (!Array.isArray(range) || range.length !== 2 || !Array.from(range).every(Number.isFinite) ||
          range[0] < 0 || range[0] >= range[1])
        throw new RangeError('Stable detail ' + name + ' needs an increasing nonnegative art-pixel range');
      return [name, range.slice()];
    }));
  }

  function weight(range, pixels) {
    if (!range || pixels >= range[1]) return 1;
    if (pixels <= range[0]) return 0;
    const t = (pixels-range[0])/(range[1]-range[0]);
    return t*t*(3-2*t);
  }

  function eigen(a,b,c) { return .5*(a+c+Math.hypot(a-c,2*b)); }

  function texturePixels(ux,uy,vx,vy,artScale) {
    const a=ux*ux+uy*uy, b=ux*vx+uy*vy, c=vx*vx+vy*vy;
    // Area divided by the long singular axis gives the short one without cancellation.
    return Math.abs(ux*vy-uy*vx)/(2*artScale*Math.sqrt(Math.max(eigen(a,b,c),1e-20)));
  }

  function geometryPixels(a,b,c,artScale) {
    return 2*Math.sqrt(Math.max(0,eigen(a,b,c)))/artScale;
  }

  const strokeEligible = code => (code & mask) === stroke;
  const glsl = `
float detailWeight(vec2 range, float pixels) {
  return range.y > range.x ? smoothstep(range.x,range.y,pixels) : 1.0;
}
float detailEigen(float a, float b, float c) {
  return 0.5 * (a + c + length(vec2(a-c,2.0*b)));
}
float detailTexturePixels(vec2 u, vec2 v, float scale) {
  return abs(u.x*v.y-u.y*v.x)/(2.0*scale*sqrt(max(detailEigen(dot(u,u),dot(u,v),dot(v,v)),1e-20)));
}
float detailGeometryPixels(float a, float b, float c, float scale) {
  return 2.0*sqrt(max(0.0,detailEigen(a,b,c)))/scale;
}
bool detailStroke(int code) { return (code & ${mask}) == ${stroke}; }
`;
  return Object.freeze({ prepare, weight, texturePixels, geometryPixels, strokeEligible, glsl });
})();
if (typeof module !== 'undefined') module.exports = StableDetail;
