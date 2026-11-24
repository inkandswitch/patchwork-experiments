/* Exact bounded evaluations for repeated convex and masked-height probes. */
(function (K) {
  function halfspaces(planes) {
    if (!Array.isArray(planes) || !planes.length) throw Error('A convex field needs planes');
    const packed = new Float64Array(planes.length * 4);
    for (const [i, plane] of planes.entries()) {
      if (!Array.isArray(plane?.normal) || plane.normal.length !== 3 ||
          !Array.from(plane.normal).every(Number.isFinite) || !Number.isFinite(plane.offset))
        throw Error('A field plane needs a finite normal and offset');
      packed.set(plane.normal, i*4);
      packed[i*4+3] = plane.offset;
    }
    let lastX, lastY, lastZ, lastValue, complete = false;
    return function distance(x, y, z, limit = Infinity) {
      if (x === lastX && y === lastY && z === lastZ && (complete || lastValue > limit))
        return lastValue;
      let value = -Infinity, i = 0;
      for (; i < packed.length; i += 4) {
        value = Math.max(value, packed[i]*x + packed[i+1]*y + packed[i+2]*z - packed[i+3]);
        if (value > limit) break;
      }
      lastX=x; lastY=y; lastZ=z; lastValue=value;
      complete=i >= packed.length-4;
      return value;
    };
  }

  function heightMask({ height, mask, scale, minimumHeight, minimumScale = 0 }) {
    if (typeof height !== 'function' || typeof mask !== 'function' || typeof scale !== 'function' ||
        !Number.isFinite(minimumHeight) || !Number.isFinite(minimumScale) || minimumScale < 0 || minimumScale > 1)
      throw Error('A masked height field needs bounded height and distance-scale callbacks');
    return function distance(x, y, z) {
      const horizontal = mask(x,z), rise = y-minimumHeight;
      const upper = rise >= 0 ? rise : rise*minimumScale;
      if (horizontal > upper) return horizontal;
      return Math.max((y-height(x,z))*scale(x,z),horizontal);
    };
  }

  // Compute max(floor, min(first, second)). Evaluate the cheaper or
  // usually closer field first to skip an unnecessary second probe.
  function unionFloor(first, second) {
    if (typeof first !== 'function' || typeof second !== 'function')
      throw Error('A bounded union needs two field callbacks');
    return function distance(point, floor = -Infinity) {
      const a = first(point);
      return a <= floor ? floor : Math.max(floor, Math.min(a, second(point)));
    };
  }

  K.boundedFields = Object.freeze({ halfspaces, heightMask, unionFloor });
})(KIT);
