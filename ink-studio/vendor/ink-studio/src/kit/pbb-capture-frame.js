/* Plan a fixed raster around a view's centred crop, then expand its art pixels. */
(function (K) {
  const aspects = { square: 1, wide: 16 / 9, portrait: 3 / 4 };
  const maxPixels = 16777216;
  const side = (n, limit) => Number.isSafeInteger(n) && n > 0 && n <= limit;

  function fixed(width, height, { aspect = 'view', edge = 1920, scale = 2 } = {}) {
    if (!side(width, 16384) || !side(height, 16384))
      throw new Error('Capture source dimensions must be integers in 1..16384');
    const ratio = aspect === 'view' ? width / height : typeof aspect === 'number' ? aspect :
      Object.hasOwn(aspects, aspect) ? aspects[aspect] : NaN;
    if (!Number.isFinite(ratio) || (aspect !== 'view' && (ratio < .25 || ratio > 4)))
      throw new Error('Capture aspect must be view, square, wide, portrait or a ratio in .25..4');
    if (!side(edge, 8192) || !side(scale, 8))
      throw new Error('Capture edge and pixel scale must be positive integers within their limits');
    const cropWidth = Math.min(width, height * ratio), cropHeight = Math.min(height, width / ratio);
    const outputWidth = ratio >= 1 ? edge : Math.max(1, Math.round(edge * ratio)),
      outputHeight = ratio <= 1 ? edge : Math.max(1, Math.round(edge / ratio));
    if (outputWidth * outputHeight > maxPixels)
      throw new Error('Capture exceeds the 16-megapixel budget');
    const renderWidth = Math.ceil(outputWidth / scale), renderHeight = Math.ceil(outputHeight / scale);
    return Object.freeze({
      x: (width - cropWidth) / 2, y: (height - cropHeight) / 2,
      width: cropWidth, height: cropHeight, outputWidth, outputHeight, renderWidth, renderHeight, scale,
      lensScale: height / cropHeight * outputHeight / (renderHeight * scale)
    });
  }

  function pixels(data, frame, { channels = 4, flipY = false } = {}) {
    const { renderWidth, renderHeight, outputWidth, outputHeight, scale } = frame || {};
    if (!side(outputWidth, 8192) || !side(outputHeight, 8192) ||
        outputWidth * outputHeight > maxPixels || !side(scale, 8) || !side(channels, 4) ||
        renderWidth !== Math.ceil(outputWidth / scale) || renderHeight !== Math.ceil(outputHeight / scale) ||
        !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
        data.length !== renderWidth * renderHeight * channels || typeof flipY !== 'boolean')
      throw new Error('Capture pixels need a matching byte raster and frame');
    const expandedWidth = renderWidth * scale, expandedHeight = renderHeight * scale,
      left = Math.floor((expandedWidth - outputWidth) / 2), top = Math.floor((expandedHeight - outputHeight) / 2),
      stride = outputWidth * channels, result = new Uint8ClampedArray(stride * outputHeight);
    const column = Uint32Array.from({ length: outputWidth }, (_, x) => Math.floor((x + left) / scale) * channels);
    let previous = -1;
    for (let y = 0; y < outputHeight; y++) {
      const sy = Math.floor((y + top) / scale), target = y * stride;
      if (sy === previous) {
        result.copyWithin(target, target - stride, target);
        continue;
      }
      previous = sy;
      const source = (flipY ? renderHeight - 1 - sy : sy) * renderWidth * channels;
      for (let x = 0; x < outputWidth; x++)
        for (let channel = 0; channel < channels; channel++)
          result[target + x * channels + channel] = data[source + column[x] + channel];
    }
    return result;
  }

  K.captureFrame = Object.freeze({ fixed, pixels });
})(KIT);
