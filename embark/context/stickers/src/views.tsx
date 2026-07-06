import type { JSX } from "solid-js";
import { solidView } from "@embark/context";
import type { Sticker } from "./sticker";
import "./views.css";

// The `sticker` context view: one sticker drawn as it appears in the document
// (mirroring the CodeMirror widgets in this package and TodoTool's
// stickerNode): `text` as a chip, `tool` as an embedded view, `style` as a
// small swatch (it normally decorates a text range, so standalone we show
// sample glyphs carrying its styles).
export const stickerView = solidView((props) => (
  <span class="embark-sticker-view">{stickerChip(props.value as Sticker)}</span>
));

function stickerChip(sticker: Sticker): JSX.Element {
  if (sticker.type === "text") {
    return (
      <span
        class="cm-sticker cm-sticker--text"
        style={sticker.styles ? cssText(sticker.styles) : undefined}
      >
        {sticker.text}
      </span>
    );
  }
  if (sticker.type === "tool") {
    // Built imperatively: <patchwork-view> is a light-DOM custom element, not a
    // declared JSX intrinsic. Solid inserts DOM nodes as children verbatim.
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", sticker.docUrl);
    view.setAttribute("tool-id", sticker.toolId);
    return <span class="cm-sticker cm-sticker--tool">{view}</span>;
  }
  return (
    <span class="cm-sticker cm-sticker--style" style={cssText(sticker.styles)}>
      Aa
    </span>
  );
}

function cssText(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}
