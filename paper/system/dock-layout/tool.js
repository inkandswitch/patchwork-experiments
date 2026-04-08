import { render, html, useRef, createSignal } from '../solid.js';
import dockLayoutSchema, { POSITIONS } from './schema.js';
import { shapesSchema } from '../paper/schema.js';

const MIME = 'text/x-patchwork-ref-url';
const EDGE = 16;
const PROXIMITY = 160;

const PULSE_CSS = `
@keyframes dockDotPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96,165,250,0.5); }
  50% { box-shadow: 0 0 0 8px rgba(96,165,250,0); }
}`;

function dotXY(position, width, height) {
  const [row, col] = position.split('-');
  const x = col === 'left' ? EDGE : col === 'right' ? width - EDGE : width / 2;
  const y = row === 'top' ? EDGE : row === 'bottom' ? height - EDGE : height / 2;
  return { x, y };
}

function positionStyle(position) {
  const [row, col] = position.split('-');
  const style = {
    position: 'absolute',
    'pointer-events': 'auto',
    display: 'flex',
    gap: '4px',
  };

  if (row === 'top') style.top = '0';
  else if (row === 'bottom') style.bottom = '0';
  else {
    style.top = '50%';
    style.transform = 'translateY(-50%)';
  }

  if (col === 'left') style.left = '0';
  else if (col === 'right') style.right = '0';
  else {
    const existing = style.transform || '';
    style.left = '50%';
    style.transform = existing ? 'translate(-50%, -50%)' : 'translateX(-50%)';
  }

  return style;
}

export default function mount(element) {
  const layoutRef = element.getOrCreate(dockLayoutSchema);
  const layout = useRef(layoutRef);

  const [isDragging, setIsDragging] = createSignal(false);
  const [cursor, setCursor] = createSignal({ x: 0, y: 0 });
  const [hoverPosition, setHoverPosition] = createSignal(null);
  const [containerSize, setContainerSize] = createSignal({ w: 0, h: 0 });

  let containerEl = null;
  let resizeObserver = null;

  function setContainerRef(el) {
    if (containerEl === el) return;
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    containerEl = el;
    if (!el) return;

    resizeObserver = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    resizeObserver.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
  }

  function cursorToLocal(clientX, clientY) {
    if (!containerEl) return null;
    const rect = containerEl.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function findClosestPosition(localX, localY) {
    const { w, h } = containerSize();
    let closest = null;
    let closestDist = Infinity;
    for (const pos of POSITIONS) {
      const dot = dotXY(pos, w, h);
      const dist = Math.hypot(localX - dot.x, localY - dot.y);
      if (dist < closestDist) {
        closestDist = dist;
        closest = pos;
      }
    }
    return closestDist < PROXIMITY ? closest : null;
  }

  function deleteOriginalShape(refUrl) {
    const canvas = element.findClosest(shapesSchema);
    if (!canvas) return;
    const shapesRef = canvas.getOrCreate(shapesSchema);
    const shapeId = refUrl.split('/').pop();
    if (!shapeId) return;
    const existing = shapesRef.at(shapeId).value();
    if (!existing) return;
    shapesRef.change((shapes) => {
      delete shapes[shapeId];
    });
  }

  function onDocDragOver(event) {
    if (!event.dataTransfer.types.includes(MIME)) return;
    if (!containerEl) return;

    const local = cursorToLocal(event.clientX, event.clientY);
    if (!local) return;

    setCursor(local);
    setIsDragging(true);

    const pos = findClosestPosition(local.x, local.y);
    setHoverPosition(pos);

    if (pos) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onDocDrop(event) {
    if (!isDragging()) return;

    const pos = hoverPosition();
    setIsDragging(false);
    setHoverPosition(null);

    if (!pos) return;

    const refUrl = event.dataTransfer.getData(MIME);
    if (!refUrl) return;

    event.preventDefault();
    event.stopPropagation();

    element.findRef(refUrl).then((ref) => {
      const data = ref.value();
      if (!data || !data.viewUrl) return;

      const clone = structuredClone(data);
      delete clone.x;
      delete clone.y;
      delete clone._trayWidth;
      delete clone._trayHeight;

      const existing = layoutRef.at(pos).value();
      const items = Array.isArray(existing) ? existing : [];
      layoutRef.at(pos).change(() => [...items.map((i) => structuredClone(i)), clone]);

      deleteOriginalShape(refUrl);
    }).catch(() => {});
  }

  function onDocDragEnd() {
    setIsDragging(false);
    setHoverPosition(null);
  }

  document.addEventListener('dragover', onDocDragOver, true);
  document.addEventListener('drop', onDocDrop, true);
  document.addEventListener('dragend', onDocDragEnd, true);

  function renderDots() {
    if (!isDragging()) return '';
    const { w, h } = containerSize();
    const cur = cursor();

    return POSITIONS.map((pos) => {
      const dot = dotXY(pos, w, h);
      const dist = Math.hypot(cur.x - dot.x, cur.y - dot.y);
      const visible = dist < PROXIMITY;
      const isActive = hoverPosition() === pos;
      const t = visible ? Math.max(0, 1 - dist / PROXIMITY) : 0;
      const size = isActive ? 14 : 6 + t * 4;

      return html`<div
        style=${{
          position: 'absolute',
          left: `${dot.x - size / 2}px`,
          top: `${dot.y - size / 2}px`,
          width: `${size}px`,
          height: `${size}px`,
          'border-radius': '50%',
          background: isActive ? '#60a5fa' : `rgba(148,163,184,${t * 0.8})`,
          transition:
            'width 0.2s ease, height 0.2s ease, left 0.2s ease, top 0.2s ease, background 0.2s ease, opacity 0.2s ease',
          opacity: t > 0.05 ? 1 : 0,
          animation: isActive ? 'dockDotPulse 1s ease infinite' : 'none',
          'pointer-events': 'none',
          'z-index': 25,
        }}
      />`;
    });
  }

  function renderSlots() {
    return POSITIONS.map((pos) => {
      const items = layout[pos];
      if (!Array.isArray(items) || items.length === 0) return '';
      return html`<div style=${positionStyle(pos)}>
        ${items.map(
          (item, index) =>
            html`<ref-view
              ref-url=${layoutRef.at(pos, index).url}
              view-url=${item.viewUrl}
              style=${{ display: 'block' }}
            />`,
        )}
      </div>`;
    });
  }

  const cleanup = render(
    () =>
      html`<style>${PULSE_CSS}</style
        ><div
          ref=${setContainerRef}
          style=${{
            position: 'relative',
            width: '100%',
            height: '100%',
            'pointer-events': 'none',
          }}
        >
          ${renderDots} ${renderSlots}
        </div>`,
    element,
  );

  return () => {
    document.removeEventListener('dragover', onDocDragOver, true);
    document.removeEventListener('drop', onDocDrop, true);
    document.removeEventListener('dragend', onDocDragEnd, true);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    cleanup();
  };
}
