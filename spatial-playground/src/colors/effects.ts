import type { ColorRegion } from './types.ts';
import { COLOR_LIBRARY } from './constants.ts';
import type { ColorId } from '../types.ts';

function computeContainGeometry(videoAspect: number, displayW: number, displayH: number) {
  const displayAspect = displayW / displayH;
  if (videoAspect > displayAspect) {
    const fitW = displayW;
    const fitH = displayW / videoAspect;
    return { fitW, fitH, offsetX: 0, offsetY: (displayH - fitH) * 0.5 };
  }
  const fitH = displayH;
  const fitW = displayH * videoAspect;
  return { fitW, fitH, offsetX: (displayW - fitW) * 0.5, offsetY: 0 };
}

export function createEffectsRenderer(opts: {
  canvas: HTMLCanvasElement;
  element: HTMLElement;
  getRegions: () => ColorRegion[];
  getAspectRatio: () => number;
}): {
  resize(): void;
  destroy(): void;
} {
  const { canvas, element, getRegions, getAspectRatio } = opts;
  const ctx = canvas.getContext('2d')!;
  let rafHandle = 0;
  let destroyed = false;

  function resize() {
    if (destroyed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderScene() {
    if (destroyed) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) {
      rafHandle = window.requestAnimationFrame(renderScene);
      return;
    }

    const aspect = getAspectRatio();
    const { fitW, fitH, offsetX, offsetY } = computeContainGeometry(aspect, width, height);
    const regions = getRegions();

    // Black background (letterbox bars)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // White fit rect (camera FOV area)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(offsetX, offsetY, fitW, fitH);

    // Draw filled polygons for each region
    for (const region of regions) {
      if (region.corners.length < 3) continue;

      ctx.fillStyle = COLOR_LIBRARY[region.colorId as ColorId]?.accent ?? '#888888';
      ctx.beginPath();
      const first = region.corners[0];
      ctx.moveTo(offsetX + first.x * fitW, offsetY + first.y * fitH);
      for (let i = 1; i < region.corners.length; i++) {
        const c = region.corners[i];
        ctx.lineTo(offsetX + c.x * fitW, offsetY + c.y * fitH);
      }
      ctx.closePath();
      ctx.fill();
    }

    rafHandle = window.requestAnimationFrame(renderScene);
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
