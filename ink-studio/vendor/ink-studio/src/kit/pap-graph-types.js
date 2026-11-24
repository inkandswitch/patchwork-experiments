/* Shared port validation for graph data and native toolkit handles. */
(function (K) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && typeof value.length === 'number';
  function all(values, valid) {
    if (!list(values)) return false;
    for (let i = 0; i < values.length; i++) if (!valid(values[i])) return false;
    return true;
  }
  const vector = (value, length) => Array.isArray(value) && value.length === length && all(value, Number.isFinite);
  const dimensions = value => Number.isSafeInteger(value?.width) && value.width > 0 &&
    Number.isSafeInteger(value.height) && value.height > 0 && Number.isSafeInteger(value.width * value.height);
  function raster(value) {
    if (!dimensions(value) || !list(value.data)) return false;
    const channels = value.channels ?? value.data.length / (value.width * value.height);
    return Number.isSafeInteger(channels) && channels >= 1 && channels <= 4 &&
      value.data.length === value.width * value.height * channels &&
      (value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray || all(value.data, Number.isFinite));
  }
  function path(value) {
    const points = Array.isArray(value) ? value : value?.points;
    const width = points?.[0]?.length;
    return Array.isArray(points) && points.length >= 2 && (width === 2 || width === 3) &&
      all(points, point => vector(point, width)) &&
      (value.closed === undefined || typeof value.closed === 'boolean');
  }
  function mesh(value) {
    if (!record(value)) return false;
    const {points,faces} = value;
    if (Array.isArray(points) && Array.isArray(faces)) {
      return points.length > 0 && all(points, point => vector(point, 3)) &&
        all(faces, face => list(face) && face.length >= 3 && all(face, index => vertex(index, points.length)));
    }
    const positions = value.pos ?? value.positions ?? points;
    const indices = value.tri ?? value.indices ?? value.triangles;
    return list(positions) && positions.length > 0 && positions.length % 3 === 0 && all(positions, Number.isFinite) &&
      list(indices) && indices.length % 3 === 0 && all(indices, index => vertex(index, positions.length / 3));
  }
  const vertex = (index,count) => Number.isSafeInteger(index) && index >= 0 && index < count;
  const unit = value => Number.isFinite(value) && value>=0 && value<=1;
  function palette(value) {
    const colors = list(value) ? value : value?.palette;
    return list(colors) && colors.length >= 1 && colors.length <= 256 && all(colors, color =>
      typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ||
      Number.isSafeInteger(color) && color >= 0 && color <= 0xffffff ||
      vector(color, 3) && all(color, unit));
  }
  function atlas(value) {
    if (!record(value)) return false;
    if (value[Symbol.for('ink-studio.sprite-atlas')] === true &&
        typeof value.select === 'function' && typeof value.snapshot === 'function') return true;
    const {metadata,images} = value;
    if (!dimensions(metadata) || !record(images) || !list(images.color)) return false;
    const frames = metadata.frames === undefined && metadata.scenery !== undefined
      ? [{rect:{x:0,y:0,width:metadata.width,height:metadata.height}}] : metadata.frames;
    return Array.isArray(frames) && frames.length > 0 && Object.values(images).every(buffer => list(buffer) &&
      buffer.length === metadata.width * metadata.height * 4 &&
      (buffer instanceof Uint8Array || buffer instanceof Uint8ClampedArray ||
        all(buffer, n => Number.isInteger(n) && n>=0 && n<=255))) &&
      all(frames, frame => {
        const rect = frame?.rect;
        return dimensions(rect) && Number.isSafeInteger(rect.x) && Number.isSafeInteger(rect.y) &&
          rect.x>=0 && rect.y>=0 && rect.x+rect.width<=metadata.width && rect.y+rect.height<=metadata.height;
      });
  }
  function audio(value) {
    const {sampleRate,channels,samples} = value ?? {};
    return Number.isSafeInteger(sampleRate) && sampleRate > 0 && Number.isSafeInteger(channels) && channels > 0 &&
      list(samples) && samples.length <= 32000000 && samples.length % channels === 0 && all(samples, n => Number.isFinite(n) && n>=-1 && n<=1);
  }

  const checks = {
    any: () => true,
    number: Number.isFinite,
    boolean: value => typeof value === 'boolean',
    string: value => typeof value === 'string',
    vec2: value => vector(value, 2),
    vec3: value => vector(value, 3),
    array: Array.isArray,
    record: value => record(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)),
    geometry: value => record(value) && ((value.points && value.faces) || (value.pos && value.tri) || value.positions || mesh(value)),
    field: value => typeof value === 'function' || typeof value?.sample === 'function',
    points: Array.isArray,
    world: value => record(value) && Number.isSafeInteger(value.count) && value.count >= 0 &&
      list(value.data) && value.data.length >= value.count * 16,
    renderFrame: value => record(value) && Number.isSafeInteger(value.w) && value.w > 0 &&
      Number.isSafeInteger(value.h) && value.h > 0 && list(value.rgb) && value.rgb.length === value.w * value.h * 3,
    image: value => record(value) && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) && value.data,
    raster, path, mesh, palette, atlas, audio
  };
  function element(type) {
    if (type === 'array' || type === 'points') return 'any';
    return typeof type === 'string' && type.startsWith('array<') && type.endsWith('>') ? type.slice(6,-1) : undefined;
  }
  function validator(type) {
    if (typeof type !== 'string' || type.length > 128) return;
    if (Object.hasOwn(checks,type)) return checks[type];
    const item = element(type), check = item && validator(item);
    if (check) return values => Array.isArray(values) && all(values,check);
  }
  function compatible(from,to) {
    if (from === to || from === 'any' || to === 'any') return true;
    const alias = type => type === 'image' ? 'raster' : type === 'geometry' ? 'mesh' : type;
    if (alias(from) === alias(to)) return true;
    const a = element(from), b = element(to);
    return Boolean(a && b && compatible(a,b));
  }
  K.procedural.graphTypes = Object.freeze({validator,compatible});
})(KIT);
