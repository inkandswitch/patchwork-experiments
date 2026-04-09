
import { getStroke } from 'https://esm.sh/perfect-freehand';
import { from, render, html } from '../solid.js';
import sparkleMarkerSchema from './schema.js';



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

function seededRandom(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function parseColor(color) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data;
}

function drawStar(ctx, cx, cy, size, rotation) {
  const spikes = 4;
  const outerRadius = size;
  const innerRadius = size * 0.3;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const a = rotation + (i * Math.PI) / spikes;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function generateParticles(points) {
  if (points.length < 2) return [];
  const result = [];

  for (let i = 1; i < points.length; i += 2) {
    // Each point gets its own seeded random based on its INDEX,
    // so adding new points doesn't change existing particles.
    const rand = seededRandom(i * 7919 + 31);
    const px = points[i][0];
    const py = points[i][1];
    const count = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < count; j++) {
      result.push({
        baseX: px,
        baseY: py,
        angle: rand() * Math.PI * 2,
        speed: 0.2 + rand() * 0.6,
        maxDist: 8 + rand() * 20,
        size: 1 + rand() * 3.5,
        phase: rand() * Math.PI * 2,
        twinkleSpeed: 1.5 + rand() * 3,
        type: rand() > 0.55 ? 'star' : 'circle',
        timeOffset: rand() * 4,
      });
    }
  }
  return result;
}

export default function mount(element) {
  const ref = element.getOrCreate(sparkleMarkerSchema);
  const data = from(ref);

  // Create the particle canvas imperatively
  const canvasEl = document.createElement('canvas');
  canvasEl.style.position = 'absolute';
  canvasEl.style.pointerEvents = 'none';
  canvasEl.style.zIndex = '1';

  let particles = [];
  let lastPointCount = 0;
  let colorRgb = [240, 171, 252];
  let animFrame = null;
  let alive = true;

  function animate() {
    if (!alive) return;
    const d = data();
    if (!d) { animFrame = requestAnimationFrame(animate); return; }

    const points = d.points ?? [];
    const color = d.color ?? '#f0abfc';

    // Update particles incrementally — only generate for NEW points
    // so existing particles keep their stable seeded-random properties.
    if (points.length !== lastPointCount) {
      if (points.length > lastPointCount && lastPointCount > 0) {
        // Incrementally add particles for new points only
        const rand_idx_start = lastPointCount % 2 === 0 ? lastPointCount + 1 : lastPointCount;
        for (let i = rand_idx_start; i < points.length; i += 2) {
          const rand = seededRandom(i * 7919 + 31);
          const px = points[i][0];
          const py = points[i][1];
          const count = 2 + Math.floor(rand() * 3);
          for (let j = 0; j < count; j++) {
            particles.push({
              baseX: px, baseY: py,
              angle: rand() * Math.PI * 2,
              speed: 0.2 + rand() * 0.6,
              maxDist: 8 + rand() * 20,
              size: 1 + rand() * 3.5,
              phase: rand() * Math.PI * 2,
              twinkleSpeed: 1.5 + rand() * 3,
              type: rand() > 0.55 ? 'star' : 'circle',
              timeOffset: rand() * 4,
            });
          }
        }
      } else {
        // Full regeneration (e.g. on load or if points shrunk)
        particles = generateParticles(points);
      }
      lastPointCount = points.length;
      const rgba = parseColor(color);
      colorRgb = [rgba[0], rgba[1], rgba[2]];
    }

    if (particles.length === 0) {
      animFrame = requestAnimationFrame(animate);
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
    const pad = 40;
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
    const now = performance.now() / 1000;
    const [cr, cg, cb] = colorRgb;

    for (const p of particles) {
      const t = now + p.timeOffset;
      const dist = (Math.sin(t * p.speed * 1.5) * 0.5 + 0.5) * p.maxDist;
      const wanderAngle = p.angle + Math.sin(t * 0.7 + p.phase) * 0.8;
      const px = p.baseX + Math.cos(wanderAngle) * dist + ox;
      const py = p.baseY + Math.sin(wanderAngle) * dist + oy;

      const twinkle = Math.sin(t * p.twinkleSpeed + p.phase);
      const opacity = Math.max(0, 0.1 + twinkle * 0.9);
      const currentSize = p.size * (0.4 + twinkle * 0.6);
      if (currentSize < 0.2 || opacity < 0.05) continue;

      ctx.save();
      ctx.globalAlpha = opacity;

      if (p.type === 'star') {
        const rotation = t * 1.5 + p.phase;

        // Glow
        ctx.shadowColor = `rgb(${cr},${cg},${cb})`;
        ctx.shadowBlur = currentSize * 4;

        ctx.fillStyle = `rgba(255,255,255,${opacity})`;
        drawStar(ctx, px, py, currentSize * 1.2, rotation);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity * 0.7})`;
        drawStar(ctx, px, py, currentSize * 0.65, rotation + 0.4);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(px, py, 0, px, py, currentSize * 2.5);
        grad.addColorStop(0, `rgba(255,255,255,${opacity})`);
        grad.addColorStop(0.35, `rgba(${cr},${cg},${cb},${opacity * 0.8})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, currentSize * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    animFrame = requestAnimationFrame(animate);
  }

  const dispose = render(
    () => {
      const points = () => data()?.points ?? [];
      const color = () => data()?.color ?? '#f0abfc';

      const strokePath = () => {
        const pts = points();
        if (pts.length < 2) return '';
        return getSvgPathFromStroke(getStroke(pts, {
          size: 6, thinning: 0.4, smoothing: 0.5, streamline: 0.5,
        }));
      };

      const innerPath = () => {
        const pts = points();
        if (pts.length < 2) return '';
        return getSvgPathFromStroke(getStroke(pts, {
          size: 2.5, thinning: 0.3, smoothing: 0.5, streamline: 0.5,
        }));
      };

      return html`<div style=${{
        position: 'absolute', left: '0', top: '0',
        width: '1px', height: '1px',
        overflow: 'visible', 'pointer-events': 'none',
      }}>
        <svg style=${{
          position: 'absolute', left: '0', top: '0',
          width: '1px', height: '1px',
          overflow: 'visible', 'pointer-events': 'none',
        }}>
          <defs>
            <filter id="sg${element.id || ''}">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>
          <path d=${strokePath} fill=${color} opacity="0.3"
            filter=${`url(#sg${element.id || ''})`} />
          <path d=${strokePath} fill=${color} opacity="0.85" />
          <path d=${innerPath} fill="white" opacity="0.4" />
        </svg>
      </div>`;
    },
    element,
  );

  // Append canvas to element and start animation
  element.appendChild(canvasEl);
  animFrame = requestAnimationFrame(animate);

  return () => {
    alive = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    dispose();
  };
}
