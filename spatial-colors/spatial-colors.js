/**
 * Spatial Colors — a bundleless demo tool for the spatial host.
 *
 * Subscribes to the host's `spatial:apriltags` provider. Colors are hardcoded by
 * tag id (v1): tag 0 → hue 0 (red), 1 → hue 120 (green), 2 → hue 240 (blue).
 *
 * Behavior by how many recognized tags are visible:
 *   0 tags  → blank.
 *   1 tag   → the whole background fills with that tag's color.
 *   2 tags  → a gradient anchored to each tag's whole footprint: the color is
 *             held SOLID from each tag out to the outer edge of its border ring,
 *             and only the gap between the two borders transitions (HSL shortest
 *             arc). So immediately outside a tag's border you see exactly that
 *             tag's color; the geometric midpoint of the gap is the HSL mix.
 *   3+ tags → fall back to per-tag colored outlines (blending isn't specified).
 *
 * In all cases each tag's quad is filled BLACK (so the projector throws no light
 * on the tag) and framed by a thick colored outline ring. Geometry is computed
 * in true box pixels (via the coordinate-system provider) so the gradient axis
 * projection is Euclidean despite the box's aspect ratio.
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

// Hardcoded tag id -> hue (v1). Pure, fully saturated colors.
const TAG_HUES = { 0: 0, 1: 120, 2: 240 };

function hueForTag(id) {
  const hue = TAG_HUES[id];
  return hue == null ? null : hue;
}

function cssHsl(hue) {
  return `hsl(${((hue % 360) + 360) % 360}, 100%, 50%)`;
}

function colorForTag(id) {
  const hue = hueForTag(id);
  return hue == null ? null : cssHsl(hue);
}

// Interpolate two hues along the SHORTEST arc around the wheel. t in [0,1].
// e.g. 0↔120 at t=0.5 → 60 (yellow); 0↔240 → 300 at t=0.5 (magenta, short way).
function lerpHueShortest(h0, h1, t) {
  let delta = ((h1 - h0 + 540) % 360) - 180; // shortest signed delta in [-180,180]
  return h0 + delta * t;
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
    .spatial-colors svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .spatial-colors polygon.sc-outline {
      fill: none;
      stroke-width: 20px;
      stroke-linejoin: round;
    }
    .spatial-colors polygon.sc-tag-black {
      fill: #000;
      stroke: none;
    }
    .spatial-colors rect.sc-bg {
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

  // A single SVG spanning the whole box, in TRUE PIXEL coordinates (viewBox set
  // from the coordinate-system provider). Working in pixels keeps the gradient
  // geometry Euclidean (the box has a non-square aspect ratio, so a normalized
  // 0..1 space would distort projections onto the A→B axis).
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("preserveAspectRatio", "none");
  root.appendChild(svg);

  let tags = [];
  // Box size in CSS px (from the coordinate-system provider). Fallback keeps the
  // tool usable before the first emission.
  let boxW = 100;
  let boxH = 100;
  // Border ring half-thickness in px — half of the stroke-width so the gradient
  // starts at the OUTER edge of the border ring.
  const BORDER_PX = 20;
  const BORDER_HALF = BORDER_PX / 2;

  function syncViewBox() {
    svg.setAttribute("viewBox", `0 0 ${boxW} ${boxH}`);
  }

  // Tag corners as pixel points {x,y}.
  function cornerPx(tag) {
    const corners = Array.isArray(tag.corners) ? tag.corners : [];
    if (corners.length < 3) return null;
    return corners.map((c) => ({ x: c.nx * boxW, y: c.ny * boxH }));
  }

  function pointsAttr(pts) {
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
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

  // Project a point onto the A→B axis, returning the signed distance from A in
  // px (0 at A's center, |B−A| at B's center).
  function projectOnAxis(p, a, ux, uy) {
    return (p.x - a.x) * ux + (p.y - a.y) * uy;
  }

  // Build the gradient between two tags' anchor regions. The color is held
  // SOLID from each tag out to the near edge of its border ring; only the gap
  // between the two borders transitions (HSL shortest arc). userSpaceOnUse in
  // pixel coords so projection is Euclidean.
  function makeGradientDef(aCenter, bCenter, aCorners, bCorners, hueA, hueB) {
    const dx = bCenter.x - aCenter.x;
    const dy = bCenter.y - aCenter.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;

    // Far reach of A toward B = max projection of A's (border-expanded) corners.
    const aReach =
      Math.max(...aCorners.map((p) => projectOnAxis(p, aCenter, ux, uy))) +
      BORDER_HALF;
    // Near reach of B (toward A) = min projection of B's corners, minus border.
    const bReach =
      L +
      Math.min(...bCorners.map((p) => projectOnAxis(p, bCenter, ux, uy))) -
      BORDER_HALF;

    // Offsets along the gradient vector (0 at A center, 1 at B center).
    let aEnd = aReach / L;
    let bStart = bReach / L;
    // Guard against overlap/degenerate ordering.
    if (bStart <= aEnd) {
      const mid = (aEnd + bStart) / 2;
      aEnd = bStart = Math.min(Math.max(mid, 0), 1);
    }
    aEnd = Math.min(Math.max(aEnd, 0), 1);
    bStart = Math.min(Math.max(bStart, 0), 1);

    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.setAttribute("id", "sc-grad");
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", String(aCenter.x));
    grad.setAttribute("y1", String(aCenter.y));
    grad.setAttribute("x2", String(bCenter.x));
    grad.setAttribute("y2", String(bCenter.y));
    grad.setAttribute("spreadMethod", "pad");

    const addStop = (offset, hue) => {
      const stop = document.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", `${offset * 100}%`);
      stop.setAttribute("stop-color", cssHsl(hue));
      grad.appendChild(stop);
    };

    // Solid A up to its border edge.
    addStop(0, hueA);
    addStop(aEnd, hueA);
    // HSL transition across the gap (sampled so it follows HSL, not sRGB).
    const STEPS = 10;
    for (let i = 1; i < STEPS; i++) {
      const t = i / STEPS;
      addStop(aEnd + (bStart - aEnd) * t, lerpHueShortest(hueA, hueB, t));
    }
    // Solid B from its border edge onward.
    addStop(bStart, hueB);
    addStop(1, hueB);
    return grad;
  }

  function center(tag) {
    return { x: tag.nx * boxW, y: tag.ny * boxH };
  }

  function render() {
    svg.replaceChildren();
    syncViewBox();

    // Recognized tags only (those with a hardcoded color), each with a usable quad.
    const colored = tags
      .map((tag) => ({ tag, hue: hueForTag(tag.id), corners: cornerPx(tag) }))
      .filter((t) => t.hue != null && t.corners);

    // --- Background: solid (1 tag) or gradient (2 tags) ---
    if (colored.length === 1) {
      const rect = bgRect();
      rect.setAttribute("fill", cssHsl(colored[0].hue));
      svg.appendChild(rect);
    } else if (colored.length === 2) {
      const [a, b] = colored;
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.appendChild(
        makeGradientDef(
          center(a.tag),
          center(b.tag),
          a.corners,
          b.corners,
          a.hue,
          b.hue,
        ),
      );
      svg.appendChild(defs);
      const rect = bgRect();
      rect.setAttribute("fill", "url(#sc-grad)");
      svg.appendChild(rect);
    }
    // 0 tags → blank; 3+ → no background (outlines only, below).

    // --- Black tag quads (mask the tag so nothing is projected onto it) ---
    for (const { corners } of colored) {
      svg.appendChild(makeBlackTag(corners));
    }

    // --- Colored outline rings around each tag ---
    for (const { corners, hue } of colored) {
      svg.appendChild(makeOutline(corners, cssHsl(hue)));
    }
  }

  function bgRect() {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "sc-bg");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(boxW));
    rect.setAttribute("height", String(boxH));
    return rect;
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
