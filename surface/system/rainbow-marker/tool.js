
import { getStroke } from 'https://esm.sh/perfect-freehand';
import { from, render, html } from '../solid.js';
import { schema } from './schema.js';

export { schema };

function getSvgPathFromStroke(points) {
  if (points.length < 4) return '';
  let a = points[0];
  let b = points[1];
  const c = points[2];
  const avg = (x, y) => (x + y) / 2;

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2, max = points.length - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  result += 'Z';
  return result;
}

// Compute cumulative arc-length at each point
function cumulativeLength(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    lengths.push(lengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return lengths;
}

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  // We'll use a canvas for the rainbow effect
  const canvasEl = document.createElement('canvas');
  canvasEl.style.position = 'absolute';
  canvasEl.style.pointerEvents = 'none';

  let animFrame = null;
  let alive = true;

  const RAINBOW = [
    '#ff0000', // red
    '#ff8800', // orange
    '#ffdd00', // yellow
    '#22cc44', // green
    '#2288ff', // blue
    '#6633cc', // indigo
    '#cc33cc', // violet
  ];

  function hslForT(t) {
    // t in [0,1] maps across the rainbow hue wheel
    const hue = (t * 360) % 360;
    return `hsl(${hue}, 90%, 55%)`;
  }

  function drawRainbow() {
    if (!alive) return;
    const d = data();
    if (!d) { animFrame = requestAnimationFrame(drawRainbow); return; }

    const points = d.points ?? [];
    if (points.length < 2) {
      // Clear canvas
      const ctx = canvasEl.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      animFrame = requestAnimationFrame(drawRainbow);
      return;
    }

    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const pad = 20;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const w = Math.ceil(maxX - minX) || 1;
    const h = Math.ceil(maxY - minY) || 1;
    const dpr = window.devicePixelRatio || 1;

    if (canvasEl.width !== w * dpr || canvasEl.height !== h * dpr) {
      canvasEl.width = w * dpr;
      canvasEl.height = h * dpr;
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
    }
    canvasEl.style.left = minX + 'px';
    canvasEl.style.top = minY + 'px';

    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ox = -minX;
    const oy = -minY;

    // Compute cumulative lengths for color mapping
    const cumLen = cumulativeLength(points);
    const totalLen = cumLen[cumLen.length - 1] || 1;

    // Animate: shift the rainbow over time
    const now = performance.now() / 1000;
    const shift = (now * 1.5) % 1; // slowly cycle

    // Draw thick segments with rainbow colors
    const strokeSize = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < points.length - 1; i++) {
      const t = (cumLen[i] / totalLen + shift) % 1;
      const x1 = points[i][0] + ox;
      const y1 = points[i][1] + oy;
      const x2 = points[i + 1][0] + ox;
      const y2 = points[i + 1][1] + oy;

      // Pressure-based width
      const pressure = (points[i][2] + points[i + 1][2]) / 2;
      const lineWidth = strokeSize * (0.5 + pressure * 0.8);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = hslForT(t);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // Draw a subtle white inner highlight
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < points.length - 1; i++) {
      const x1 = points[i][0] + ox;
      const y1 = points[i][1] + oy;
      const x2 = points[i + 1][0] + ox;
      const y2 = points[i + 1][1] + oy;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'white';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Add subtle glow dots at intervals
    const glowInterval = 15;
    for (let i = 0; i < points.length; i += 3) {
      const t = (cumLen[i] / totalLen + shift) % 1;
      const px = points[i][0] + ox;
      const py = points[i][1] + oy;
      const size = 3 + Math.sin(now * 15 + i) * 1.5;

      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(now * 20 + i * 0.5) * 0.3;
      ctx.shadowColor = hslForT(t);
      ctx.shadowBlur = 8;
      ctx.fillStyle = hslForT(t);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    animFrame = requestAnimationFrame(drawRainbow);
  }

  const dispose = render(
    () => html`<div style=${{
      position: 'absolute', left: '0', top: '0',
      width: '1px', height: '1px',
      overflow: 'visible', 'pointer-events': 'none',
    }}></div>`,
    element,
  );

  element.appendChild(canvasEl);
  animFrame = requestAnimationFrame(drawRainbow);

  return () => {
    alive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    dispose();
  };
}
