import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import {
  getRegistry,
  createDocOfDatatype2,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { SpatialCanvas } from "../canvas/canvas.js";
import { getCanvas } from "../canvas/canvas.js";
import { createShape, patchShape, newId, nextZIndex } from "../canvas/commands.js";
import { createElement, Link } from "lucide";
import type { EmbedShape } from "./types.js";
import { openMenu } from "./menu.js";

// ============================================================================
// Tool
// ============================================================================

export default function PlaceEmbedTool(
  handle: DocHandle<CanvasDoc>,
  buttonEl: PatchworkViewElement,
): Disposer {
  const repo = buttonEl.repo;
  const icon = createElement(Link, { width: 22, height: 22, style: "pointer-events:none" });
  buttonEl.appendChild(icon);
  buttonEl.title = "Embed";

  let pendingDatatypeId: string | null = null;
  let closeMenu: (() => void) | null = null;

  let origin: { x: number; y: number } | null = null;
  let preview: HTMLElement | null = null;

  // ---- helpers ----

  const getCanvas = (e: Event) => getCanvas(e.target as Element);

  function getLayer(): HTMLElement | null {
    return buttonEl.closest(".sc-container")?.querySelector<HTMLElement>(".sc-layer") ?? null;
  }

  function cleanup() {
    preview?.remove();
    preview = null;
    origin = null;
  }

  function updatePreview(ox: number, oy: number, cx: number, cy: number) {
    if (!preview) return;
    const x = Math.min(ox, cx);
    const y = Math.min(oy, cy);
    const w = Math.abs(cx - ox);
    const h = Math.abs(cy - oy);
    preview.style.transform = `translate(${x}px,${y}px)`;
    preview.style.width = `${w}px`;
    preview.style.height = `${h}px`;
  }

  // ---- button click → always open menu ----

  function onButtonClick() {
    closeMenu?.();
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
    const datatypes = registry.filter((d) => !d.unlisted);
    closeMenu = openMenu(
      buttonEl,
      datatypes.map((dt) => ({ id: dt.id, name: dt.name, icon: dt.icon })),
      (id) => {
        pendingDatatypeId = id;
        closeMenu = null;
      },
    );
  }

  buttonEl.addEventListener("click", onButtonClick);

  // ---- canvas pointer events ----

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY);
    if (!pos) return;
    origin = { x: pos.x, y: pos.y };

    preview = document.createElement("div");
    preview.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      "box-sizing:border-box",
      "pointer-events:none",
      "background:rgba(100,100,200,0.08)",
      "border:1.5px dashed #6464c8",
      "border-radius:6px",
    ].join(";");
    updatePreview(pos.x, pos.y, pos.x, pos.y);
    getLayer()?.appendChild(preview);
  }

  function onPointerMove(e: Event) {
    if (!origin) return;
    const pe = e as PointerEvent;
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY);
    if (!pos) return;
    updatePreview(origin.x, origin.y, pos.x, pos.y);
  }

  function onPointerUp(e: Event) {
    if (!origin) return;
    const pe = e as PointerEvent;
    const pos = getCanvas(e)?.screenToPage(pe.clientX, pe.clientY);
    if (!pos) return;
    const x = Math.min(origin.x, pos.x);
    const y = Math.min(origin.y, pos.y);
    const width = Math.abs(pos.x - origin.x);
    const height = Math.abs(pos.y - origin.y);
    cleanup();

    if (width <= 4 || height <= 4 || !pendingDatatypeId) return;

    const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";
    handle.change((d) => {
      if (!d.stateByUser) d.stateByUser = {};
      if (!d.stateByUser[contactUrl])
        d.stateByUser[contactUrl] = { selection: {}, color: "#1a1a1a" };
      d.stateByUser[contactUrl].selectedTool = "spatial-canvas-tool-select";
    });

    const datatypeId = pendingDatatypeId;
    const doc = handle.doc();
    const zIndex = doc ? nextZIndex(doc) : 0;
    const id = newId();

    const placeholder: EmbedShape = {
      id,
      type: "embed",
      x,
      y,
      zIndex,
      docUrl: "",
      docType: datatypeId,
      toolId: "",
      width,
      height,
    };
    createShape(handle, placeholder);

    // Async: create the real doc then patch the shape
    (async () => {
      try {
        const loaded =
          await getRegistry<DatatypeDescription>("patchwork:datatype").load(datatypeId);
        if (!loaded) return;
        const docHandle = await createDocOfDatatype2(loaded as LoadedDatatype, repo);
        patchShape(handle, id, { docUrl: docHandle.url });
      } catch (err) {
        console.error("[PlaceEmbedTool] failed to create doc", err);
      }
    })();
  }

  function onCancel() {
    cleanup();
  }

  buttonEl.addEventListener("pointerdown", onPointerDown);
  buttonEl.addEventListener("pointermove", onPointerMove);
  buttonEl.addEventListener("pointerup", onPointerUp);
  buttonEl.addEventListener("pointercancel", onCancel);

  return () => {
    buttonEl.removeEventListener("click", onButtonClick);
    buttonEl.removeEventListener("pointerdown", onPointerDown);
    buttonEl.removeEventListener("pointermove", onPointerMove);
    buttonEl.removeEventListener("pointerup", onPointerUp);
    buttonEl.removeEventListener("pointercancel", onCancel);
    closeMenu?.();
    cleanup();
    icon.remove();
  };
}
