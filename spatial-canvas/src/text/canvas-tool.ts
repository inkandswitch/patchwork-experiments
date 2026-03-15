import * as Automerge from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { TextShape } from "./text.js";
import { deleteShapes } from "../canvas/commands.js";

export const FONT_FAMILY = "'Cutive Mono', 'Courier New', Courier, monospace";
export const DEFAULT_FONT_SIZE = 18;

const supportsFieldSizing = CSS.supports("field-sizing", "content");

let fontInjected = false;
function ensureFont() {
  if (fontInjected) return;
  fontInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap";
  document.head.appendChild(link);
}

/**
 * canvas-text — renders the editable textarea for a text shape.
 *
 * Layout (position, zIndex) is applied by <patchwork-ref-view>. This tool
 * renders and manages the textarea (and optional mirror span for sizing).
 */
export default function CanvasTextTool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
): Disposer {
  ensureFont();
  const shapeId = element.dataset.shapeId ?? "";

  const size = DEFAULT_FONT_SIZE;
  const color = "#1a1a1a";

  const textarea = document.createElement("textarea");
  textarea.spellcheck = false;
  textarea.rows = 1;
  textarea.dataset.shapeId = shapeId;

  const baseStyles = [
    "position:absolute",
    "top:0",
    "left:0",
    "resize:none",
    "overflow:hidden",
    "border:none",
    "outline:none",
    "background:transparent",
    "padding:0",
    "margin:0",
    "white-space:pre",
    "cursor:text",
    "line-height:1.4",
    `font-family:${FONT_FAMILY}`,
    `font-size:${size}px`,
    `color:${color}`,
  ];
  if (supportsFieldSizing) baseStyles.push("field-sizing:content");
  textarea.style.cssText = baseStyles.join(";");

  let mirror: HTMLSpanElement | null = null;
  let resize: () => void;

  if (supportsFieldSizing) {
    resize = () => {};
  } else {
    mirror = document.createElement("span");
    mirror.style.cssText = [
      "position:absolute",
      "visibility:hidden",
      "pointer-events:none",
      "white-space:pre",
      "top:0",
      "left:0",
      "line-height:1.4",
      `font-family:${FONT_FAMILY}`,
      `font-size:${size}px`,
    ].join(";");
    element.appendChild(mirror);

    resize = () => {
      const val = textarea.value;
      mirror!.textContent = val.endsWith("\n") ? val + " " : val || " ";
      textarea.style.width = mirror!.offsetWidth + "px";
      textarea.style.height = mirror!.offsetHeight + "px";
    };
  }

  element.appendChild(textarea);

  textarea.addEventListener("pointerdown", (e) => e.stopPropagation());

  textarea.addEventListener("input", () => {
    resize();
    handle.change((d) => {
      Automerge.updateText(
        d as Automerge.Doc<unknown>,
        ["shapes", shapeId, "text"],
        textarea.value,
      );
    });
  });

  textarea.addEventListener("blur", () => {
    if (!textarea.value.trim()) deleteShapes(handle, [shapeId]);
  });

  textarea.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") textarea.blur();
  });

  function applyShape(shape: TextShape) {
    const sz = shape.fontSize ?? DEFAULT_FONT_SIZE;
    const col = shape.color ?? "#1a1a1a";
    textarea.style.fontSize = `${sz}px`;
    textarea.style.color = col;
    if (mirror) mirror.style.fontSize = `${sz}px`;
  }

  function render({ doc }: { doc: CanvasDoc }) {
    const shape = doc.shapes[shapeId] as TextShape | undefined;
    if (!shape) return;

    applyShape(shape);

    if (document.activeElement !== textarea) {
      const newValue = shape.text ?? "";
      if (textarea.value !== newValue) {
        textarea.value = newValue;
        resize();
      }
    }
  }

  // Seed initial value
  const initial = handle.doc();
  if (initial) {
    const shape = initial.shapes[shapeId] as TextShape | undefined;
    if (shape) {
      applyShape(shape);
      textarea.value = shape.text ?? "";
      resize();
      if (!shape.text) requestAnimationFrame(() => textarea.focus());
    }
  }

  handle.on("change", render);

  return () => {
    handle.off("change", render);
    textarea.remove();
    mirror?.remove();
  };
}
