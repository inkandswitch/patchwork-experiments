import { createElement, Type } from "lucide";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { SpatialCanvas } from "../canvas/canvas.js";
import { getCanvas } from "../canvas/canvas.js";
import { createShape, nextZIndex, newId } from "../canvas/commands.js";
import type { TextShape } from "./text.js";

const DEFAULT_COLOR = "#1a1a1a";

export default function PlaceTextTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: PatchworkViewElement,
): Disposer {
  const icon = createElement(Type, { width: 22, height: 22, style: "pointer-events:none" });
  buttonEl.appendChild(icon);

  let downAt: { x: number; y: number } | null = null;

  const getCanvas = (e: Event) => getCanvas(e.target as Element);

  function getColor(): string {
    const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? "local";
    return handle.doc()?.stateByUser?.[contactUrl]?.color ?? DEFAULT_COLOR;
  }

  function getFontSize(): number {
    const contactUrl = window.accountDocHandle?.doc()?.contactUrl ?? "local";
    return handle.doc()?.stateByUser?.[contactUrl]?.fontSize ?? 18;
  }

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    const canvas = getCanvas(e.target as Element);
    if (!canvas) return;
    const pos = canvas.screenToPage(pe.clientX, pe.clientY);
    downAt = pos;
  }

  function onPointerUp(e: Event) {
    if (!downAt) return;
    const pe = e as PointerEvent;
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY);
    if (!pos) return;
    const dx = pos.x - downAt.x;
    const dy = pos.y - downAt.y;

    if (Math.sqrt(dx * dx + dy * dy) <= 4) {
      const doc = handle.doc();
      const shape: TextShape = {
        id: newId(),
        type: "text",
        x: downAt.x,
        y: downAt.y,
        zIndex: doc ? nextZIndex(doc) : 0,
        text: "",
        color: getColor(),
        fontSize: getFontSize(),
      };
      createShape(handle, shape);
    }

    downAt = null;
  }

  function onCancel() {
    downAt = null;
  }

  buttonEl.addEventListener("pointerdown", onPointerDown);
  buttonEl.addEventListener("pointerup", onPointerUp);
  buttonEl.addEventListener("pointercancel", onCancel);

  return () => {
    buttonEl.removeEventListener("pointerdown", onPointerDown);
    buttonEl.removeEventListener("pointerup", onPointerUp);
    buttonEl.removeEventListener("pointercancel", onCancel);
    icon.remove();
  };
}
