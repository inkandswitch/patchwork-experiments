const { resize } = require('./render.js');

const suffixes = ['-join.png', '-join.json'];

function capture({ w, h, rgb, alpha }) {
  return { w, h, rgb: Uint8Array.from(rgb), ...(alpha && { alpha: Uint8Array.from(alpha) }) };
}

function measure(a, b, heatmap = true) {
  const { w, h } = a, pixels = w * h;
  if (b.w !== w || b.h !== h || a.rgb.length !== pixels * 3 || b.rgb.length !== a.rgb.length ||
    [a.alpha, b.alpha].some(alpha => alpha && alpha.length !== pixels))
    throw new TypeError('Loop join frames must have matching dimensions');
  const rgb = heatmap ? new Uint8Array(pixels * 3) : null;
  let changedPixels = 0, total = 0, maxChannelDelta = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 3) {
    const alpha = Math.abs((a.alpha?.[p] ?? 255) - (b.alpha?.[p] ?? 255));
    const r = Math.abs(a.rgb[i] - b.rgb[i]), g = Math.abs(a.rgb[i + 1] - b.rgb[i + 1]), blue = Math.abs(a.rgb[i + 2] - b.rgb[i + 2]);
    const peak = Math.max(r, g, blue, alpha);
    if (peak) changedPixels++;
    total += r + g + blue + alpha;
    maxChannelDelta = Math.max(maxChannelDelta, peak);
    if (rgb) {
      rgb[i] = peak ? 36 + Math.min(219, peak * 4) : 11;
      rgb[i + 1] = 17 + Math.min(184, peak * 2);
      rgb[i + 2] = 27 + Math.min(89, peak);
    }
  }
  return { image: rgb && { w, h, rgb }, metrics: { exact: changedPixels === 0, pixels, changedPixels, maxChannelDelta,
    meanAbsoluteChannelDelta: total / (pixels * 4) } };
}

function contactSheet(frames, headings, fps) {
  const scale = Math.min(1, 400 / frames[0].w, 300 / frames[0].h);
  const w = Math.max(1, Math.round(frames[0].w * scale)), h = Math.max(1, Math.round(frames[0].h * scale));
  const panel = Math.max(224, w), margin = 16, gap = 12, top = 54, labelHeight = 20;
  const width = 2 * margin + 3 * panel + 2 * gap, height = top + 2 * (h + labelHeight) + gap + margin;
  const rgb = new Uint8Array(width * height * 3), font = require('../index.js').load().KIT.inspection.font({});
  const ink = [218, 233, 241], quiet = [142, 179, 191], background = [13, 21, 34];
  for (let i = 0; i < rgb.length; i += 3) rgb.set(background, i);
  function label(text, x, y, maxWidth, size, color) {
    for (let i = 0; i < Math.min(text.length, Math.floor(maxWidth / (6 * size))); i++) {
      const glyph = font.get(text[i]);
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 6; dx++) {
        if (!glyph?.[dy * 6 + dx]) continue;
        const px = x + (i * 6 + dx) * size, py = y + dy * size;
        for (let sy = 0; sy < size; sy++) for (let sx = 0; sx < size; sx++)
          rgb.set(color, ((py + sy) * width + px + sx) * 3);
      }
    }
  }
  label('LOOP JOIN', margin, 15, width - 2 * margin, 2, ink);
  label('LAST TO FIRST AT ' + fps + ' FPS', margin, 36, width - 2 * margin, 1, quiet);
  for (const [i, frame] of frames.entries()) {
    const x = margin + (panel + gap) * (i % 3), y = top + (h + labelHeight + gap) * Math.floor(i / 3);
    label(headings[i], x, y + 4, panel, 1, ink);
    const image = resize(frame, w, h), inset = Math.floor((panel - w) / 2);
    for (let row = 0; row < h; row++) {
      const start = ((y + labelHeight + row) * width + x + inset) * 3;
      for (let col = 0; col < w; col++) {
        const p = row * w + col, alpha = (image.alpha?.[p] ?? 255) / 255;
        const matte = ((col >> 3) + (row >> 3)) % 2 ? 48 : 31;
        for (let k = 0; k < 3; k++) rgb[start + col * 3 + k] = Math.round(alpha * image.rgb[p * 3 + k] + (1 - alpha) * matte);
      }
    }
  }
  return { w: width, h: height, rgb };
}

function inspect({ first, penultimate, last, endpoint, from, fps, count }) {
  const tail = measure(last, first), closure = measure(endpoint, first);
  const previous = penultimate ? measure(penultimate, last, false).metrics : null;
  const sample = index => ({ index, time: from + index / fps });
  const end = { time: from + count / fps, included: false };
  const report = { format: 'ink-studio/loop-join', version: 1, fps, frameCount: count, duration: count / fps,
    resolution: [first.w, first.h], join: { from: sample(count - 1), to: sample(0), ...tail.metrics },
    preceding: previous && { from: sample(count - 2), to: sample(count - 1), ...previous },
    closure: { endpoint: end, start: sample(0), ...closure.metrics } };
  const stamp = row => row.time.toFixed(3) + 'S';
  const diff = stats => stats.exact ? 'PIXEL MATCH' : stats.changedPixels + ' PX CHANGED';
  const image = contactSheet([last, first, tail.image, penultimate ?? last, endpoint, closure.image], [
    'LAST ' + (count - 1) + '   ' + stamp(report.join.from), 'FIRST 0   ' + stamp(report.join.to),
    'JOIN DELTA   ' + diff(tail.metrics),
    previous ? 'PREVIOUS ' + (count - 2) + '   ' + stamp(report.preceding.from) : 'ONLY INCLUDED FRAME',
    'EXCLUDED END   ' + stamp(end), 'END DELTA   ' + diff(closure.metrics)
  ], fps);
  return { report, image };
}

module.exports = { capture, inspect, suffixes };
