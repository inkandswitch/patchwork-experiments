
import { from, render, html } from '../solid.js';
import eraserSchema from './schema.js';



export default function mount(element) {
  const ref = element.getOrCreate(eraserSchema);
  const data = from(ref);

  const canvasEl = document.createElement('canvas');
  canvasEl.style.position = 'absolute';
  canvasEl.style.pointerEvents = 'none';

  let animFrame = null;
  let alive = true;
  let opacity = 1;
  let fadeStart = null;
  const FADE_DELAY = 500;   // ms before fade starts
  const FADE_DURATION = 2000; // ms to fully fade

  function animate() {
    if (!alive) return;
    const d = data();
    if (!d) { animFrame = requestAnimationFrame(animate); return; }

    const points = d.points ?? [];
    if (points.length < 2) { animFrame = requestAnimationFrame(animate); return; }

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const scale = d.strokeScale ?? 1;
    const pad = 20 * scale;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const w = Math.ceil(maxX - minX) || 1;
    const h = Math.ceil(maxY - minY) || 1;
    const dpr = window.devicePixelRatio || 1;

    if (canvasEl.width !== w * dpr || canvasEl.height !== h * dpr) {
      canvasEl.width = w * dpr;
      canvasEl.height = h * dpr;
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
      canvasEl.style.left = minX + 'px';
      canvasEl.style.top = minY + 'px';
    }

    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ox = -minX;
    const oy = -minY;
    const now = performance.now();

    // Start fading after creation + delay
    if (!fadeStart) {
      fadeStart = d.createdAt + FADE_DELAY;
    }

    if (now > fadeStart) {
      opacity = 1 - Math.min(1, (now - fadeStart) / FADE_DURATION);
    }

    if (opacity <= 0) {
      // Remove self from shapes once fully faded
      try {
        const canvas = element.closest('ref-view');
        if (canvas) {
          // Find our shape ID and delete
          const doc = canvas.ref.value();
          const shapes = doc.shapes || {};
          for (const [id, shape] of Object.entries(shapes)) {
            if (shape.data?.createdAt === d.createdAt) {
              canvas.ref.at('shapes').change((s) => { delete s[id]; });
              break;
            }
          }
        }
      } catch(e) {}
      alive = false;
      return;
    }

    ctx.globalAlpha = opacity;

    ctx.lineWidth = 18 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(200, 200, 220, 0.5)';
    ctx.beginPath();
    ctx.moveTo(points[0][0] + ox, points[0][1] + oy);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] + ox, points[i][1] + oy);
    }
    ctx.stroke();

    ctx.lineWidth = 10 * scale;
    ctx.strokeStyle = 'rgba(240, 240, 255, 0.6)';
    ctx.beginPath();
    ctx.moveTo(points[0][0] + ox, points[0][1] + oy);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] + ox, points[i][1] + oy);
    }
    ctx.stroke();

    // Dust particles along the trail
    const time = now / 1000;
    for (let i = 0; i < points.length; i += 3) {
      const px = points[i][0] + ox;
      const py = points[i][1] + oy;

      for (let j = 0; j < 3; j++) {
        const seed = i * 7 + j * 13;
        const angle = (seed * 2.39996) + time * (0.5 + (seed % 5) * 0.2);
        const dist = (5 + ((seed * 3.14) % 15)) * scale;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - (time * 3 % 20) * scale;
        const size = (1 + (seed % 3)) * scale;
        const particleOpacity = Math.max(0, Math.sin(time * 2 + seed) * 0.5 + 0.5) * opacity;

        ctx.globalAlpha = particleOpacity;
        ctx.fillStyle = 'rgba(180, 180, 210, 0.8)';
        ctx.beginPath();
        ctx.arc(px + dx, py + dy, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    animFrame = requestAnimationFrame(animate);
  }

  element.appendChild(canvasEl);
  animFrame = requestAnimationFrame(animate);

  // Also render an invisible div placeholder
  const dispose = render(
    () => html`<div style=${{ display: 'none' }}></div>`,
    element,
  );

  return () => {
    alive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    dispose();
  };
}
