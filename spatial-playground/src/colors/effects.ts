import type { ActiveComposition, ColorPosition, Hsl } from './types.ts';
import { COLOR_LIBRARY } from './constants.ts';
import { mixHsl, hslToHex } from './composition.ts';

const IDW_RESOLUTION = 64;
const TOUCHING_THRESHOLD = 0.08;

export function createEffectsRenderer(opts: {
  canvas: HTMLCanvasElement;
  element: HTMLElement;
  getComposition: () => ActiveComposition;
}): {
  resize(): void;
  destroy(): void;
} {
  const { canvas, element, getComposition } = opts;
  const ctx = canvas.getContext('2d')!;
  let rafHandle = 0;
  let destroyed = false;

  const offscreen = document.createElement('canvas');
  offscreen.width = IDW_RESOLUTION;
  offscreen.height = IDW_RESOLUTION;
  const offCtx = offscreen.getContext('2d')!;

  function resize() {
    if (destroyed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderScene() {
    if (destroyed) return;
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const composition = getComposition();
    const positions = composition.colorPositions;

    ctx.clearRect(0, 0, width, height);

    if (positions.length === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    } else if (positions.length === 1) {
      const hsl = COLOR_LIBRARY[positions[0].colorId].hsl;
      ctx.fillStyle = hslToHex(hsl.h, hsl.s, hsl.l);
      ctx.fillRect(0, 0, width, height);
    } else if (areTouching(positions)) {
      const hslValues = positions.map((cp) => COLOR_LIBRARY[cp.colorId].hsl);
      const mix = mixHsl(hslValues);
      ctx.fillStyle = hslToHex(mix.h, mix.s, mix.l);
      ctx.fillRect(0, 0, width, height);
    } else {
      renderIdwGradient(positions);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(offscreen, 0, 0, width, height);
    }

    rafHandle = window.requestAnimationFrame(renderScene);
  }

  function areTouching(positions: ColorPosition[]): boolean {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        if (Math.hypot(dx, dy) > TOUCHING_THRESHOLD) {
          return false;
        }
      }
    }
    return true;
  }

  function renderIdwGradient(positions: ColorPosition[]) {
    const res = IDW_RESOLUTION;
    const imageData = offCtx.createImageData(res, res);
    const data = imageData.data;

    const cardHsls = positions.map((cp) => COLOR_LIBRARY[cp.colorId].hsl);
    const cardCosH = cardHsls.map((hsl) => Math.cos((hsl.h * Math.PI) / 180));
    const cardSinH = cardHsls.map((hsl) => Math.sin((hsl.h * Math.PI) / 180));

    for (let py = 0; py < res; py++) {
      const ny = (py + 0.5) / res;
      for (let px = 0; px < res; px++) {
        const nx = (px + 0.5) / res;

        let totalWeight = 0;
        const weights: number[] = [];
        for (let i = 0; i < positions.length; i++) {
          const dx = nx - positions[i].x;
          const dy = ny - positions[i].y;
          const dist = Math.hypot(dx, dy);
          const w = 1 / Math.max(dist * dist, 0.0001);
          weights.push(w);
          totalWeight += w;
        }

        let cosH = 0;
        let sinH = 0;
        let s = 0;
        let l = 0;
        for (let i = 0; i < positions.length; i++) {
          const nw = weights[i] / totalWeight;
          cosH += cardCosH[i] * nw;
          sinH += cardSinH[i] * nw;
          s += cardHsls[i].s * nw;
          l += cardHsls[i].l * nw;
        }

        const h = ((Math.atan2(sinH, cosH) * 180) / Math.PI + 360) % 360;
        const [r, g, b] = hslToRgb(h, s, l);

        const idx = (py * res + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);
  }

  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const sNorm = s / 100;
    const lNorm = l / 100;
    const chroma = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
    const segment = ((h % 360) + 360) % 360 / 60;
    const second = chroma * (1 - Math.abs((segment % 2) - 1));
    const match = lNorm - chroma / 2;

    let r = 0;
    let g = 0;
    let b = 0;

    if (segment < 1) { r = chroma; g = second; }
    else if (segment < 2) { r = second; g = chroma; }
    else if (segment < 3) { g = chroma; b = second; }
    else if (segment < 4) { g = second; b = chroma; }
    else if (segment < 5) { r = second; b = chroma; }
    else { r = chroma; b = second; }

    return [
      Math.round((r + match) * 255),
      Math.round((g + match) * 255),
      Math.round((b + match) * 255),
    ];
  }

  resize();
  rafHandle = window.requestAnimationFrame(renderScene);

  return {
    resize,
    destroy() {
      destroyed = true;
      if (rafHandle) {
        window.cancelAnimationFrame(rafHandle);
        rafHandle = 0;
      }
    },
  };
}
