/**
 * Spatial Colors — a bundleless demo tool for the spatial host.
 *
 * Subscribes to the host's `spatial:apriltags` provider. Colors are hardcoded by
 * tag id (v1): tag 0 → red, 1 → green, 2 → blue.
 *
 * Background = an inverse-distance-weighted RGB blend, but each tag acts as an
 * opaque WALL (its quad + border ring) that blocks the light from other tags:
 *   - at each pixel, a tag contributes to the blend only if it has clear
 *     line-of-sight (the segment pixel→tag doesn't cross another tag's blocker),
 *   - weight_i = 1 / dist_i^POWER over the visible tags, normalized so the
 *     nearest visible tag = 1, scaled by GAIN, then colors are ADDED (light
 *     mixing) and clamped: a lone tag → its pure color; red+green → yellow; all
 *     three → white (not the muddy grey a weighted average would give),
 *   - so behind each tag lies a hard-edged shadow cone where that blocker's tag
 *     is removed from the blend → the cone reads as the blocker's own color.
 *   2 tags → one cone of solid color behind each; 3 tags → two (overlapping)
 *   cones per tag. 0 tags → blank; 1 tag → solid fill.
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
const POWER = 0.5;
// Brightness applied to the additive color sum before clamping. >1 saturates to
// white sooner (punchier mixes); <1 keeps mixes dimmer / delays the blowout.
const GAIN = 1;
// Longest edge (px) of the offscreen field; scaled up smoothly to the box.
const FIELD_MAX = 512;
// Border ring thickness (px). Half is used to size the colored outline.
const BORDER_PX = 20;

// ---------------------------------------------------------------------------
// Geometry helpers for the occlusion model.
// ---------------------------------------------------------------------------

// Orientation-based segment intersection test (segments p1p2 and p3p4).
function segmentsIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const d = (ax, ay, bx, by, cx, cy) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(p3x, p3y, p4x, p4y, p1x, p1y);
  const d2 = d(p3x, p3y, p4x, p4y, p2x, p2y);
  const d3 = d(p1x, p1y, p2x, p2y, p3x, p3y);
  const d4 = d(p1x, p1y, p2x, p2y, p4x, p4y);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

// Does segment a→b cross any edge of polygon `poly` (array of {x,y})?
function segmentCrossesPolygon(ax, ay, bx, by, poly) {
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i];
    const d = poly[(i + 1) % poly.length];
    if (segmentsIntersect(ax, ay, bx, by, c.x, c.y, d.x, d.y)) return true;
  }
  return false;
}

// Expand a convex polygon outward from its centroid by `pad` px. Used to grow
// each tag's quad by the border ring so the border is part of the blocker.
function expandPolygon(poly, pad) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * pad, y: p.y + (dy / len) * pad };
  });
}

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
    const fw = Math.max(
      1,
      Math.round(boxW >= boxH ? FIELD_MAX : FIELD_MAX / aspect),
    );
    const fh = Math.max(
      1,
      Math.round(boxW >= boxH ? FIELD_MAX * aspect : FIELD_MAX),
    );
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

    // Per-anchor: center + color + its blocker polygon (quad grown by the
    // border ring), all in field-pixel space. The blocker is treated as an
    // opaque wall: a tag only lights a pixel with clear line-of-sight to it.
    const sx = fw / boxW;
    const sy = fh / boxH;
    const pts = anchors.map((a) => ({
      x: a.cx * sx,
      y: a.cy * sy,
      rgb: a.rgb,
      blocker: expandPolygon(a.corners, BORDER_PX / 2).map((p) => ({
        x: p.x * sx,
        y: p.y * sy,
      })),
    }));

    const img = fieldCtx.createImageData(fw, fh);
    const data = img.data;
    const EPS = 1e-6;
    const weights = new Array(pts.length).fill(0); // per-pixel scratch
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let snapped = null;
        // Collect visible (line-of-sight) tags' weights for this pixel.
        let maxW = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const dx = px - p.x;
          const dy = py - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < EPS) {
            snapped = p.rgb; // exactly on a tag
            break;
          }
          let blocked = false;
          for (let j = 0; j < pts.length; j++) {
            if (j === i) continue;
            if (segmentCrossesPolygon(px, py, p.x, p.y, pts[j].blocker)) {
              blocked = true;
              break;
            }
          }
          if (blocked) {
            weights[i] = 0;
            continue;
          }
          const w = 1 / Math.pow(d2, POWER / 2);
          weights[i] = w;
          if (w > maxW) maxW = w;
        }

        const idx = (y * fw + x) * 4;
        if (snapped) {
          data[idx] = snapped[0];
          data[idx + 1] = snapped[1];
          data[idx + 2] = snapped[2];
        } else if (maxW > 0) {
          // ADDITIVE (light) mixing: normalize weights so the nearest visible
          // tag has weight 1, then SUM the colors and clamp to 255. A lone
          // visible tag → its pure full-brightness color; comparably-close tags
          // ADD (red+green→yellow, all three→white) instead of averaging to mud.
          let r = 0;
          let g = 0;
          let b = 0;
          for (let i = 0; i < pts.length; i++) {
            const w = weights[i] / maxW;
            if (!w) continue;
            r += w * pts[i].rgb[0];
            g += w * pts[i].rgb[1];
            b += w * pts[i].rgb[2];
          }
          r *= GAIN;
          g *= GAIN;
          b *= GAIN;
          data[idx] = r > 255 ? 255 : r;
          data[idx + 1] = g > 255 ? 255 : g;
          data[idx + 2] = b > 255 ? 255 : b;
        } else {
          // Fully occluded from every tag (rare) → black.
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
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

    // Anchor = each tag's center + color + quad (px), for the blend field.
    const anchors = colored.map(({ tag, rgb, corners }) => ({
      cx: tag.nx * boxW,
      cy: tag.ny * boxH,
      rgb,
      corners,
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
