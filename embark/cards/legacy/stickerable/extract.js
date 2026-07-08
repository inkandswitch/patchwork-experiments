// Extract the *visible* text of a DOM subtree — innerText-ish: rendered text
// with line breaks at block boundaries, collapsed whitespace, and hidden /
// machinery nodes (script, CodeMirror gutters, other stickers' chips) skipped —
// while recording, for every character offset, the source text node + offset it
// came from. That map lets a sticker that targets a `[from, to)` range in the
// extracted text be turned back into a live DOM `Range` without ever mutating
// the DOM.
//
// We build the string ourselves rather than reading `element.innerText` so the
// offset map is exact by construction: each emitted character is recorded
// against the node position it was copied from (a collapsed whitespace run maps
// to its first source character; synthetic block line breaks map to nothing and
// are snapped to the nearest real boundary on lookup).

/**
 * @typedef {{
 *   text: string,
 *   rangeFor: (from: number, to: number) => Range | null,
 * }} TextExtract
 *   The extracted text and a builder for a DOM Range spanning the extracted
 *   `[from, to)` offsets (null when the offsets can't be mapped to live nodes).
 */

// Tags whose text is machinery, not content.
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

// Class fragments marking rendered chrome we must not fold into the text: editor
// gutters/line numbers, and stickers already painted by other renderers (ours
// or CodeMirror's) — otherwise their text would shift every offset after them.
const SKIP_CLASS_FRAGMENTS = ["cm-gutter", "cm-sticker", "stickerable-"];

// Block-level tags that introduce a line break around their content, the way
// innerText does. `BR` is handled explicitly.
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "DL", "DD",
  "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
  "SECTION", "TABLE", "TR", "UL",
]);

/**
 * @param {Element} root
 * @returns {TextExtract}
 */
export function extractText(root) {
  let text = "";
  // `boundaries[i]` is the DOM position (`{ node, off }`) at content offset `i`
  // (for `i` in `0..text.length`). Synthetic positions (block line breaks) are
  // left undefined and snapped to the nearest real boundary on lookup.
  const boundaries = [];
  let pendingBreak = false;

  const requestBreak = () => {
    if (text.length > 0) pendingBreak = true;
  };

  const flushBreak = () => {
    if (!pendingBreak) return;
    pendingBreak = false;
    if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  };

  const emit = (chunk, node, nodeStart) => {
    flushBreak();
    for (let i = 0; i < chunk.length; i++) {
      boundaries[text.length + i] = { node, off: nodeStart + i };
    }
    text += chunk;
  };

  const walkText = (node) => {
    const data = node.data;
    let i = 0;
    while (i < data.length) {
      if (isWhitespace(data[i])) {
        let j = i + 1;
        while (j < data.length && isWhitespace(data[j])) j++;
        // Collapse the run to a single space, but never as leading whitespace
        // (at the start, just after a line break, or doubling an existing space).
        if (text.length > 0 && !pendingBreak && !text.endsWith(" ")) {
          emit(" ", node, i);
        }
        i = j;
      } else {
        let j = i + 1;
        while (j < data.length && !isWhitespace(data[j])) j++;
        emit(data.slice(i, j), node, i);
        i = j;
      }
    }
  };

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      walkText(node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    if (SKIP_TAGS.has(el.tagName) || isSkippedChrome(el) || isHidden(el)) return;
    if (el.tagName === "BR") {
      requestBreak();
      return;
    }
    const block = BLOCK_TAGS.has(el.tagName);
    if (block) requestBreak();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) requestBreak();
  };

  walk(root);

  const rangeFor = (from, to) => {
    const start = nearest(boundaries, from, "back") ?? nearest(boundaries, from, "fwd");
    const end = nearest(boundaries, to, "back") ?? nearest(boundaries, to, "fwd");
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start.node, clampOff(start));
      range.setEnd(end.node, clampOff(end));
      return range;
    } catch {
      return null;
    }
  };

  return { text, rangeFor };
}

// Find the nearest defined boundary at or scanning away from `index`, searching
// backward first (so a range endpoint prefers the position just before it) or
// forward, depending on `dir`.
function nearest(boundaries, index, dir) {
  const max = boundaries.length - 1;
  if (dir === "back") {
    for (let k = Math.min(index, max); k >= 0; k--) {
      if (boundaries[k]) return boundaries[k];
    }
    return undefined;
  }
  for (let k = Math.max(index, 0); k <= max; k++) {
    if (boundaries[k]) return boundaries[k];
  }
  return undefined;
}

// The recorded offset can land past the node's current length if the DOM moved
// between extraction and lookup; clamp so `Range` construction never throws.
function clampOff(pos) {
  return Math.min(pos.off, pos.node.data.length);
}

function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isSkippedChrome(el) {
  if (el.getAttribute("aria-hidden") === "true") return true;
  for (const cls of el.classList) {
    for (const fragment of SKIP_CLASS_FRAGMENTS) {
      if (cls.includes(fragment)) return true;
    }
  }
  return false;
}

function isHidden(el) {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  const style = getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}
