/**
 * Paper skill — place and manage shapes on a Paper document.
 *
 * PaperDoc shape:
 *   { shapes: Record<string, BaseShape> }
 *
 * BaseShape: { id, x, y, zIndex, type, ...}
 * EmbedShape:     { ...base, type: 'embed', docUrl, docType, toolId?, toolUrl?, width, height }
 * TextShape:      { ...base, type: 'text', text, color?, fontSize? }
 * RectangleShape: { ...base, type: 'rectangle', w, h, fill, stroke, strokeWidth, rotation? }
 *
 * Note: rectangles use `w`/`h` (not `width`/`height`); embeds use `width`/`height`.
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Return the current max zIndex across all shapes, or 0 if the canvas is empty.
 */
function nextZIndex(doc) {
  const shapes = Object.values(doc.shapes ?? {});
  if (shapes.length === 0) return 1;
  return Math.max(...shapes.map((s) => s.zIndex ?? 0)) + 1;
}

/**
 * Collect axis-aligned bounding boxes for all shapes that occupy space.
 * Works for both embed shapes (width/height) and rectangle shapes (w/h).
 */
function getBoundingBoxes(shapes) {
  return Object.values(shapes)
    .map((s) => {
      const w = s.width ?? s.w;
      const h = s.height ?? s.h;
      if (typeof w !== 'number' || typeof h !== 'number') return null;
      return { x: s.x, y: s.y, right: s.x + w, bottom: s.y + h };
    })
    .filter(Boolean);
}

/**
 * Test whether a candidate rectangle overlaps any of the given bounding boxes,
 * including a `padding` gap on all sides.
 */
function overlaps(boxes, x, y, w, h, padding) {
  const cx1 = x - padding;
  const cy1 = y - padding;
  const cx2 = x + w + padding;
  const cy2 = y + h + padding;
  return boxes.find((b) => cx1 < b.right && cx2 > b.x && cy1 < b.bottom && cy2 > b.y);
}

// ─── Smart placement ──────────────────────────────────────────────────────────

/**
 * Find the first empty position for a rectangle of size `width × height`.
 *
 * Strategy: scan left-to-right, top-to-bottom in a grid anchored at
 * (`startX`, `startY`). Whenever a candidate overlaps an existing shape,
 * jump the x-cursor past that shape's right edge. When the row is
 * exhausted (x would exceed `startX + rowWidth`), drop down by one row.
 *
 * @param {Record<string, object>} shapes - Current doc.shapes
 * @param {number} width  - Width of the item to place
 * @param {number} height - Height of the item to place
 * @param {object} [opts]
 * @param {number} [opts.startX=0]      - Left edge of the search area
 * @param {number} [opts.startY=0]      - Top edge of the search area
 * @param {number} [opts.padding=24]    - Minimum gap between items
 * @param {number} [opts.rowWidth=3000] - Max x before wrapping to a new row
 * @returns {{ x: number, y: number }}
 */
export function findFreePosition(shapes, width, height, opts = {}) {
  const {
    startX = 0,
    startY = 0,
    padding = 24,
    rowWidth = 3000,
  } = opts;

  const boxes = getBoundingBoxes(shapes);

  let x = startX;
  let y = startY;
  let rowBottom = startY + height;

  for (let iter = 0; iter < 2000; iter++) {
    const hit = overlaps(boxes, x, y, width, height, padding);

    if (!hit) {
      return { x, y };
    }

    x = hit.right + padding;
    rowBottom = Math.max(rowBottom, hit.bottom);

    if (x + width > startX + rowWidth) {
      x = startX;
      y = rowBottom + padding;
      rowBottom = y + height;
    }
  }

  // Safety fallback: place below all existing content
  const allBoxes = getBoundingBoxes(shapes);
  const maxBottom = allBoxes.length ? Math.max(...allBoxes.map((b) => b.bottom)) : startY;
  return { x: startX, y: maxBottom + padding };
}

// ─── Paper interface ──────────────────────────────────────────────────────────

/**
 * Get a read/write interface for a Paper document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url  - Automerge URL of the PaperDoc
 */
export function getPaper(repo, url) {
  const handle = repo.find(url);

  async function currentDoc() {
    await handle.whenReady();
    return handle.doc();
  }

  return {
    /**
     * Return all shapes on the paper canvas as an array.
     */
    async getShapes() {
      const doc = await currentDoc();
      return Object.values(doc?.shapes ?? {});
    },

    /**
     * Place an embed (a linked Patchwork document) on the canvas.
     *
     * Smart placement: the position is found automatically using
     * `findFreePosition` unless explicit `x`/`y` are provided.
     *
     * @param {string} docUrl   - Automerge URL of the document to embed
     * @param {string} docType  - Patchwork datatype id (e.g. 'markdown', 'datalog')
     * @param {object} [opts]
     * @param {number} [opts.width=480]
     * @param {number} [opts.height=320]
     * @param {number} [opts.x]        - Override x (skips smart placement)
     * @param {number} [opts.y]        - Override y (skips smart placement)
     * @param {string} [opts.toolId]   - Specific tool ID to use for rendering
     * @param {string} [opts.toolUrl]  - Tool URL for custom tool rendering
     * @param {number} [opts.startX=0]
     * @param {number} [opts.startY=0]
     * @param {number} [opts.padding=24]
     * @returns {string} The new shape ID
     */
    async placeEmbed(docUrl, docType, opts = {}) {
      const doc = await currentDoc();
      const { width = 480, height = 320, toolId, toolUrl, padding = 24, startX = 0, startY = 0 } = opts;

      const { x, y } = (opts.x != null && opts.y != null)
        ? { x: opts.x, y: opts.y }
        : findFreePosition(doc.shapes, width, height, { startX, startY, padding });

      const id = newId();
      handle.change((d) => {
        const shape = { id, type: 'embed', x, y, width, height, zIndex: nextZIndex(d), docUrl, docType };
        if (toolId) shape.toolId = toolId;
        if (toolUrl) shape.toolUrl = toolUrl;
        d.shapes[id] = shape;
      });
      return id;
    },

    /**
     * Place multiple embeds at once, packing them into rows automatically.
     *
     * @param {Array<{ docUrl: string, docType: string, width?: number, height?: number, toolId?: string }>} items
     * @param {object} [opts]
     * @param {number} [opts.startX=0]
     * @param {number} [opts.startY=0]
     * @param {number} [opts.padding=24]
     * @returns {string[]} Array of new shape IDs
     */
    async placeEmbeds(items, opts = {}) {
      const doc = await currentDoc();
      const { startX = 0, startY = 0, padding = 24 } = opts;
      const ids = [];

      const workingShapes = { ...doc.shapes };

      for (const item of items) {
        const width = item.width ?? 480;
        const height = item.height ?? 320;
        const { x, y } = findFreePosition(workingShapes, width, height, { startX, startY, padding });

        const id = newId();
        const shape = {
          id,
          type: 'embed',
          x,
          y,
          width,
          height,
          zIndex: Object.keys(workingShapes).length + 1,
          docUrl: item.docUrl,
          docType: item.docType,
        };
        if (item.toolId) shape.toolId = item.toolId;
        if (item.toolUrl) shape.toolUrl = item.toolUrl;

        workingShapes[id] = shape;
        ids.push(id);
      }

      handle.change((d) => {
        const base = nextZIndex(d) - 1;
        for (let i = 0; i < ids.length; i++) {
          const s = workingShapes[ids[i]];
          d.shapes[ids[i]] = { ...s, zIndex: base + i + 1 };
        }
      });

      return ids;
    },

    /**
     * Place a text label on the canvas.
     *
     * @param {string} text
     * @param {object} [opts]
     * @param {number} [opts.x]
     * @param {number} [opts.y]
     * @param {string} [opts.color='#1a1a1a']
     * @param {number} [opts.fontSize=18]
     * @param {number} [opts.startX=0]
     * @param {number} [opts.startY=0]
     * @param {number} [opts.padding=24]
     * @returns {string} The new shape ID
     */
    async placeText(text, opts = {}) {
      const doc = await currentDoc();
      const { color = '#1a1a1a', fontSize = 18, padding = 24, startX = 0, startY = 0 } = opts;

      const estimatedW = Math.min(text.length * (fontSize * 0.6), 600);
      const estimatedH = fontSize * 1.6;

      const { x, y } = (opts.x != null && opts.y != null)
        ? { x: opts.x, y: opts.y }
        : findFreePosition(doc.shapes, estimatedW, estimatedH, { startX, startY, padding });

      const id = newId();
      handle.change((d) => {
        d.shapes[id] = { id, type: 'text', x, y, zIndex: nextZIndex(d), text, color, fontSize };
      });
      return id;
    },

    /**
     * Place a rectangle on the canvas.
     *
     * Note: paper rectangles use `w`/`h` (not `width`/`height`).
     *
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {object} [opts]
     * @param {number} [opts.x]
     * @param {number} [opts.y]
     * @param {string} [opts.fill='#e2e8f0']
     * @param {string} [opts.stroke='#475569']
     * @param {number} [opts.strokeWidth=2]
     * @param {number} [opts.startX=0]
     * @param {number} [opts.startY=0]
     * @param {number} [opts.padding=24]
     * @returns {string} The new shape ID
     */
    async placeRectangle(w, h, opts = {}) {
      const doc = await currentDoc();
      const {
        fill = '#e2e8f0',
        stroke = '#475569',
        strokeWidth = 2,
        padding = 24,
        startX = 0,
        startY = 0,
      } = opts;

      const { x, y } = (opts.x != null && opts.y != null)
        ? { x: opts.x, y: opts.y }
        : findFreePosition(doc.shapes, w, h, { startX, startY, padding });

      const id = newId();
      handle.change((d) => {
        d.shapes[id] = { id, type: 'rectangle', x, y, w, h, fill, stroke, strokeWidth, zIndex: nextZIndex(d) };
      });
      return id;
    },

    /**
     * Remove a shape by ID.
     */
    async removeShape(shapeId) {
      handle.change((d) => {
        delete d.shapes[shapeId];
      });
    },

    /**
     * Move a shape to an absolute position.
     */
    async moveShape(shapeId, x, y) {
      handle.change((d) => {
        if (d.shapes[shapeId]) {
          d.shapes[shapeId].x = x;
          d.shapes[shapeId].y = y;
        }
      });
    },

    /**
     * Update any fields of an existing shape.
     *
     * @param {string} shapeId
     * @param {object} fields - Fields to merge into the shape (e.g. { fill, stroke, text })
     */
    async updateShape(shapeId, fields) {
      handle.change((d) => {
        const s = d.shapes[shapeId];
        if (!s) return;
        for (const [k, v] of Object.entries(fields)) {
          s[k] = v;
        }
      });
    },
  };
}
