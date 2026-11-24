/* Independent screen signals fed back through affine and block-quantized warps. */
module.exports = ({ makeBuilder }) => ({
  id: 'render-feedback',
  name: 'Phosphor Relay',
  seed: 31,
  build(seed) {
    const B = makeBuilder(seed, [0x080c19]);
    const width = 408, height = 216;
    const left = [15, 34, 224, 158], right = [249, 34, 144, 158];
    const amber = [255, 106, 72], peach = [255, 197, 105], ice = [71, 230, 239], blue = [107, 120, 255];
    const TAU = Math.PI * 2;
    const layer = draw => ({ resolution: [width, height], source({ w, h, time }) {
      const rgba = new Uint8Array(w * h * 4);
      function point(x, y, rgb, alpha) {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || x >= w || y < 0 || y >= h) return;
        const i = (y * w + x) * 4, a = Math.round(alpha * 255);
        if (a < rgba[i + 3]) return;
        rgba[i] = rgb[0];
        rgba[i + 1] = rgb[1];
        rgba[i + 2] = rgb[2];
        rgba[i + 3] = a;
      }
      const intensity = Math.max(0, Math.min(1, (time - .19) * 6, (5.15 - time) * 2.6));
      if (intensity > 0) draw(point, time, intensity);
      return { w, h, rgba };
    } });

    const curl = layer((p, time, intensity) => {
      const t = 1.29 * (time - .19);
      for (let arm = 0; arm < 2; arm++) {
        const t0 = t + arm * Math.PI, head = arm ? ice : peach, tail = arm ? blue : amber;
        function path(a) {
          const sway = Math.sin(1.51 * a + .45) * 24;
          return [126 + 54 * Math.cos(a) + 11 * Math.cos(a * 2.1), 112 + Math.sin(a) * 31 + sway];
        }
        const [x, y] = path(t0);
        for (let j = 0; j <= 25; j++) {
          const u = j / 25, [a,b] = path(t0 - .25 * u);
          p(a, b, tail, (.92 - u * .67) * intensity);
          p(a, b + (arm ? 1 : -1), tail, (.62 - u * .39) * intensity);
          if (j % 3 === 0) p(a - 1, b + 2, head, (.36 - u * .27) * intensity);
        }
        for (let i = 0; i < 12; i++) {
          const a = i * TAU / 12, size = 3 + .5 * Math.sin(t * 4 + a * 5);
          p(x + Math.cos(a) * size, y + Math.sin(a) * size, head, intensity * .87);
        }
        p(x, y, [255, 245, 209], intensity);
        p(x + 1, y, head, intensity * .78);
        p(x, y - 1, head, intensity * .74);
      }
    });

    const blocks = layer((p, time, intensity) => {
      const t = time * 1.5;
      const x = 324 + Math.sin(t) * 29, y = 108 + Math.sin(t * 1.72 + .9) * 44;
      const stride = Math.floor(time * 12), shift = stride & 3;
      for (let row = -6; row <= 6; row++) {
        const jitter = (Math.imul(row + 19, 1103515245) >>> (14 + shift)) % 13;
        const left = x - 16 + jitter + shift * 2, run = row % 3 === 0 ? 20 : 11;
        const ink = row < -1 ? blue : row < 3 ? ice : peach;
        for (let col = 0; col < run; col++) {
          p(left + col, y + row * 2, ink, intensity * (col % 9 ? .85 : .49));
          if (row % 3 === 0) p(left + col, y + row * 2 + 1, ink, intensity * .56);
        }
      }
      for (let j = 0; j < 6; j++) {
        const a = j * TAU / 6 + t;
        p(x + Math.cos(a) * 29, y + Math.sin(a) * 13, j % 2 ? ice : peach, intensity * .65);
      }
    });

    function grid([x, y, w, h], pitch) {
      const draw = [{ type: 'rect', rect: [x - 1, y - 1, w + 2, h + 2], color: '#23394f' },
        { type: 'rect', rect: [x, y, w, h], color: '#0a1120' }];
      for (let u = x + pitch; u < x + w; u += pitch)
        draw.push({ type: 'rect', rect: [u, y, 1, h], color: '#121e2e' });
      for (let v = y + pitch; v < y + h; v += pitch)
        draw.push({ type: 'rect', rect: [x, v, w, 1], color: '#121e2e' });
      return draw;
    }

    const display = { draw: [
      ...grid(left, 14), ...grid(right, 12),
      { type: 'text', text: 'PHOSPHOR RELAY', at: [72, 18], size: 9, width: .9, color: '#dce7f0' },
      { type: 'text', text: 'ROTATING FLOW', at: [69, 204], size: 7, width: .8, color: '#b4c6d2' },
      { type: 'text', text: 'BLOCK DISPLACEMENT', at: [320, 204], size: 7, width: .8, color: '#b4c6d2' },
      { type: 'rect', rect: [16, 200, 5, 7], color: '#fb9f75' },
      { type: 'rect', rect: [250, 200, 5, 7], color: '#4ee3e1' }
    ] };
    const passes = [
      { id: 'left', type: 'mask', rect: left },
      { id: 'right', type: 'mask', rect: right },
      { id: 'curl', type: 'feedback', input: 'scene', layer: curl, halfLife: .74, cameraMotion: 'keep',
        warp: { center: [127 / width, 111 / height], rotation: .8, zoom: 1.29, velocity: [3, -9],
          wave: [21, 18], period: 83, rate: .32 } },
      { id: 'show-curl', type: 'composite', input: 'scene', source: 'curl', mask: 'left' },
      { id: 'echo', type: 'feedback', input: 'show-curl', layer: blocks, halfLife: .56, cameraMotion: 'keep',
        filter: 'nearest', warp: { center: [323 / width, 112 / height], velocity: [36, -23], zoom: 1.08,
          wave: [58, 49], period: 74, rate: -.63, blockSize: 13 } },
      { id: 'show-echo', type: 'composite', input: 'show-curl', source: 'echo', mask: 'right' }
    ];
    return B.finish({ cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 }, look: { pixelSize: 1, composite: { layers: [display] }, renderGraph: { passes } } });
  }
});
