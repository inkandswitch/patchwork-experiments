// The `sticker` context view: one sticker drawn as it appears in the document
// (mirroring the CodeMirror widgets in ./renderer.js and TodoTool's
// stickerNode): `text` as a chip, `tool` as an embedded view, `style` as a
// small swatch (it normally decorates a text range, so standalone we show
// sample glyphs carrying its styles).
//
// Loaded lazily through this package's `sticker-context-view` plugin.

import { render } from "solid-js/web";
import html from "solid-js/html";

/** @type {(element: HTMLElement, value: unknown) => () => void} */
export const stickerView = (element, value) => {
  injectStyles();
  return render(
    () =>
      html`<span class="embark-sticker-view">${() => stickerChip(value)}</span>`,
    element,
  );
};

function stickerChip(sticker) {
  if (sticker.type === "text") {
    const chip = document.createElement("span");
    chip.className = "cm-sticker cm-sticker--text";
    chip.textContent = sticker.text;
    if (sticker.styles) chip.style.cssText = cssText(sticker.styles);
    return chip;
  }
  if (sticker.type === "tool") {
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", sticker.docUrl);
    view.setAttribute("tool-id", sticker.toolId);
    const wrap = document.createElement("span");
    wrap.className = "cm-sticker cm-sticker--tool";
    wrap.appendChild(view);
    return wrap;
  }
  const swatch = document.createElement("span");
  swatch.className = "cm-sticker cm-sticker--style";
  swatch.style.cssText = cssText(sticker.styles ?? {});
  swatch.textContent = "Aa";
  return swatch;
}

function cssText(styles) {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

// --- Styles --------------------------------------------------------------------
// The .cm-sticker* rules mirror the renderer's editor stylesheet, scoped under
// .embark-sticker-view so the viewer looks right whether or not that
// (CodeMirror-injected) stylesheet is present on the page.

const STYLE_ID = "embark-sticker-view-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.embark-sticker-view .cm-sticker {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
}

.embark-sticker-view .cm-sticker--text {
  padding: 0 0.35em;
  border-radius: 0.5em;
  font-size: 0.85em;
  line-height: 1.4;
  color: #1f2937;
  background: #e5e7eb;
  white-space: nowrap;
}

.embark-sticker-view .cm-sticker--tool {
  vertical-align: middle;
}

.embark-sticker-view .cm-sticker--tool patchwork-view {
  display: inline-block;
  width: 5.5em;
  height: 1.6em;
  vertical-align: middle;
}

.embark-sticker-view .cm-sticker--style {
  padding: 0 0.35em;
  border-radius: 0.35em;
  font-size: 0.85em;
  line-height: 1.4;
}
`;
