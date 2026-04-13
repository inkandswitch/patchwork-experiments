import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html, createSignal } from '../solid.js';
import { getViewUrl, toViewPath } from '../url.js';
import { selectedToolSchema, shapesSchema, selectedShapesSchema } from '../paper/schema.js';

const TOOL_NAME = 'selection';

const ButtonShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
});

export const schema = {
  init() {
    return { x: 40, y: 10, viewUrl: getViewUrl('./button.json', import.meta.url) };
  },
  parse(value) {
    return ButtonShapeSchema.parse(value);
  },
};

const schemaCache = new Map();
async function loadSchema(schemaUrl) {
  if (schemaCache.has(schemaUrl)) return schemaCache.get(schemaUrl);
  try {
    const mod = await import(schemaUrl);
    schemaCache.set(schemaUrl, mod.default);
    return mod.default;
  } catch {
    return null;
  }
}

async function findCompatibleTools(shapeData, toolPlugins) {
  const results = [];
  for (const plugin of toolPlugins) {
    if (!plugin.schemaUrl) continue;
    try {
      const pluginSchema = await loadSchema(plugin.schemaUrl);
      if (!pluginSchema) continue;
      pluginSchema.parse(shapeData);
      results.push(plugin);
    } catch {
      // schema incompatible
    }
  }
  return results;
}

async function findCompatibleToolsForEmbed(element, embedDocUrl, toolPlugins) {
  if (!embedDocUrl) return [];
  try {
    const docRef = await element.findRef(embedDocUrl);
    const value = docRef.value();
    const results = [];
    for (const plugin of toolPlugins) {
      if (!plugin.schemaUrl) continue;
      try {
        const pluginSchema = await loadSchema(plugin.schemaUrl);
        if (!pluginSchema) continue;
        pluginSchema.parse(value);
        results.push(plugin);
      } catch {
        // schema incompatible
      }
    }
    return results;
  } catch {
    return [];
  }
}

// Normalize a tool URL to the short relative path for comparison
function normalizeToolUrl(url) {
  if (!url) return '';
  // If it's already a short path like "line/tool.js", return as-is
  if (!url.startsWith('http')) return url;
  return toViewPath(url);
}

// ---- Imperative context menu rendered directly on document.body ----

function createContextMenuOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;';

  const menu = document.createElement('div');
  menu.style.cssText = `
    position: absolute;
    min-width: 200px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    padding: 4px 0;
    user-select: none;
    max-height: 400px;
    overflow-y: auto;
  `;
  overlay.appendChild(menu);

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  return { overlay, menu };
}

function createMenuHeader(text) {
  const el = document.createElement('div');
  el.style.cssText = 'padding:6px 12px;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;';
  el.textContent = text;
  return el;
}

function createMenuDivider() {
  const el = document.createElement('div');
  el.style.cssText = 'height:1px;background:#e2e8f0;margin:2px 0;';
  return el;
}

function createMenuItem(icon, label, color, onClick) {
  const btn = document.createElement('button');
  btn.style.cssText = `
    display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;
    border:none;background:none;cursor:pointer;text-align:left;font-size:13px;
    color:${color || '#334155'};font-family:inherit;
  `;
  const iconSpan = document.createElement('span');
  iconSpan.style.cssText = 'width:16px;text-align:center;flex-shrink:0';
  iconSpan.textContent = icon;
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  btn.appendChild(iconSpan);
  btn.appendChild(labelSpan);
  const hoverBg = color === '#ef4444' ? '#fef2f2' : '#f1f5f9';
  btn.addEventListener('mouseover', () => { btn.style.background = hoverBg; });
  btn.addEventListener('mouseout', () => { btn.style.background = 'none'; });
  btn.addEventListener('click', onClick);
  return btn;
}

function createToolMenuItem(name, isActive, onClick) {
  const btn = document.createElement('button');
  btn.style.cssText = `
    display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;
    border:none;background:${isActive ? '#eff6ff' : 'none'};cursor:pointer;
    text-align:left;font-size:13px;color:${isActive ? '#3b82f6' : '#334155'};
    font-weight:${isActive ? '600' : '400'};font-family:inherit;
  `;
  const iconSpan = document.createElement('span');
  iconSpan.style.cssText = 'width:16px;text-align:center;flex-shrink:0';
  iconSpan.textContent = isActive ? '✓' : '';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = name;
  btn.appendChild(iconSpan);
  btn.appendChild(labelSpan);
  if (!isActive) {
    btn.addEventListener('mouseover', () => { btn.style.background = '#f1f5f9'; });
    btn.addEventListener('mouseout', () => { btn.style.background = 'none'; });
  }
  btn.addEventListener('click', onClick);
  return btn;
}

function createLoadingItem() {
  const el = document.createElement('div');
  el.style.cssText = 'padding:8px 12px;color:#94a3b8;font-style:italic;';
  el.textContent = 'Loading…';
  return el;
}

export default function mount(element) {
  const canvas = element.findParent(shapesSchema);
  if (!canvas) return;
  const selectedToolRef = canvas.getOrCreate(selectedToolSchema);
  const selectedTool = from(selectedToolRef);
  const selectedShapesRef = canvas.getOrCreate(selectedShapesSchema);
  const shapesRef = canvas.getOrCreate(shapesSchema);

  const toolPlugins = from(element.plugins.byType('tool'));

  let activeOverlay = null;

  function closeMenu() {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
  }

  function isSelectionToolActive() {
    return selectedTool() === TOOL_NAME;
  }

  function toggleTool() {
    if (isSelectionToolActive()) {
      selectedShapesRef.change(() => ({}));
    }
    selectedToolRef.change(() => (isSelectionToolActive() ? '' : TOOL_NAME));
  }

  let dragShapeId = null;
  let dragSourceCanvas = null;
  let dragSourceShapesRef = null;
  let startPointerX = 0;
  let startPointerY = 0;
  let startShapeX = 0;
  let startShapeY = 0;
  let dragThresholdMet = false;
  let dragOverlay = null;
  let dragOriginalParent = null;
  let dragOriginalNextSibling = null;
  const DRAG_THRESHOLD = 5;

  function isInteractiveTarget(event) {
    let node = event.target;
    while (node && node !== canvas) {
      if (node instanceof HTMLButtonElement ||
          node instanceof HTMLInputElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLAnchorElement ||
          (node instanceof HTMLElement && node.isContentEditable)) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function onPointerDown(event) {
    if (!isSelectionToolActive()) return;
    if (isInteractiveTarget(event)) return;

    closeMenu();

    const sourceCanvas = findTargetContext(event.target) ?? canvas;
    const sourceShapesRef = sourceCanvas.getOrCreate(shapesSchema);

    let shapeId = shapeIdFromEvent(event, sourceCanvas);
    if (!shapeId && sourceCanvas === canvas) {
      shapeId = probeNearbyShapes(event, canvas);
    }
    if (!shapeId && sourceCanvas === canvas) {
      shapeId = findNearbyLine(event, canvas, shapesRef);
    }
    if (!shapeId) {
      selectedShapesRef.change(() => ({}));
      return;
    }

    const shape = sourceShapesRef.at(shapeId).value();
    if (shape.isLocked) return;

    event.stopPropagation();

    if (sourceCanvas === canvas) {
      selectedShapesRef.change(() => ({ [shapeId]: true }));
    }

    const allShapes = sourceShapesRef.value();
    let maxZ = 0;
    for (const [sid, s] of Object.entries(allShapes)) {
      if (typeof s.z === 'number' && s.z > maxZ) maxZ = s.z;
    }
    const currentZ = shape.z ?? 0;
    if (currentZ < maxZ || maxZ === 0) {
      sourceShapesRef.at(shapeId).change((s) => {
        s.z = maxZ + 1;
      });
    }

    dragShapeId = shapeId;
    dragSourceCanvas = sourceCanvas;
    dragSourceShapesRef = sourceShapesRef;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startShapeX = shape.x;
    startShapeY = shape.y;
    canvas.setPointerCapture(event.pointerId);
    dragThresholdMet = false;
  }

  function onPointerMove(event) {
    if (!dragShapeId) return;
    const startPage = dragSourceCanvas.screenToPage(startPointerX, startPointerY);
    const currentPage = dragSourceCanvas.screenToPage(event.clientX, event.clientY);
    dragSourceShapesRef.at(dragShapeId).change((shape) => {
      shape.x = startShapeX + (currentPage.x - startPage.x);
      shape.y = startShapeY + (currentPage.y - startPage.y);
    });
    if (!dragThresholdMet) {
      const deltaX = event.clientX - startPointerX;
      const deltaY = event.clientY - startPointerY;
      if (Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
        dragThresholdMet = true;
        if (dragSourceCanvas !== canvas) {
          liftDraggedShape(dragShapeId, dragSourceCanvas);
        }
      }
    }
  }

  function onPointerUp(event) {
    if (dragShapeId && dragThresholdMet) {
      const target = elementUnderCursor(event.clientX, event.clientY, dragShapeId, dragSourceCanvas);
      if (target) {
        const targetCanvas = findTargetContext(target);
        if (targetCanvas && targetCanvas !== dragSourceCanvas) {
          const shapeValue = { ...dragSourceShapesRef.at(dragShapeId).value() };
          const targetShapesRef = targetCanvas.getOrCreate(shapesSchema);
          const dropPage = targetCanvas.screenToPage(event.clientX, event.clientY);
          const startPage = dragSourceCanvas.screenToPage(startPointerX, startPointerY);
          const grabOffsetX = startShapeX - startPage.x;
          const grabOffsetY = startShapeY - startPage.y;
          shapeValue.x = dropPage.x + grabOffsetX;
          shapeValue.y = dropPage.y + grabOffsetY;
          restoreDraggedShape();
          const newId = `move_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          targetShapesRef.at(newId).change(() => shapeValue);
          dragSourceShapesRef.change((shapes) => { delete shapes[dragShapeId]; });
        }
      }
    }
    restoreDraggedShape();
    dragShapeId = null;
    dragSourceCanvas = null;
    dragSourceShapesRef = null;
    dragThresholdMet = false;
  }

  function elementUnderCursor(clientX, clientY, shapeId, canvasEl) {
    // Find the dragged shape's positioned wrapper div and temporarily hide it
    // Paper structure: canvas(ref-view) > div[relative] > div[absolute] > ref-view[shape]
    const allRefViews = canvasEl.querySelectorAll('ref-view');
    let wrapper = null;
    for (const rv of allRefViews) {
      const refUrl = rv.getAttribute('ref-url') || '';
      if (refUrl.endsWith('/' + shapeId)) {
        wrapper = rv.parentElement;
        break;
      }
    }
    if (wrapper) {
      const prev = wrapper.style.pointerEvents;
      const prevVis = wrapper.style.visibility;
      wrapper.style.pointerEvents = 'none';
      wrapper.style.visibility = 'hidden';
      const target = document.elementFromPoint(clientX, clientY);
      wrapper.style.pointerEvents = prev;
      wrapper.style.visibility = prevVis;
      if (isCanvasBackground(target, canvasEl)) return null;
      return target;
    }
    const target = document.elementFromPoint(clientX, clientY);
    if (isCanvasBackground(target, canvasEl)) return null;
    return target;
  }

  function isCanvasBackground(target, canvasEl) {
    if (!target) return false;
    const closestRefView = target.closest('ref-view');
    return closestRefView === canvasEl;
  }

  function liftDraggedShape(shapeId, sourceCanvas) {
    const allRefViews = sourceCanvas.querySelectorAll('ref-view');
    let wrapper = null;
    for (const rv of allRefViews) {
      const refUrl = rv.getAttribute('ref-url') || '';
      if (refUrl.endsWith('/' + shapeId)) {
        wrapper = rv.parentElement;
        break;
      }
    }
    if (!wrapper || !wrapper.parentElement) return;
    if (!document.body.moveBefore) return;

    dragOriginalParent = wrapper.parentElement;
    dragOriginalNextSibling = wrapper.nextSibling;

    const containerEl = sourceCanvas.getContainerEl();
    const containerRect = containerEl.getBoundingClientRect();
    const cam = sourceCanvas.getCamera();

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;pointer-events:none;overflow:visible;';

    const transformDiv = document.createElement('div');
    transformDiv.style.cssText = `
      position:absolute;
      left:${containerRect.left}px;
      top:${containerRect.top}px;
      width:${containerRect.width}px;
      height:${containerRect.height}px;
      transform-origin:0 0;
      transform:scale(${cam.zoom}) translate(${cam.x}px,${cam.y}px);
    `;
    overlay.appendChild(transformDiv);
    document.body.appendChild(overlay);

    transformDiv.moveBefore(wrapper, null);
    dragOverlay = overlay;
  }

  function restoreDraggedShape() {
    if (!dragOverlay) return;
    if (dragOriginalParent && dragOverlay.querySelector('div')?.firstChild) {
      const wrapper = dragOverlay.querySelector('div').firstChild;
      if (dragOriginalParent.moveBefore) {
        dragOriginalParent.moveBefore(wrapper, dragOriginalNextSibling);
      } else {
        dragOriginalParent.insertBefore(wrapper, dragOriginalNextSibling);
      }
    }
    dragOverlay.remove();
    dragOverlay = null;
    dragOriginalParent = null;
    dragOriginalNextSibling = null;
  }

  function findTargetContext(target) {
    const refView = target.closest('ref-view');
    return refView?.findClosest?.(shapesSchema) ?? null;
  }

  function onKeyDown(event) {
    if (!isSelectionToolActive()) return;
    if (isFocusedTextEditingTarget()) return;

    if (event.key === 'Escape') {
      closeMenu();
      return;
    }

    if (event.metaKey && event.key === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const selected = selectedShapesRef.value();
    const ids = Object.keys(selected).filter((shapeId) => {
      const shapeEntry = shapesRef.at(shapeId).value();
      return !shapeEntry.isLocked;
    });
    if (!ids.length) return;
    event.preventDefault();
    shapesRef.change((shapes) => {
      for (const id of ids) {
        delete shapes[id];
      }
    });
    selectedShapesRef.change(() => ({}));
  }

  function duplicateSelection() {
    const selected = selectedShapesRef.value();
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (!ids.length) return;

    const newSelection = {};
    for (const id of ids) {
      const shape = shapesRef.at(id).value();
      if (!shape || shape.isLocked) continue;
      const newId = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const clone = structuredClone(shape);
      if (typeof clone.width === 'number' && typeof clone.height === 'number') {
        clone.x += clone.width;
      } else {
        clone.x += 10;
        clone.y += 10;
      }
      shapesRef.at(newId).change(() => clone);
      newSelection[newId] = true;
    }
    selectedShapesRef.change(() => newSelection);
  }

  // ---- Context Menu ----

  async function onContextMenu(event) {
    if (!isSelectionToolActive()) return;

    let shapeId = shapeIdFromEvent(event, canvas);
    if (!shapeId) shapeId = probeNearbyShapes(event, canvas);
    if (!shapeId) shapeId = findNearbyLine(event, canvas, shapesRef);
    if (!shapeId) {
      closeMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const shape = shapesRef.at(shapeId).value();
    const isLocked = !!shape.isLocked;
    const isEmbed = !!shape.embedDocUrl;
    const currentToolUrl = isEmbed ? shape.embedToolUrl : shape.toolUrl;
    const normalizedCurrent = normalizeToolUrl(currentToolUrl);

    // Select the shape
    selectedShapesRef.change(() => ({ [shapeId]: true }));

    closeMenu();

    const { overlay, menu } = createContextMenuOverlay();
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    // Header
    const displayId = shapeId.length > 24 ? shapeId.slice(0, 24) + '…' : shapeId;
    menu.appendChild(createMenuHeader(displayId));
    menu.appendChild(createMenuDivider());

    // Lock/Unlock
    menu.appendChild(createMenuItem(
      isLocked ? '🔓' : '🔒',
      isLocked ? 'Unlock' : 'Lock',
      '#334155',
      () => {
        shapesRef.at(shapeId).change((s) => {
          s.isLocked = !isLocked;
        });
        if (!isLocked) {
          selectedShapesRef.change(() => ({}));
        }
        closeMenu();
      }
    ));

    // Delete & Duplicate (only if not locked)
    if (!isLocked) {
      menu.appendChild(createMenuItem(
        '📋',
        'Duplicate',
        '#334155',
        () => {
          const s = shapesRef.at(shapeId).value();
          if (!s) { closeMenu(); return; }
          const newId = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const clone = structuredClone(s);
          if (typeof clone.width === 'number' && typeof clone.height === 'number') {
            clone.x += clone.width;
          } else {
            clone.x += 20;
            clone.y += 20;
          }
          shapesRef.at(newId).change(() => clone);
          selectedShapesRef.change(() => ({ [newId]: true }));
          closeMenu();
        }
      ));

      menu.appendChild(createMenuItem(
        '🗑',
        'Delete',
        '#ef4444',
        () => {
          shapesRef.change((shapes) => {
            delete shapes[shapeId];
          });
          selectedShapesRef.change(() => ({}));
          closeMenu();
        }
      ));
    }

    menu.appendChild(createMenuDivider());
    menu.appendChild(createMenuHeader('Render as'));

    const loadingEl = createLoadingItem();
    menu.appendChild(loadingEl);

    document.body.appendChild(overlay);
    activeOverlay = overlay;

    // Adjust position if off-screen
    requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.right > window.innerWidth) {
        menu.style.left = Math.max(4, event.clientX - menuRect.width) + 'px';
      }
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = Math.max(4, event.clientY - menuRect.height) + 'px';
      }
    });

    // Find compatible tools async
    const plugins = toolPlugins() ?? [];
    let compatible;
    if (isEmbed) {
      compatible = await findCompatibleToolsForEmbed(element, shape.embedDocUrl, plugins);
    } else {
      compatible = await findCompatibleTools(shape, plugins);
    }

    // Check menu is still open for this shape
    if (activeOverlay !== overlay) return;

    loadingEl.remove();

    if (compatible.length === 0) {
      const noTools = document.createElement('div');
      noTools.style.cssText = 'padding:8px 12px;color:#94a3b8;font-style:italic;';
      noTools.textContent = 'No compatible tools';
      menu.appendChild(noTools);
    } else {
      for (const plugin of compatible) {
        // Convert plugin.source (absolute URL) to the short relative path
        const pluginPath = normalizeToolUrl(plugin.source);
        const isActive = pluginPath === normalizedCurrent;
        menu.appendChild(createToolMenuItem(
          plugin.name,
          isActive,
          () => {
            shapesRef.at(shapeId).change((s) => {
              if (isEmbed) {
                s.embedToolUrl = pluginPath;
              } else {
                s.toolUrl = pluginPath;
              }
            });
            closeMenu();
          }
        ));
      }
    }

    // Re-check position after tools loaded
    requestAnimationFrame(() => {
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = Math.max(4, event.clientY - menuRect.height) + 'px';
      }
    });
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);

  const dispose = render(
    () =>
      html`<button
        onPointerDown=${(e) => e.stopPropagation()}
        onClick=${toggleTool}
        style=${() => ({
          width: '32px',
          height: '32px',
          border: isSelectionToolActive() ? '2px solid #3b82f6' : '1px solid #d4d4d8',
          'border-radius': '6px',
          background: isSelectionToolActive() ? '#eff6ff' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          padding: '0',
        })}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 2l8 6-4 1-2 4-2-11z" stroke=${() => (isSelectionToolActive() ? '#3b82f6' : '#71717a')} stroke-width="1.5" fill="none" stroke-linejoin="round" />
        </svg>
      </button>`,
    element,
  );

  return () => {
    closeMenu();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
    dispose();
  };
}

function shapeIdFromEvent(event, canvas) {
  let refView = event.target.closest('ref-view');
  while (refView && refView !== canvas) {
    const parentRefView = refView.parentElement?.closest('ref-view');
    if (parentRefView === canvas) {
      const refUrl = refView.getAttribute('ref-url');
      if (!refUrl) return null;
      const parts = refUrl.split('/');
      return parts[parts.length - 1];
    }
    refView = parentRefView;
  }
  return null;
}

const PROBE_OFFSETS = [
  [6, 0], [-6, 0], [0, 6], [0, -6],
  [6, 6], [-6, -6], [6, -6], [-6, 6],
  [10, 0], [-10, 0], [0, 10], [0, -10],
];

function findShapeRefView(startEl, canvas) {
  let refView = startEl.closest('ref-view');
  while (refView && refView !== canvas) {
    const parentRefView = refView.parentElement?.closest('ref-view');
    if (parentRefView === canvas) return refView;
    refView = parentRefView;
  }
  return null;
}

function probeNearbyShapes(event, canvas) {
  for (const [dx, dy] of PROBE_OFFSETS) {
    const el = document.elementFromPoint(event.clientX + dx, event.clientY + dy);
    if (!el) continue;
    const refView = findShapeRefView(el, canvas);
    if (!refView) continue;
    const refUrl = refView.getAttribute('ref-url');
    if (!refUrl) continue;
    const parts = refUrl.split('/');
    return parts[parts.length - 1];
  }
  return null;
}

function findNearbyLine(event, canvas, shapesRef) {
  const { x: cursorX, y: cursorY } = canvas.screenToPage(event.clientX, event.clientY);
  const shapes = shapesRef.value();
  const threshold = 10;

  let closestId = null;
  let closestDist = threshold;

  for (const [id, shape] of Object.entries(shapes)) {
    if (!shape.points || shape.points.length < 2) continue;
    if (shape.isLocked) continue;

    for (let i = 0; i < shape.points.length - 1; i++) {
      const segStartX = shape.x + shape.points[i][0];
      const segStartY = shape.y + shape.points[i][1];
      const segEndX = shape.x + shape.points[i + 1][0];
      const segEndY = shape.y + shape.points[i + 1][1];
      const dist = distanceToSegment(cursorX, cursorY, segStartX, segStartY, segEndX, segEndY);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = id;
      }
    }
  }

  return closestId;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function isFocusedTextEditingTarget() {
  const activeElement = document.activeElement;
  if (!activeElement || !(activeElement instanceof HTMLElement)) return false;
  if (activeElement.isContentEditable) return true;
  if (
    activeElement.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]',
    )
  ) {
    return true;
  }
  if (activeElement instanceof HTMLTextAreaElement) {
    return !activeElement.readOnly && !activeElement.disabled;
  }
  if (activeElement instanceof HTMLInputElement) {
    if (activeElement.readOnly || activeElement.disabled) return false;
    const textEditingTypes = new Set([
      '',
      'text',
      'search',
      'url',
      'tel',
      'email',
      'password',
      'number',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
    ]);
    return textEditingTypes.has(activeElement.type);
  }
  return false;
}
