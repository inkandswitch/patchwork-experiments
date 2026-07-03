// THE PARTS BIN — a browsable census of everything placeable, straight from
// the registries — shapes + stamps (the classic drag-outs), palette PRESETS,
// datatypes (new docs), and the `sketchy:window` nodes + `sketchy:lens`
// lenses, grouped exactly like the + add menu (sources · editors · lenses, via
// nodeRole). It ships as a bare `sketchy:window` (mountPartsWindow / `plugin`)
// seeded overlay-only — the bin appears exactly when you switch to the overlay
// to arrange your space. Raw callbacks + DOM — window CONTENT is not canvas
// shell, and only the canvas shell gets Solid (the opstream-processing rule).
//
// DRAG-OUT PROTOCOL: tiles extend the palette's existing `text/x-newspace-tool`
// DnD type with a namespaced part id — `datatype:folder`, `window:codemirror`,
// `lens:uppercase`, `palette:full`/`palette:sketch`, `flap:flap` — while
// tool/shape/stamp ids stay BARE (the palette's own drags are unchanged). The
// canvas's dropToolAt decodes with decodePartId and lands an instance at the
// drop point (createDocAt / placeNode / a preconfigured palette window /
// createFlapAt / the existing shape+stamp drops). A CLICK on a tile arms the
// place flow instead (selectPlacing / placeEditor / placeLens / placeFlap /
// setTool).
//
// SAVING things INTO the bin: the bin ships parked inside the parts FLAP (a
// `flap: true` frame — see canvas.jsx/constants.js), so "save a palette" is the
// ordinary alt-drag copy gesture dropped into the flap: item containment does
// the work. The old ⠿-grip palette-identity / config.customParts protocol is
// gone (old docs may still carry a `customParts` field — never deleted, just no
// longer read or written).
//
// NOT parts: BRUSHES. "Placing" a brush only ARMS it (dropToolAt falls through
// to setTool for a bare brush id) — there's no instance to land on the canvas,
// so brushes stay on the palette, not in the bin.
//
// THE DATA LIVES IN THE CATALOG (catalog.js) — the one census of placeable
// things, shared with the + add menu and the place/arm flows. This module is
// the bin's DOM mounts; the census names are re-exported for existing callers.
import { STAMPS, SHAPE_DRAGGABLE } from "./brush/ui/chrome.jsx";
import {
  PART_DRAG_TYPE, FLAP_PART, PALETTE_PARTS, listPalettes,
  encodePartId, decodePartId, partsCensus, armPart,
  catalogDatatypes, catalogWindows, catalogLenses,
} from "./catalog.js";
export { PART_DRAG_TYPE, FLAP_PART, PALETTE_PARTS, listPalettes, encodePartId, decodePartId, partsCensus, armPart };

// ── the flap mount (raw DOM) ─────────────────────────────────────────────────
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// a tile's icon: the stamp's real strokes / a TOOL_META path / the group mark
function tileIcon(t) {
  if (t.stamp && t.stamp.paths) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", t.stamp.view || "0 0 24 24");
    svg.setAttribute("class", "ns-part-glyph");
    for (const d of t.stamp.paths) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d); p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "3");
      p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
      svg.append(p);
    }
    return svg;
  }
  if (t.path) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 22 22");
    svg.setAttribute("class", "ns-part-glyph");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", t.path); p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.8");
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
    return svg;
  }
  return el("span", "ns-part-glyph ns-part-mark", t.mark || "•");
}

function tileEl(t, host) {
  const b = el("button", "ns-part");
  b.draggable = true;
  b.dataset.part = t.part;
  const dragOnly = t.kind === "stamp" || t.kind === "palette"; // instances only land by drag
  b.title = `${t.name} — drag to canvas${dragOnly ? "" : " · click to place"}`;
  b.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData(PART_DRAG_TYPE, t.part);
    e.dataTransfer.effectAllowed = "copy";
  });
  b.addEventListener("click", () => armPart(t, host));
  b.append(tileIcon(t), el("span", "ns-part-name", t.name));
  return b;
}

// build the bin into `element` from a host's registry accessors; shared by the
// legacy host mount (mountPartsBin, kept for direct embedding/tests) and the
// sketchy:window mount below.
function buildBin(element, host, cls) {
  const root = el("div", cls);
  const render = () => {
    root.replaceChildren();
    const groups = partsCensus({
      datatypes: (host && host.datatypes && host.datatypes()) || [],
      windows: (host && host.editors && host.editors()) || [],
      lenses: (host && host.lenses && host.lenses()) || [],
      stamps: STAMPS,
      shapes: [...SHAPE_DRAGGABLE],
      palettes: listPalettes(),
      flap: true,
    });
    for (const g of groups) {
      root.append(el("div", "ns-menu-sep", g.label));
      const grid = el("div", "ns-parts-grid");
      for (const t of g.tiles) grid.append(tileEl(t, host));
      root.append(grid);
    }
  };
  render();
  element.append(root);
  const cleanup = () => root.remove();
  cleanup.root = root;
  return cleanup;
}

// direct mount: `({ element, host }) => cleanup`, `host` = a chrome-host-shaped
// bag (registry accessors + place commands).
export function mountPartsBin({ element, host }) {
  return buildBin(element, host, "ns-partsbin");
}

// the `sketchy:window` mount — the bin as a bare window item (shipped parked
// inside the parts FLAP). A window mount doesn't receive the chrome host, so
// the registries are read directly and the only click-arm that works is a
// tool/shape (via the context tool Source); datatype/window/lens/palette/flap
// tiles are drag-out (dropToolAt lands them all). Saving things into the bin is
// item containment now: alt-drag a copy and drop it into the flap.
export function mountPartsWindow({ element, context }) {
  const host = {
    datatypes: catalogDatatypes,
    editors: catalogWindows,
    lenses: catalogLenses,
    setTool: (id) => { const t = context && context.tool; if (t && typeof t.set === "function") t.set(id); },
  };
  const stop = (e) => e.stopPropagation(); // pointerDOWN only (the house rule): keep marquee/draw off the bin body
  element.addEventListener("pointerdown", stop);
  const un = buildBin(element, host, "ns-partsbin ns-parts-window");
  return () => { element.removeEventListener("pointerdown", stop); un(); };
}

export const plugin = {
  type: "sketchy:window",
  id: "parts",
  name: "Parts",
  icon: "Shapes",
  bare: true, // an overlay widget: no node frame; chrome comes from the bare-chrome bar
  inlets: [],
  outlets: [],
  async load() { return mountPartsWindow; },
};
