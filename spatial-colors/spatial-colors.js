/**
 * Spatial Colors — a bundleless demo tool for the spatial host.
 *
 * Subscribes to the host's `spatial:apriltags` provider. Colors are hardcoded by
 * tag id (v1): tag 0 → red, 1 → green, 2 → blue.
 *
 * Background = an inverse-distance-weighted RGB blend of every recognized tag's
 * color (one unified model for any tag count):
 *   weight_i = 1 / dist_i^POWER   →   color = Σ wᵢ·cᵢ / Σ wᵢ
 *   - exact at each tag (weight → ∞ there),
 *   - at a point equidistant from all tags (e.g. the centroid of a symmetric
 *     layout) it's the equal RGB mix of all of them — red+green+blue → white,
 *   - smooth everywhere, defined over the whole box.
 *   0 tags → blank; 1 tag → solid fill.
 *
 * The field is computed on a small offscreen canvas (~FIELD_MAX px longest edge)
 * and scaled up smoothly. Each tag's quad is then masked BLACK (projector throws
 * no light on the tag) and framed by a thick colored outline ring, drawn in an
 * SVG overlay on top. Geometry is in true box pixels (coordinate-system provider)
 * so distances are Euclidean despite the box's aspect ratio.
 *
 * @typedef {Object} SpatialColorsDoc
 * @property {string} title
 */

// ---------------------------------------------------------------------------
// Inlined patchwork-providers `subscribe` (v0.2.x) — dependency-free DOM +
// MessageChannel code, copied so this stays a bundleless single-file tool.
// ---------------------------------------------------------------------------
function subscribe(element, selector, listener) {
  const view = element.closest("patchwork-view");
  const dispatchEl = view ?? element;
  const channel = new MessageChannel();
  const port = channel.port2;
  const controller = new AbortController();
  port.addEventListener(
    "message",
    (event) => {
      if (event.data?.type === "change") listener(event.data.value);
    },
    { signal: controller.signal },
  );
  port.start();
  dispatchEl.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    }),
  );
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    port.postMessage({ type: "unsubscribe" });
    port.close();
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Hardcoded tag id -> RGB (v1). Pure, fully saturated colors.
const TAG_RGB = {
  0: [255, 0, 0], // red
  1: [0, 255, 0], // green
  2: [0, 0, 255], // blue
};

function rgbForTag(id) {
  return TAG_RGB[id] ?? null;
}

function cssRgb([r, g, b]) {
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

// Inverse-distance falloff power. Higher = tighter color zones near each tag.
const POWER = 2;
// Longest edge (px) of the offscreen field; scaled up smoothly to the box.
const FIELD_MAX = 64;
// Border ring thickness (px). Half is used to size the colored outline.
const BORDER_PX = 20;

// ---------------------------------------------------------------------------
// Datatype
// ---------------------------------------------------------------------------
export const SpatialColorsDatatype = {
  init(doc) {
    doc.title = "Spatial Colors";
  },
  getTitle(doc) {
    return doc.title || "Spatial Colors";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .spatial-colors {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: transparent;
    }
    .spatial-colors canvas.sc-field {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      image-rendering: auto;
    }
    .spatial-colors svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .spatial-colors polygon.sc-outline {
      fill: none;
      stroke-width: ${BORDER_PX}px;
      stroke-linejoin: round;
    }
    .spatial-colors polygon.sc-tag-black {
      fill: #000;
      stroke: none;
    }
  `;
  element.appendChild(style);

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "spatial-colors";
  element.appendChild(root);

  // Background blend field (low-res offscreen, displayed scaled-up).
  const fieldCanvas = document.createElement("canvas");
  fieldCanvas.className = "sc-field";
  root.appendChild(fieldCanvas);
  const fieldCtx = fieldCanvas.getContext("2d");

  // SVG overlay for the black tag masks + colored rings.
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("preserveAspectRatio", "none");
  root.appendChild(svg);

  let tags = [];
  let boxW = 100;
  let boxH = 100;

  function syncViewBox() {
    svg.setAttribute("viewBox", `0 0 ${boxW} ${boxH}`);
  }

  function cornerPx(tag) {
    const corners = Array.isArray(tag.corners) ? tag.corners : [];
    if (corners.length < 3) return null;
    return corners.map((c) => ({ x: c.nx * boxW, y: c.ny * boxH }));
  }

  function pointsAttr(pts) {
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  }

  // Compute the inverse-distance-weighted RGB field on the offscreen canvas.
  function drawField(anchors) {
    const aspect = boxH / boxW || 1;
    const fw = Math.max(1, Math.round(boxW >= boxH ? FIELD_MAX : FIELD_MAX / aspect));
    const fh = Math.max(1, Math.round(boxW >= boxH ? FIELD_MAX * aspect : FIELD_MAX));
    if (fieldCanvas.width !== fw) fieldCanvas.width = fw;
    if (fieldCanvas.height !== fh) fieldCanvas.height = fh;
    if (!fieldCtx) return;

    if (!anchors.length) {
      fieldCtx.clearRect(0, 0, fw, fh);
      return;
    }
    if (anchors.length === 1) {
      fieldCtx.fillStyle = cssRgb(anchors[0].rgb);
      fieldCtx.fillRect(0, 0, fw, fh);
      return;
    }

    // Anchor positions in field-pixel space.
    const pts = anchors.map((a) => ({
      x: (a.cx / boxW) * fw,
      y: (a.cy / boxH) * fh,
      rgb: a.rgb,
    }));

    const img = fieldCtx.createImageData(fw, fh);
    const data = img.data;
    const EPS = 1e-6;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        let wsum = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let snapped = null;
        for (const p of pts) {
          const dx = x + 0.5 - p.x;
          const dy = y + 0.5 - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < EPS) {
            snapped = p.rgb; // exactly on a tag
            break;
          }
          const w = 1 / Math.pow(d2, POWER / 2);
          wsum += w;
          r += w * p.rgb[0];
          g += w * p.rgb[1];
          b += w * p.rgb[2];
        }
        const idx = (y * fw + x) * 4;
        if (snapped) {
          data[idx] = snapped[0];
          data[idx + 1] = snapped[1];
          data[idx + 2] = snapped[2];
        } else {
          data[idx] = r / wsum;
          data[idx + 1] = g / wsum;
          data[idx + 2] = b / wsum;
        }
        data[idx + 3] = 255;
      }
    }
    fieldCtx.putImageData(img, 0, 0);
  }

  function makeOutline(pts, color) {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("class", "sc-outline");
    polygon.setAttribute("points", pointsAttr(pts));
    polygon.setAttribute("stroke", color);
    polygon.setAttribute("vector-effect", "non-scaling-stroke");
    return polygon;
  }

  function makeBlackTag(pts) {
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("class", "sc-tag-black");
    polygon.setAttribute("points", pointsAttr(pts));
    return polygon;
  }

  function render() {
    syncViewBox();
    svg.replaceChildren();

    // Recognized tags only (those with a hardcoded color) + a usable quad.
    const colored = tags
      .map((tag) => ({ tag, rgb: rgbForTag(tag.id), corners: cornerPx(tag) }))
      .filter((t) => t.rgb && t.corners);

    // Anchor = each tag's center + color, for the blend field.
    const anchors = colored.map(({ tag, rgb }) => ({
      cx: tag.nx * boxW,
      cy: tag.ny * boxH,
      rgb,
    }));
    drawField(anchors);

    // Black tag masks (no light on the tag).
    for (const { corners } of colored) {
      svg.appendChild(makeBlackTag(corners));
    }
    // Colored outline rings.
    for (const { corners, rgb } of colored) {
      svg.appendChild(makeOutline(corners, cssRgb(rgb)));
    }
  }

  const unsubTags = subscribe(
    element,
    { type: "spatial:apriltags" },
    (value) => {
      tags = (value && value.tags) || [];
      render();
    },
  );

  const unsubCoords = subscribe(
    element,
    { type: "spatial:coordinate-system" },
    (value) => {
      if (value && value.width > 0 && value.height > 0) {
        boxW = value.width;
        boxH = value.height;
        render();
      }
    },
  );

  render();

  return () => {
    unsubTags();
    unsubCoords();
    root.remove();
    style.remove();
    element.style.position = prevPosition;
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "spatial-colors",
    name: "Spatial Colors",
    icon: "Palette",
    async load() {
      return SpatialColorsDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "spatial-colors",
    name: "Spatial Colors",
    icon: "Palette",
    supportedDatatypes: ["spatial-colors"],
    async load() {
      return Tool;
    },
  },
];
