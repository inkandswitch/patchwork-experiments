/* Output-space layers with independent sample grids. All images use top-down rows. */
const FrameComposite = (() => {
  const primitives = typeof DrawingPrimitives === 'undefined' ? require('./drawing-primitives.js') : DrawingPrimitives;
  const annotations = typeof ViewAnnotations === 'undefined' ? require('./view-annotations.js') : ViewAnnotations;
  const byte = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const tuple = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);
  const textureSource = Symbol.for('ink-studio.composite-texture');
  const clamp = n => Math.min(1, Math.max(0, n));

  function record(value, fields, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
      throw new TypeError('Invalid ' + name);
  }

  function resolution(value) {
    if (value === undefined || positive(value)) return value;
    if (tuple(value, 2) && value.every(positive)) return value.slice();
    throw new RangeError('Resolution must be a positive pixel size or [width, height]');
  }

  function filter(value = 'nearest') {
    if (value !== 'nearest' && value !== 'linear') throw new TypeError('Layer filter must be nearest or linear');
    return value;
  }

  function image(source) {
    const { w, h, rgba, rgb, alpha } = source ?? {};
    if (!positive(w) || !positive(h)) throw new RangeError('A composite source needs positive integer dimensions');
    const length = w * h;
    if (rgba !== undefined ? !byte(rgba) || rgba.length !== length * 4 :
      !byte(rgb) || rgb.length !== length * 3 || alpha !== undefined && (!byte(alpha) || alpha.length !== length))
      throw new TypeError('A composite source needs top-down RGBA bytes, or RGB and optional alpha bytes');
    return source;
  }

  function strokeWidth(value) {
    if (!(Number.isFinite(value) && value > 0)) throw new RangeError('Stroke width must be positive and finite');
    return value;
  }

  function command(value) {
    switch (value?.type) {
      case 'text': {
        record(value, ['type', 'text', 'at', 'size', 'width', 'color'], 'text command');
        const { text, at, size = 12, width } = value;
        if (typeof text !== 'string' || !tuple(at, 2)) throw new TypeError('Text needs a string and XY anchor');
        return { type: 'text', text, at: at.slice(), size: strokeWidth(size),
          width: width === undefined ? undefined : strokeWidth(width), color: primitives.color(value.color) };
      }
      case 'rect': {
        record(value, ['type', 'rect', 'color'], 'rectangle command');
        const { rect } = value;
        if (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0) throw new RangeError('A rectangle needs finite XY and positive size');
        return { type: 'rect', rect: rect.slice(), color: primitives.color(value.color) };
      }
      default: return primitives.command(value);
    }
  }

  function settings(value) {
    if (value === false || value === undefined) return null;
    record(value, ['world', 'layers'], 'frame composite');
    const { world = {}, layers = [] } = value;
    record(world, ['resolution', 'filter'], 'world composite');
    if (!Array.isArray(layers)) throw new TypeError('Composite layers must be an ordered list');
    const prepared = Array.from(layers, layer => {
      record(layer, ['resolution', 'filter', 'opacity', 'blend', 'draw', 'source', 'annotations', 'rect'], 'composite layer');
      const { opacity = 1, blend = 'over', draw, source, rect } = layer;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('Layer opacity must be in [0, 1]');
      if (blend !== 'over' && blend !== 'add') throw new TypeError('Layer blend must be over or add');
      const layout = annotations.prepare(layer.annotations);
      const hasDrawing = draw !== undefined || layout !== null;
      if (hasDrawing === (source !== undefined) || draw !== undefined && !Array.isArray(draw))
        throw new TypeError('A layer needs drawing commands, annotations or a raster source');
      if (rect !== undefined && (hasDrawing || !tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0 ||
        !Number.isFinite(rect[0] + rect[2]) || !Number.isFinite(rect[1] + rect[3])))
        throw new RangeError('A raster layer rectangle needs finite XY and positive size');
      if (source !== undefined && typeof source !== 'function') image(source);
      return { resolution: resolution(layer.resolution), filter: filter(layer.filter), opacity, blend, source, layout, rect: rect?.slice(),
        draw: draw && Array.from(draw, command) };
    });
    return { world: { resolution: resolution(world.resolution), filter: filter(world.filter) }, layers: prepared,
      needsCamera: prepared.some(layer => layer.opacity > 0 && (layer.layout?.needsCamera || layer.draw?.some(draw => draw.needsCamera))) };
  }

  function size(value, w, h) {
    const [width, height] = Array.isArray(value) ? value : [Math.ceil(w / value), Math.ceil(h / value)];
    if (!positive(width) || !positive(height) || width * height > 0x1fffffff)
      throw new RangeError('Composite dimensions exceed the supported byte buffer size');
    return { w: width, h: height };
  }

  function prepare(value, w, h, pixelSize = 1) {
    const prepared = settings(value);
    if (!prepared) return null;
    size(1, w, h);
    return { ...size(1, w, h), needsCamera: prepared.needsCamera,
      world: { ...size(prepared.world.resolution ?? resolution(pixelSize), w, h), filter: prepared.world.filter },
      layers: prepared.layers.map(layer => {
        const grid = layer.resolution ?? (layer.source && typeof layer.source !== 'function' ? [layer.source.w, layer.source.h] : 1);
        const dest = layer.rect ?? [0, 0, w, h];
        return { ...layer, dest, ...size(grid, Math.ceil(dest[2]), Math.ceil(dest[3])) };
      }) };
  }

  function pixels(source) {
    const { w, h, rgba, rgb, alpha } = image(source);
    const output = new Uint8Array(w * h * 4);
    const data = rgba ?? rgb, stride = rgba ? 4 : 3;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4, j = p * stride;
      const a = rgba ? rgba[i + 3] : alpha?.[p] ?? 255;
      for (let c = 0; c < 3; c++) output[i + c] = Math.round(data[j + c] * a / 255);
      output[i + 3] = a;
    }
    return { w, h, data: output };
  }

  function drawLayer(layer, w, h, text, camera, drawn, hard = false, budget) {
    const precise = budget !== undefined;
    const data = precise ? new Float32Array(layer.w * layer.h * 4) : new Uint8Array(layer.w * layer.h * 4);
    const quantize = precise ? n => n : Math.round;
    const mask = new Float32Array(layer.w * layer.h);
    const sx = w / layer.w, sy = h / layer.h, aa = Math.max(sx, sy);
    let dirty, coverage, work = 0;
    function spend(cost) {
      if (precise && (work += cost) > budget) throw new RangeError('Drawing exceeds its raster work budget');
    }
    function bounds(x, y, right, bottom) {
      const x0 = Math.max(0, Math.floor(x / sx)), y0 = Math.max(0, Math.floor(y / sy));
      const x1 = Math.min(layer.w, Math.ceil(right / sx)), y1 = Math.min(layer.h, Math.ceil(bottom / sy));
      if (x1 <= x0 || y1 <= y0) return null;
      spend((x1 - x0) * (y1 - y0));
      dirty = dirty ? [Math.min(x0, dirty[0]), Math.min(y0, dirty[1]), Math.max(x1, dirty[2]), Math.max(y1, dirty[3])] :
        [x0, y0, x1, y1];
      return [x0, y0, x1, y1];
    }
    function raster(x, y, right, bottom, sample) {
      const area = bounds(x, y, right, bottom);
      if (!area) return;
      const [x0,y0,x1,y1] = area;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
        const p = j * layer.w + i;
        mask[p] = Math.max(mask[p], sample(i * sx, j * sy));
      }
    }
    function line([ax,ay], [bx,by], width, lastWidth = width) {
      const radius = width*.5, endRadius = lastWidth*.5, reach = Math.max(radius,endRadius) + aa*.5;
      const dx = bx-ax, dy = by-ay, length = dx*dx + dy*dy;
      raster(Math.min(ax,bx)-reach, Math.min(ay,by)-reach, Math.max(ax,bx)+reach, Math.max(ay,by)+reach, (x,y) => {
        const X = x + sx*.5 - ax, Y = y + sy*.5 - ay;
        const t = length ? clamp((X*dx + Y*dy)/length) : 0;
        const r = radius + (endRadius-radius)*t;
        return clamp(.5 + (r - Math.hypot(X-dx*t,Y-dy*t))/aa);
      });
    }
    function lettering({ text: label, at: [x,y], size, width }) {
      const glyphs = text(label,size,{ width });
      for (const stroke of glyphs.strokes)
        for (let i = 1; i < stroke.length; i++) {
          const [a,b] = [stroke[i-1],stroke[i]];
          line([x+a[0],y-a[1]],[x+b[0],y-b[1]],glyphs.width);
        }
    }
    function polygon(rings) {
      if (!rings.length) return;
      const points = rings.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const area = bounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      if (!area) return;
      const [x0,y0,x1,y1] = area;
      const edges = rings.flatMap(ring => ring.map((a,i) => [a,ring[(i+1)%ring.length]]));
      coverage ??= new Float32Array(layer.w);
      const samples = 4, invPixel = 1/(sx*samples);
      spend((y1-y0)*samples*(edges.length+x1-x0));
      for (let y = y0; y < y1; y++) {
        coverage.fill(0,x0,x1);
        for (let sub = 0; sub < samples; sub++) {
          const at = (y + (sub+.5)/samples)*sy, crossings = [];
          for (const [[ax,ay],[bx,by]] of edges)
            if ((ay > at) !== (by > at)) crossings.push(ax + (bx-ax)*(at-ay)/(by-ay));
          crossings.sort((a,b) => a-b);
          for (let i = 0; i+1 < crossings.length; i += 2) {
            const left = crossings[i], right = crossings[i+1];
            const start = Math.max(x0,Math.floor(left/sx)), end = Math.min(x1,Math.ceil(right/sx));
            for (let x = start; x < end; x++)
              coverage[x] += Math.max(0,Math.min((x+1)*sx,right)-Math.max(x*sx,left))*invPixel;
          }
        }
        for (let x = x0; x < x1; x++) {
          const p = y*layer.w+x;
          mask[p] = Math.max(mask[p],clamp(coverage[x]));
        }
      }
    }
    function paint(rgba) {
      if (!dirty) return;
      const [x0,y0,x1,y1] = dirty;
      spend((x1-x0)*(y1-y0));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = y*layer.w+x;
        if (!mask[p]) continue;
        const opacity = rgba[3]/255*mask[p], q = p*4;
        const a = hard === 'coverage' ? rgba[3]/255*Number(mask[p] >= .5) :
          hard ? Number(opacity >= .5) : opacity;
        for (let c = 0; c < 4; c++)
          data[q+c] = quantize(data[q+c]*(1-a) + (c === 3 ? 255 : rgba[c])*a);
        mask[p] = 0;
      }
      dirty = undefined;
    }
    for (const draw of drawn) {
      if (draw.type === 'bitmapStamp') {
        const {at: [x,y], stamp} = draw;
        raster(x,y,x+stamp.width,y+stamp.height,(u,v) => Number(stamp.data[((v-y)*stamp.width+u-x)*4+3]>0));
        paint(stamp.color);
      } else if (draw.type === 'text') {
        lettering(draw);
        paint(draw.color);
      } else if (draw.type === 'rect') {
        const [x,y,width,height] = draw.rect, right = x+width, bottom = y+height;
        raster(x,y,right,bottom,(u,v) =>
          (Math.min(u+sx,right)-Math.max(u,x))*(Math.min(v+sy,bottom)-Math.max(v,y))/(sx*sy));
        paint(draw.color);
      } else for (const batch of primitives.geometry(draw,camera,w,h)) {
        for (const segment of batch.lines) line(...segment);
        for (const rings of batch.fills) polygon(rings);
        for (const label of batch.labels) lettering(label);
        paint(batch.color);
      }
    }
    return { w: layer.w, h: layer.h, data };
  }

  function paintMap(w, h, strokes) {
    if (strokes.some(stroke => !['path', 'polygon', 'rect'].includes(stroke?.type) ||
        stroke.space !== undefined && stroke.space !== 'screen'))
      throw new TypeError('Paint maps use pixel paths, polygons and rectangles');
    return drawLayer({ w, h }, w, h, null, null, Array.from(strokes, command), true).data;
  }

  function screenDrawing(width, height, strokes, {edges = 'smooth', bitmap} = {}) {
    if (!positive(width) || !positive(height) || width > 8192 || height > 8192 || width * height > 8e6 ||
        !Array.isArray(strokes) || strokes.length > 8192 || !['smooth','hard'].includes(edges))
      throw new RangeError('Invalid screen drawing dimensions, edge filter or command count');
    function* drawn() {
      for (const draw of strokes) {
        if (draw?.type === 'text' && typeof bitmap === 'function') yield bitmap(draw);
        else {
          if (!['rect','polygon','path','arrow','grid'].includes(draw?.type) ||
              draw.space !== undefined && draw.space !== 'screen')
            throw new TypeError('Standalone drawing commands use screen-space shapes and bitmap text');
          yield command(draw);
        }
      }
    }
    const {data} = drawLayer({w:width,h:height},width,height,null,null,drawn(),edges==='hard' && 'coverage',64e6);
    const out = new Uint8Array(data.length);
    for (let i=0; i<data.length; i+=4) {
      const a=data[i+3];
      out[i+3]=Math.round(a);
      if (out[i+3]) for (let c=0; c<3; c++) out[i+c]=Math.round(Math.min(255,255*data[i+c]/a));
    }
    return {width,height,channels:4,data:out};
  }

  function layers(plan, world, time, text, camera, resolve, gl) {
    return plan.layers.filter(layer => layer.opacity > 0).map(layer => {
      const { w, h } = layer;
      const layout = layer.layout && annotations.layout(layer.layout,
        { width: plan.w, height: plan.h, camera, world, time, glyphs: text, resolve });
      const draw = layout ? [...(layer.draw ?? []), ...layout.draw.map(command)] : layer.draw;
      const gpu = gl && typeof layer.source === 'function' && layer.source[textureSource]?.(gl);
      const result = gpu ? { w: gpu.region[2], h: gpu.region[3], gpu } :
        draw ? drawLayer(layer, plan.w, plan.h, text, camera, draw) : pixels(
          typeof layer.source === 'function' ? layer.source({ w, h, outputWidth: plan.w, outputHeight: plan.h, world, time }) : layer.source);
      if (result.w !== w || result.h !== h) throw new RangeError('Composite raster dimensions must match the layer resolution');
      return { ...result, dest: layer.dest, filter: layer.filter, blend: layer.blend, opacity: layer.opacity };
    });
  }

  function sample(layer, u, v, out) {
    const { data, w: width, h: height } = layer;
    if (layer.filter === 'linear') {
      const nx = Math.max(0, Math.min(width - 1, u - .5)), ny = Math.max(0, Math.min(height - 1, v - .5));
      const ix = Math.floor(nx), iy = Math.floor(ny), dx = nx - ix, dy = ny - iy;
      const aa = (iy * width + ix) * 4, ba = ix + 1 < width ? aa + 4 : aa;
      const ab = iy + 1 < height ? aa + width * 4 : aa, bb = ab + ba - aa;
      for (let c = 0; c < 4; c++)
        out[c] = ((1 - dx) * data[aa + c] + dx * data[ba + c]) * (1 - dy) +
          ((1 - dx) * data[ab + c] + dx * data[bb + c]) * dy;
    } else {
      const q = (Math.floor(v) * width + Math.floor(u)) * 4;
      for (let c = 0; c < 4; c++) out[c] = data[q + c];
    }
  }

  function samplePlaced(layer, x, y, out) {
    const [left, top, width, height] = layer.dest;
    const u = x - left, v = y - top;
    if (u < 0 || v < 0 || u >= width || v >= height) return false;
    sample(layer, u * layer.w / width, v * layer.h / height, out);
    return true;
  }

  function resample(layer, w, h, visit) {
    const color = new Float64Array(4);
    const [left, top, width, height] = layer.dest;
    const startX = Math.max(0, Math.ceil(left - .5)), startY = Math.max(0, Math.ceil(top - .5));
    const endX = Math.min(w, Math.ceil(left + width - .5)), endY = Math.min(h, Math.ceil(top + height - .5));
    for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
      sample(layer, (x + .5 - left) * layer.w / width, (y + .5 - top) * layer.h / height, color);
      visit((y * w + x) * 4, color);
    }
  }

  function blend(data, p, source, amount, add) {
    const remaining = 1 - source[3] * amount / 255;
    const a = Math.round(data[p + 3] * remaining + source[3] * amount);
    for (let c = 0; c < 3; c++)
      data[p + c] = Math.min(a, Math.round(data[p + c] * (add ? 1 : remaining) + source[c] * amount));
    data[p + 3] = a;
  }

  function compose(base, overlays, w, h, filter) {
    const data = new Uint8Array(w * h * 4);
    resample({ ...pixels(base), filter, dest: [0, 0, w, h] }, w, h, (p, sample) => {
      for (let c = 0; c < 4; c++) data[p + c] = Math.round(sample[c]);
    });
    for (const layer of overlays) {
      const add = layer.blend === 'add', opacity = layer.opacity;
      resample(layer.dest ? layer : { ...layer, dest: [0, 0, w, h] }, w, h,
        (p, sample) => blend(data, p, sample, opacity, add));
    }
    return straight(data, w, h, base.alpha);
  }

  function straight(data, w, h, transparent) {
    const rgb = new Uint8Array(w * h * 3), alpha = transparent && new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const a = data[p * 4 + 3];
      if (alpha) alpha[p] = a;
      if (a) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(data[p * 4 + c] * 255 / a);
    }
    return { w, h, rgb, ...(alpha && { alpha }) };
  }

  return Object.freeze({ settings, prepare, layers, compose, image, pixels, sample, samplePlaced, blend, straight, paintMap, screenDrawing, textureSource });
})();
if (typeof module !== 'undefined') module.exports = FrameComposite;
