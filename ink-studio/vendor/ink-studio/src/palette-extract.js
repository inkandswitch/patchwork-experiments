/* Count a reference raster's colors and reduce large palettes deterministically. */
const PaletteExtract = (() => {
  const pixels = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const shifts = [16, 8, 0];
  const channel = (color, i) => (color >> shifts[i]) & 255;
  const pack = (r,g,b) => (r << 16) | (g << 8) | b;
  const hex = color => '#' + color.toString(16).padStart(6, '0');

  function alphaStats(mode, total) {
    let transparent = 0, partial = 0, included = 0;
    return {
      add(alpha, max, count = 1) {
        if (alpha === 0) transparent += count;
        else if (alpha < max) partial += count;
        const keep = mode === 'all' || (mode === 'visible' ? alpha > 0 : alpha === max);
        if (keep) included += count;
        return keep;
      },
      report() { return { mode, transparent, partial, opaque: total-transparent-partial, included, excluded: total-included }; }
    };
  }

  function histogram() {
    let sparse = new Map(), dense, size = 0;
    return {
      add(color, occurrences = 1) {
        if (dense) {
          if (dense[color] === 0) size++;
          dense[color] += occurrences;
          return;
        }
        const count = sparse.get(color) ?? 0;
        sparse.set(color,count+occurrences);
        if (!count) size++;
        // Keep small palettes cheap and avoid an unbounded object per color in photographs.
        if (size === 65536 && !count) {
          dense = new Uint32Array(2 ** 24);
          for (const [key, count] of sparse) dense[key] = count;
          sparse = null;
        }
      },
      finish() {
        const counts = dense ? color => dense[color] : color => sparse.get(color);
        if (!dense) return { colors: Uint32Array.from(sparse.keys()), counts };
        const colors = new Uint32Array(size);
        let at = 0;
        for (let color=0; color<dense.length; color++) if (dense[color]) colors[at++] = color;
        return { colors, counts };
      }
    };
  }

  function summarize(colors, counts, start, end) {
    const sum = [0,0,0], squared = [0,0,0];
    let mass = 0;
    for (let i=start; i<end; i++) {
      const color = colors[i], count = counts(color);
      mass += count;
      for (let k=0; k<3; k++) {
        const value = channel(color,k);
        sum[k] += value*count;
        squared[k] += value*value*count;
      }
    }
    const errors = squared.map((value,k) => pixels.rgbWeights[k]*(value-sum[k]*sum[k]/mass));
    const score = Math.max(...errors);
    return { start, end, pixels: mass, color: pack(...sum.map(value=>Math.round(value/mass))),
      axis: errors.indexOf(score), score };
  }

  function split(colors, counts, box) {
    const { start, end, axis, pixels } = box, bands = new Uint32Array(256);
    for (let i=start; i<end; i++) bands[channel(colors[i],axis)] += counts(colors[i]);
    // Cut between channel values so one source color always stays in one group.
    let mass = 0, best = Infinity, cut = 0;
    for (let i=0; i<255; i++) {
      if (!bands[i]) continue;
      mass += bands[i];
      if (mass >= pixels) break;
      const distance = Math.abs(pixels-2*mass);
      if (distance < best) { best = distance; cut = i; }
    }
    let boundary = start;
    for (let i=start; i<end; i++) if (channel(colors[i],axis) <= cut) {
      const color = colors[boundary];
      colors[boundary++] = colors[i];
      colors[i] = color;
    }
    return [summarize(colors,counts,start,boundary), summarize(colors,counts,boundary,end)];
  }

  function reduce(colors, counts, size) {
    const groups = [summarize(colors,counts,0,colors.length)];
    while (groups.length < size) {
      let next = -1, score = -Infinity;
      for (let i=0; i<groups.length; i++) {
        const group = groups[i];
        if (group.end-group.start > 1 && group.score > score) {
          next = i;
          score = group.score;
        }
      }
      const [a,b] = split(colors,counts,groups[next]);
      groups[next] = a;
      groups.push(b);
    }
    return groups;
  }

  function rasterColors(image, alpha) {
    if (!['visible','opaque','all'].includes(alpha))
      throw new RangeError('Reference alpha mode must be visible, opaque or all');
    const { w: width = image?.width, h: height = image?.height, bitDepth, indexed, rgb } = image ?? {};
    const data = image?.data ?? image?.rgba ?? rgb, separateAlpha = data === rgb ? image?.alpha : undefined;
    const total = width*height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || total > 2 ** 24)
      throw new RangeError('Reference raster needs positive dimensions and up to 16,777,216 pixels');
    const transparency = alphaStats(alpha,total), dimensions = { width, height, ...(bitDepth !== undefined && { bitDepth }) };
    if (indexed) {
      const {table, counts, transparency: opacity} = indexed;
      if (!(table instanceof Uint8Array) || !(counts instanceof Uint32Array) ||
          counts.length < 1 || counts.length > 256 || table.length !== counts.length*3 ||
          (opacity !== undefined && (!(opacity instanceof Uint8Array) || opacity.length > counts.length)) ||
          counts.reduce((sum,count)=>sum+count,0) !== total)
        throw new TypeError('Indexed reference needs RGB bytes, optional alpha bytes and a count per source slot');
      const swatches = Array.from(counts,(pixels,index)=>{
        const a = opacity?.[index] ?? 255, offset = index*3;
        const included = transparency.add(a,255,pixels);
        return { index, color:hex(pack(table[offset],table[offset+1],table[offset+2])),
          alpha:a, pixels, includedPixels:included ? pixels : 0 };
      });
      return {dimensions, alpha:transparency.report(), swatches};
    }

    const depth = data instanceof Uint16Array ? 65535 :
      data instanceof Uint8Array || data instanceof Uint8ClampedArray ? 255 : 0;
    const max = image.max ?? depth, stride = data?.length / total;
    if (!depth || !Number.isInteger(max) || max < 1 || max > depth || (stride !== 3 && stride !== 4))
      throw new TypeError('Reference raster needs RGB or RGBA integer samples and a valid sample maximum');
    if (separateAlpha !== undefined &&
        (!(separateAlpha instanceof Uint8Array || separateAlpha instanceof Uint8ClampedArray ||
          separateAlpha instanceof Uint16Array) || separateAlpha.length !== total || stride !== 3))
      throw new TypeError('Reference alpha needs one integer sample per RGB pixel');
    const hist = histogram(), byte = max === 255 ? n => n : n => Math.round(n * 255 / max);
    for (let i=0; i<data.length; i+=stride) {
      const r = data[i], g = data[i+1], b = data[i+2],
        a = stride === 4 ? data[i+3] : separateAlpha?.[i/3] ?? max;
      if (r > max || g > max || b > max || a > max) throw new RangeError('Reference sample exceeds its maximum');
      if (transparency.add(a,max)) hist.add(pack(byte(r),byte(g),byte(b)));
    }
    return {dimensions, alpha:transparency.report(), ...hist.finish()};
  }

  function colorHistogram(image, { alpha='visible' } = {}) {
    const source = rasterColors(image,alpha);
    if (!source.swatches) return source;
    const hist = histogram();
    for (const {color,includedPixels} of source.swatches) if (includedPixels)
      hist.add(parseInt(color.slice(1),16),includedPixels);
    return {dimensions:source.dimensions,alpha:source.alpha,...hist.finish()};
  }

  function extract(image, { size = 32, alpha = 'visible' } = {}) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 256)
      throw new RangeError('Reference palette size must be an integer from 1 to 256');
    const input = rasterColors(image,alpha);
    function report(source, requestedSize, sourceSwatches, method, swatches) {
      return { ...input.dimensions, source, alpha:input.alpha, requestedSize, sourceSwatches,
        reduced: method === 'weighted-median-cut', method, palette: swatches.map(row=>row.color), swatches };
    }
    if (input.swatches) return report('indexed',null,input.swatches.length,'indexed',input.swatches);
    const { colors, counts } = input, reduced = colors.length > size;
    const rows = reduced ? reduce(colors,counts,size) : Array.from(colors,color=>({ color, pixels:counts(color) }));
    rows.sort((a,b)=>b.pixels-a.pixels || a.color-b.color);
    return report('rgb',size,colors.length,reduced ? 'weighted-median-cut' : 'exact',
      rows.map(({color,pixels},index)=>({ index, color:hex(color), pixels })));
  }

  return Object.freeze({ extract, colorHistogram });
})();
if (typeof module !== 'undefined') module.exports = PaletteExtract;
