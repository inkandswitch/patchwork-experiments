/**
 * Canvas skill — place and manage items on a spatial canvas document.
 *
 * CanvasDoc shape:
 *   { shapes: Record<string, CanvasShape> }
 *
 * CanvasShape base: { id, x, y, zIndex, type }
 * EmbedShape:  { ...base, type: 'embed', docUrl, docType, toolId, width, height }
 * TextShape:   { ...base, type: 'text', text, color?, fontSize? }
 * RectShape:   { ...base, type: 'rectangle', width, height, color?, fill? }
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
 * Text and pen shapes are excluded (no stable width/height).
 */
function getBoundingBoxes(shapes) {
  return Object.values(shapes)
    .filter((s) => typeof s.width === 'number' && typeof s.height === 'number')
    .map((s) => ({ x: s.x, y: s.y, right: s.x + s.width, bottom: s.y + s.height }));
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
  let rowBottom = startY + height;  // track the tallest item in the current row

  for (let iter = 0; iter < 2000; iter++) {
    const hit = overlaps(boxes, x, y, width, height, padding);

    if (!hit) {
      return { x, y };
    }

    // Jump past the blocking shape horizontally
    x = hit.right + padding;
    rowBottom = Math.max(rowBottom, hit.bottom);

    // Wrap to next row if we've run out of horizontal space
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

// ─── Canvas interface ─────────────────────────────────────────────────────────

/**
 * Get a read/write interface for a spatial canvas document.
 *
 * @param {object} repo - The automerge Repo (global `repo`)
 * @param {string} url  - Automerge URL of the CanvasDoc
 */
export function getCanvas(repo, url) {
  const handle = repo.find(url);

  async function currentDoc() {
    await handle.whenReady();
    return handle.doc();
  }

  return {
    /**
     * Return all shapes on the canvas as an array.
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
     * @param {string} docType  - Patchwork datatype id (e.g. 'markdown', 'p3net', 'datalog')
     * @param {object} [opts]
     * @param {number} [opts.width=480]
     * @param {number} [opts.height=320]
     * @param {number} [opts.x]       - Override x (skips smart placement)
     * @param {number} [opts.y]       - Override y (skips smart placement)
     * @param {string} [opts.toolId='']
     * @param {number} [opts.startX=0]   - Search start x for smart placement
     * @param {number} [opts.startY=0]   - Search start y for smart placement
     * @param {number} [opts.padding=24] - Minimum gap between items
     * @returns {string} The new shape ID
     */
    async placeEmbed(docUrl, docType, opts = {}) {
      const doc = await currentDoc();
      const { width = 480, height = 320, toolId = '', padding = 24, startX = 0, startY = 0 } = opts;

      const { x, y } = (opts.x != null && opts.y != null)
        ? { x: opts.x, y: opts.y }
        : findFreePosition(doc.shapes, width, height, { startX, startY, padding });

      const id = newId();
      handle.change((d) => {
        d.shapes[id] = {
          id,
          type: 'embed',
          x,
          y,
          width,
          height,
          zIndex: nextZIndex(d),
          docUrl,
          docType,
          toolId,
        };
      });
      return id;
    },

    /**
     * Place multiple embeds at once, packing them into rows automatically.
     *
     * @param {Array<{ docUrl: string, docType: string, width?: number, height?: number }>} items
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

      // Snapshot current shapes so each successive placement sees previously
      // placed items from this batch.
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
          toolId: item.toolId ?? '',
        };

        // Add to working snapshot so the next item avoids this one
        workingShapes[id] = shape;
        ids.push(id);
      }

      // Commit all at once
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
     * @param {string} [opts.color='#000000']
     * @param {number} [opts.fontSize=18]
     * @param {number} [opts.startX=0]
     * @param {number} [opts.startY=0]
     * @param {number} [opts.padding=24]
     * @returns {string} The new shape ID
     */
    async placeText(text, opts = {}) {
      const doc = await currentDoc();
      const { color = '#000000', fontSize = 18, padding = 24, startX = 0, startY = 0 } = opts;

      // Estimate text bounding box (rough: 10px per char, line height ≈ fontSize * 1.4)
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
  };
}
