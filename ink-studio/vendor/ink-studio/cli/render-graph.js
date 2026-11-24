const FrameComposite = require('../src/frame-composite.js');
const {
  cube,
  selection,
  layer,
  history,
  feedbackMotion,
  volumeCoverage,
  rowTable,
  resources,
  ownerGroups,
  effects
} = require('../src/render-graph.js');
const wrap = (n, size) => n - Math.floor(n / size) * size;

function runGraph(plan, frame, world, time, text, camera, resolve, options) {
  const { w, h, passes } = frame;
  const layout = resources(plan, w, h),
    groups = plan.passes.some(n => n.effect) && ownerGroups(world);
  const openHistory =
    plan.historyPasses.length &&
    (options.renderHistory ?? history()).begin(plan, {
      source: options.renderHistoryKey ?? world,
      w,
      h,
      time,
      camera,
      reset: options.resetRenderHistory
    });
  if (!openHistory) options.renderHistory?.clear();
  const outputs = new Map([['scene', FrameComposite.pixels(frame).data]]);
  const selectors = new Map();
  function selected(select) {
    if (!select) return null;
    const key = JSON.stringify(select);
    if (!selectors.has(key)) selectors.set(key, selection(world, select));
    return selectors.get(key);
  }
  const owner = passes?.splatId,
    depth = passes?.depth;
  const nativeIndex =
    (owner || depth) && (passes.w !== w || passes.h !== h)
      ? (x, y) => Math.floor((y * passes.h) / h) * passes.w + Math.floor((x * passes.w) / w)
      : (_x, _y, p) => p;
  const color = new Float64Array(4),
    previousColor = new Float64Array(4),
    rgb = [0, 0, 0],
    graded = [0, 0, 0];
  for (const [index, node] of plan.passes.entries()) {
    const input = outputs.get(node.input);
    const maskPass = node.type === 'mask';
    let output;
    if (!node.enabled) output = maskPass ? new Uint8Array(w * h) : input;
    else {
      const rows = selected(node.select),
        mask = outputs.get(node.mask),
        source = outputs.get(node.source);
      const table = node.type === 'grade' && cube(node);
      const feedback = node.type === 'feedback';
      const memory = node.type === 'history' || feedback ? openHistory(node) : null;
      const work = layout.passes[index];
      const held = memory && (memory.capture ? new Uint8Array(work.width * work.height * 4) : memory.value);
      const raster =
        node.layer && (!feedback || memory.capture) && layer(node, w, h, world, time, text, camera, resolve);
      const oldSignal = feedback &&
        memory.capture &&
        memory.decay > 0 && { data: memory.value, w, h, filter: node.filter };
      const motion = oldSignal && feedbackMotion(node, time, memory.elapsed, w, h);
      output = maskPass ? new Uint8Array(w * h) : node.isolated ? new Uint8Array(w * h * 4) : input.slice();
      const { rect, feather, opacity, depthThreshold } = node;
      const at = (x, y) => nativeIndex(x, y, Math.floor(y) * w + Math.floor(x));
      const weightAt = (x, y) =>
        (rows ? Number(rows[owner?.[at(x, y)] ?? 0] !== 0) : 1) *
        (mask ? mask[Math.floor(y) * w + Math.floor(x)] / 255 : 1) *
        effects.depthWeight(node.depth, depth?.[at(x, y)]);
      if (node.effect) {
        output = effects.render(node, input, w, h, work, {
          time,
          weight: weightAt,
          depth: (x, y) => depth?.[at(x, y)] ?? Infinity,
          group: (x, y) => groups[owner?.[at(x, y)] ?? 0]
        });
      }
      const budgetedMemory = memory && node.budget;
      if (budgetedMemory) {
        const W = work.width,
          H = work.height,
          sample = (data, x, y, out, filter = 'linear') =>
            FrameComposite.sample({ data, w: W, h: H, filter }, (x * W) / w, (y * H) / h, out);
        const old = memory.value;
        const motion = feedback && old && feedbackMotion(node, time, memory.elapsed, w, h);
        if (memory.capture)
          for (let j = 0; j < H; j++)
            for (let i = 0; i < W; i++) {
              const x = ((i + 0.5) * w) / W,
                y = ((j + 0.5) * h) / H,
                q = (j * W + i) * 4,
                amount = weightAt(x, y);
              color.fill(0);
              previousColor.fill(0);
              if (feedback) {
                if (motion) {
                  const {
                    pivot,
                    blockSize,
                    transform: [c, s],
                    offset,
                    wave,
                    theta,
                    frequency
                  } = motion;
                  const u = x - pivot[0],
                    v = y - pivot[1],
                    qx = blockSize ? (Math.floor(x / blockSize) + 0.5) * blockSize : x,
                    qy = blockSize ? (Math.floor(y / blockSize) + 0.5) * blockSize : y;
                  const sx = pivot[0] + c * u + s * v - offset[0] - wave[0] * Math.sin(qy * frequency + theta),
                    sy = pivot[1] - s * u + c * v - offset[1] - wave[1] * Math.sin(qx * frequency + theta);
                  if (sx >= 0 && sy >= 0 && sx < w && sy < h) sample(old, sx, sy, previousColor, node.filter);
                }
                let gain = amount * node.gain;
                if (node.layer) {
                  if (raster) FrameComposite.samplePlaced(raster, x, y, color);
                  gain *= raster?.opacity ?? 0;
                } else FrameComposite.sample({ data: source, w, h, filter: 'nearest' }, x, y, color);
                if (node.threshold && color[3] > 0)
                  gain *= Math.min(
                    1,
                    Math.max(
                      0,
                      (Math.max(...color.subarray(0, 3)) / color[3] - node.threshold[0]) /
                        (node.threshold[1] - node.threshold[0])
                    )
                  );
                const remain = memory.decay * (1 - (color[3] * gain) / 255);
                for (let c = 0; c < 4; c++)
                  held[q + c] = Math.min(
                    255,
                    Math.round(color[c] * gain + Math.floor(previousColor[c] * remain + 1e-5))
                  );
              } else {
                FrameComposite.sample({ data: input, w, h, filter: 'nearest' }, x, y, color);
                const has = old?.[q + 3] > 0,
                  keep = node.mode === 'hold' && has,
                  decay = node.mode === 'persistence' && has ? memory.decay : 0,
                  remain = decay * (1 - (color[3] * amount) / 255);
                for (let c = 0; c < 4; c++)
                  held[q + c] = keep
                    ? old[q + c]
                    : Math.min(255, Math.round(color[c] * amount + Math.floor((old?.[q + c] ?? 0) * remain + 1e-5)));
              }
            }
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const q = (y * w + x) * 4,
              chosen = rows ? Number(rows[owner?.[at(x + 0.5, y + 0.5)] ?? 0] !== 0) : 1;
            const gate = feedback ? (node.displayMask ? weightAt(x + 0.5, y + 0.5) : 1) : chosen;
            if (!gate) continue;
            sample(held, x + 0.5, y + 0.5, color, node.budget.filter);
            FrameComposite.blend(output, q, color, opacity * gate, feedback && node.blend === 'add');
          }
      }

      const line = node.line ?? (node.axis === 'x' ? w : h) * 0.5;
      const isReflection = node.type === 'reflection';
      const scanlines = rowTable(node.rows, w, h, time);
      const theta = node.type === 'distortion' ? 2 * Math.PI * ((node.phase + time * node.rate) % 1) : 0;
      const frequency = (2 * Math.PI) / node.period;
      if (!node.effect && !budgetedMemory)
        for (let y = 0.5, p = 0; y < h; y++)
          for (let x = 0.5; x < w; x++, p++) {
            const native = nativeIndex(x, y, p);
            const chosen = rows ? rows[owner?.[native] ?? 0] !== 0 : true;
            let weight = (chosen ? (mask ? mask[p] / 255 : 1) : 0) * effects.depthWeight(node.depth, depth?.[native]);
            const q = p * 4;
            if (maskPass) {
              if (node.volume && weight) {
                const z = depth?.[native];
                const u = ((native % passes.w) + 0.5) / passes.w,
                  v = (Math.floor(native / passes.w) + 0.5) / passes.h;
                weight *= volumeCoverage(node.volume, camera, u, v, z);
              }
              if (rect) {
                const edge = Math.min(x - rect[0], y - rect[1], rect[0] + rect[2] - x, rect[1] + rect[3] - y);
                weight *= feather ? Math.max(0, Math.min(1, edge / feather)) : Number(edge >= 0);
              }
              output[p] = Math.round((node.invert ? 1 - weight : weight) * opacity * 255);
              continue;
            }
            if (feedback) {
              if (memory.capture) {
                previousColor.fill(0);
                if (motion) {
                  const {
                    pivot,
                    blockSize,
                    transform: [cos, sin],
                    offset,
                    wave,
                    theta,
                    frequency
                  } = motion;
                  const u = x - pivot[0],
                    v = y - pivot[1];
                  const qx = blockSize ? (Math.floor(x / blockSize) + 0.5) * blockSize : x;
                  const qy = blockSize ? (Math.floor(y / blockSize) + 0.5) * blockSize : y;
                  const sx = pivot[0] + cos * u + sin * v - offset[0] - wave[0] * Math.sin(qy * frequency + theta);
                  const sy = pivot[1] - sin * u + cos * v - offset[1] - wave[1] * Math.sin(qx * frequency + theta);
                  if (sx >= 0 && sy >= 0 && sx < w && sy < h) FrameComposite.sample(oldSignal, sx, sy, previousColor);
                }
                color.fill(0);
                let amount = weight * node.gain;
                if (amount > 0) {
                  if (node.layer) {
                    if (raster) FrameComposite.samplePlaced(raster, x, y, color);
                    amount *= raster?.opacity ?? 0;
                  } else for (let c = 0; c < 4; c++) color[c] = source[q + c];
                  if (node.threshold && color[3] > 0) {
                    const [lo, hi] = node.threshold;
                    const intensity = Math.max(color[0], color[1], color[2]) / color[3];
                    amount *= Math.min(1, Math.max(0, (intensity - lo) / (hi - lo)));
                  }
                }
                const remain = memory.decay * (1 - (color[3] * amount) / 255);
                for (let c = 0; c < 4; c++)
                  held[q + c] = Math.min(
                    255,
                    Math.round(color[c] * amount + Math.floor(previousColor[c] * remain + 1e-5))
                  );
              }
              if (held[q + 3] && opacity) {
                for (let c = 0; c < 4; c++) color[c] = held[q + c];
                FrameComposite.blend(output, q, color, opacity * (node.displayMask ? weight : 1), node.blend === 'add');
              }
              continue;
            }
            if (memory) {
              if (memory.capture) {
                const previous = memory.value,
                  hasSample = previous?.[q + 3] > 0;
                const keep = node.mode === 'hold' && hasSample;
                const old = node.mode === 'persistence' && hasSample ? memory.decay : 0;
                const remain = old * (1 - (input[q + 3] * weight) / 255);
                for (let c = 0; c < 4; c++)
                  held[q + c] = keep
                    ? previous[q + c]
                    : Math.min(
                        255,
                        Math.round(input[q + c] * weight + Math.floor((previous?.[q + c] ?? 0) * remain + 1e-5))
                      );
              }
              if (chosen && held[q + 3]) {
                for (let c = 0; c < 4; c++) color[c] = held[q + c];
                FrameComposite.blend(output, q, color, opacity, false);
              }
              continue;
            }
            weight *= opacity;
            if (!weight) continue;
            if (table) {
              const alpha = input[q + 3];
              if (!alpha) continue;
              for (let c = 0; c < 3; c++) rgb[c] = input[q + c] / alpha;
              table.sample(rgb, graded);
              for (let c = 0; c < 3; c++)
                output[q + c] = Math.round(input[q + c] * (1 - weight) + graded[c] * alpha * weight);
            } else if (node.type === 'composite') {
              if (node.layer && !raster) continue;
              if (raster) {
                if (!FrameComposite.samplePlaced(raster, x, y, color)) continue;
              } else for (let c = 0; c < 4; c++) color[c] = source[q + c];
              FrameComposite.blend(
                output,
                q,
                color,
                weight * (raster?.opacity ?? 1),
                (raster?.blend ?? node.blend) === 'add'
              );
            } else {
              let X = x,
                Y = y,
                row = 0;
              if (isReflection) {
                if (node.axis === 'x') X = line * 2 - x;
                else Y = line * 2 - y;
              } else {
                if (scanlines) {
                  row = Math.floor(y) * 8;
                  X = (x - w * 0.5) * scanlines[row + 2] + w * 0.5 + scanlines[row];
                  Y = (y - h * 0.5) * scanlines[row + 3] + h * 0.5 + scanlines[row + 1];
                }
                X += node.offset[0] + node.amplitude[0] * Math.sin(y * frequency + theta);
                Y += node.offset[1] + node.amplitude[1] * Math.sin(x * frequency + theta);
                if (node.wrap) {
                  X = wrap(X, w);
                  Y = wrap(Y, h);
                }
              }
              if (!(X >= 0 && Y >= 0 && X < w && Y < h)) continue;
              const sx = Math.floor(X),
                sy = Math.floor(Y),
                sample = sy * w + sx;
              if (depthThreshold !== undefined) {
                if (!depth) continue;
                const a = depth[native],
                  b = depth[nativeIndex(sx + 0.5, sy + 0.5, sample)];
                if (a !== b && (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > depthThreshold))
                  continue;
              }
              const at = sample * 4,
                alpha = source[at + 3];
              color[3] = alpha;
              for (let c = 0; c < 3; c++)
                color[c] = scanlines
                  ? Math.max(0, Math.min(alpha, source[at + c] + (scanlines[row + 4 + c] * alpha) / 255))
                  : source[at + c];
              if (node.blend === 'over') FrameComposite.blend(output, q, color, weight, false);
              else
                for (let c = 0; c < 4; c++) output[q + c] = Math.round(input[q + c] * (1 - weight) + color[c] * weight);
            }
          }
      if (memory?.capture) memory.save(held);
    }
    outputs.set(node.id, output);
    for (const dependency of node.dependencies) if (plan.lastUse.get(dependency) === index) outputs.delete(dependency);
  }
  return FrameComposite.straight(outputs.get(plan.output), w, h, frame.alpha);
}
module.exports = runGraph;
