import { render, html, useRef, createSignal } from '../solid.js';
import dockLayoutSchema, { POSITIONS } from './schema.js';

const EDGE = 16;

export default function mount(element) {
  const layoutRef = element.getOrCreate(dockLayoutSchema);
  const layout = useRef(layoutRef);

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

  function renderTrays() {
    containerSize();
    return POSITIONS.map((pos) => {
      const items = layout[pos];
      const hasItems = Array.isArray(items) && items.length > 0;
      if (!hasItems) return '';

      return html`<div style=${trayStyle(pos)}>
        ${items.map(
          (item, i) =>
            html`<ref-view
              ref-url=${layoutRef.at(pos, i).url}
              view-url=${item.viewUrl}
              style=${{ display: 'block' }}
            />`,
        )}
      </div>`;
    });
  }

  function trayStyle(pos) {
    const [row, col] = pos.split('-');
    const style = {
      position: 'absolute',
      display: 'flex',
      'flex-direction': row === 'middle' ? 'column' : 'row',
      gap: '4px',
      'pointer-events': 'auto',
      'z-index': '25',
      'align-items': 'center',
    };

    if (row === 'top') style.top = `${EDGE}px`;
    else if (row === 'bottom') style.bottom = `${EDGE}px`;
    else style.top = '50%';

    if (col === 'left') style.left = `${EDGE}px`;
    else if (col === 'right') style.right = `${EDGE}px`;
    else style.left = '50%';

    style.transform = trayTransform(pos);

    return style;
  }

  const cleanup = render(
    () =>
      html`<div
        ref=${setContainerRef}
        style=${{
          position: 'relative',
          width: '100%',
          height: '100%',
          'pointer-events': 'none',
        }}
      >
        ${renderTrays}
      </div>`,
    element,
  );

  return () => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    cleanup();
  };
}

function trayTransform(position) {
  const [row, col] = position.split('-');
  const parts = [];
  if (col === 'center') parts.push('translateX(-50%)');
  if (row === 'middle') parts.push('translateY(-50%)');
  return parts.length > 0 ? parts.join(' ') : 'none';
}
