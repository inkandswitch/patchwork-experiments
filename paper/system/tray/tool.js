import { render, html, useRef, createSignal } from '../solid.js';
import { shapesSchema } from '../paper/schema.js';
import traySchema from './schema.js';

const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 100;
const MIME = 'text/x-patchwork-ref-url';

export default function mount(element) {
  const trayRef = element.getOrCreate(traySchema);
  const tray = useRef(trayRef);

  const canvas = element.findParent(shapesSchema);
  const shapesRef = canvas ? canvas.getOrCreate(shapesSchema) : null;

  const [hoverSlot, setHoverSlot] = createSignal(null);

  function shapeIdFromRefUrl(refUrl) {
    const parts = refUrl.split('/');
    return parts[parts.length - 1];
  }

  function computeBounds(data) {
    let minX = 0, minY = 0, maxX = data.width || 0, maxY = data.height || 0;
    if (data.points && data.points.length > 0) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const pt of data.points) {
        const px = pt[0], py = pt[1];
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    const pad = 8;
    return {
      width: Math.max(20, maxX - minX + pad * 2),
      height: Math.max(20, maxY - minY + pad * 2),
      offsetX: minX - pad,
      offsetY: minY - pad,
    };
  }

  function handleDragOver(slotIndex, event) {
    if (event.dataTransfer.types.includes(MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (hoverSlot() !== slotIndex) {
        setHoverSlot(slotIndex);
      }
    }
  }

  function handleDragLeave(slotIndex, event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      if (hoverSlot() === slotIndex) {
        setHoverSlot(null);
      }
    }
  }

  function handleDrop(slotIndex, event) {
    event.preventDefault();
    event.stopPropagation();
    setHoverSlot(null);

    const refUrl = event.dataTransfer.getData(MIME);
    if (!refUrl) return;

    if (!shapesRef) return;
    const shapeId = shapeIdFromRefUrl(refUrl);
    const shapeData = shapesRef.at(shapeId).value();
    if (!shapeData) return;
    if (!shapeData.viewUrl) return;

    const clone = structuredClone(shapeData);
    const bounds = computeBounds(clone);
    clone._trayWidth = bounds.width;
    clone._trayHeight = bounds.height;

    if (bounds.offsetX !== undefined && clone.points) {
      for (const pt of clone.points) {
        pt[0] -= bounds.offsetX;
        pt[1] -= bounds.offsetY;
      }
    }

    trayRef.change((d) => {
      d.slots[slotIndex] = clone;
    });

    shapesRef.change((shapes) => {
      delete shapes[shapeId];
    });
  }

  function handleSlotDragStart(slotIndex, event) {
    const slot = tray.slots?.[slotIndex];
    if (!slot?.viewUrl) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    const refUrl = trayRef.at('slots', slotIndex).url;
    event.dataTransfer.setData(MIME, refUrl);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleSlotDragEnd(slotIndex, event) {
    if (event.dataTransfer.dropEffect === 'move') {
      trayRef.change((d) => {
        d.slots[slotIndex] = null;
      });
    }
  }

  function slotStyle(slot, isHovered) {
    return {
      width: `${SLOT_WIDTH}px`,
      height: `${SLOT_HEIGHT}px`,
      border: isHovered ? '2px solid #3b82f6' : '2px dashed #cbd5e1',
      'border-radius': '8px',
      background: isHovered ? '#eff6ff' : slot ? '#fff' : '#f8fafc',
      position: 'relative',
      overflow: 'hidden',
      'flex-shrink': '0',
      'box-sizing': 'border-box',
      transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
      'box-shadow': isHovered ? '0 0 0 3px rgba(59,130,246,0.2)' : 'none',
    };
  }

  function contentSize(slot) {
    if (!slot) return { width: 200, height: 150 };
    return {
      width: slot._trayWidth || slot.width || 200,
      height: slot._trayHeight || slot.height || 150,
    };
  }

  function scaleForSlot(slot) {
    if (!slot) return 1;
    const { width, height } = contentSize(slot);
    const innerW = SLOT_WIDTH - 4;
    const innerH = SLOT_HEIGHT - 4;
    return Math.min(1, innerW / width, innerH / height);
  }

  return render(
    () =>
      html`<div
        style=${{
          display: 'flex',
          gap: '8px',
          padding: '10px',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
          'border-radius': '12px',
          border: '1px solid #cbd5e1',
          'font-family': 'system-ui, -apple-system, sans-serif',
          'user-select': 'none',
          'box-sizing': 'border-box',
        }}
      >
        ${() =>
          tray.slots?.map((slot, index) => {
            const scale = scaleForSlot(slot);
            const size = contentSize(slot);
            const contentWidth = size.width;
            const contentHeight = size.height;
            const isHovered = hoverSlot() === index && !slot?.viewUrl;
            const scaledW = contentWidth * scale;
            const scaledH = contentHeight * scale;
            return html`<div
              style=${slotStyle(slot, isHovered)}
              draggable=${!!slot?.viewUrl}
              onDragStart=${(e) => handleSlotDragStart(index, e)}
              onDragEnd=${(e) => handleSlotDragEnd(index, e)}
              onDragOver=${(e) => handleDragOver(index, e)}
              onDragLeave=${(e) => handleDragLeave(index, e)}
              onDrop=${(e) => handleDrop(index, e)}
            >
              ${slot?.viewUrl
                ? html`<div
                    style=${{
                      position: 'absolute',
                      left: `${(SLOT_WIDTH - 4 - scaledW) / 2}px`,
                      top: `${(SLOT_HEIGHT - 4 - scaledH) / 2}px`,
                      width: `${contentWidth}px`,
                      height: `${contentHeight}px`,
                      transform: `scale(${scale})`,
                      'transform-origin': 'top left',
                      'pointer-events': 'none',
                    }}
                  >
                    <ref-view
                      ref-url=${trayRef.at('slots', index).url}
                      view-url=${slot.viewUrl}
                      style=${{ display: 'block', width: '100%', height: '100%' }}
                    />
                  </div>`
                : ''}
            </div>`;
          })}
      </div>`,
    element,
  );
}
