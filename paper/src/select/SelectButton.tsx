import type { DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { ShapeLayerDoc } from "../surface/types";
import { hitTestShape, shapeRef } from "./geometry";

// The select tool. The button toggles select mode, but the component also owns
// all selection interaction: it reads every layer (from the surface doc that
// `surface:pointer` points to), hit-tests the pointer, writes the selection
// into the shared focus doc, deletes on Backspace/Delete, and drags selected
// shapes by mutating their `x`/`y`. SelectionOverlay only renders the
// highlights for whatever is here.
export function SelectButton(): JSX.Element {
  let root!: HTMLButtonElement;

  const [tool, toolHandle] = subscribeDoc<SurfaceTool>(() => root, {
    type: "surface:tool",
  });
  const [state] = subscribeDoc<SurfacePointerState>(() => root, {
    type: "surface:pointer",
  });

  const [focusDoc, focusHandle] = subscribeDoc<{
    selection: Record<string, true>;
    highlight: Record<string, true>;
  }>(() => root, {
    type: "patchwork:focus",
  });

  const active = () => tool()?.toolId === "select";
  const [hovered, setHovered] = createSignal(false);
  const repo = useRepo();

  let shiftDown = false;
  let wasPointerPressed = false;

  createEffect(async () => {
    const pointer = getPointer();
    if (!pointer || !pointer.position) return;

    const { x, y } = pointer.position;

    if (!active()) {
      return;
    }

    const surface = await repo.find(pointer.surfaceUrl);

    const shapeLayerHandles = await Promise.all(
      Object.values(layers()).map((url) => repo.find<ShapeLayerDoc>(url)),
    );

    if (!wasPointerPressed && pointer.isPressed) {
      onPointerDown(x, y, shapeLayerHandles);
    }
    wasPointerPressed = pointer.isPressed;
  });

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  });

  const toggle = () => {
    toolHandle()?.change((doc) => {
      doc.toolId = doc.toolId === "select" ? "" : "select";
    });
  };

  function onPointerDown(
    x: number,
    y: number,
    shapeLayerHandles: DocHandle<ShapeLayerDoc>[],
  ) {
    console.log("on pointer down!!!");
    const focus = focusHandle();
    console.log("pointer down", focus);
    if (!focus) return;

    const hit = topmostHit(x, y, shapeLayerHandles);
    console.log("pointer down!", hit);
    if (shiftDown) {
      focus.change((doc) => {
        if (!doc.selection) doc.selection = {};
        if (!hit) return;
        if (doc.selection[hit]) delete doc.selection[hit];
        else doc.selection[hit] = true;
      });
      return;
    }
    if (!hit) {
      focus.change((doc) => {
        doc.selection = {};
      });
      return;
    }

    const current = focusDoc()?.selection ?? {};
    let keys: string[];
    if (current[hit]) {
      keys = Object.keys(current);
    } else {
      keys = [hit];
      focus.change((doc) => {
        doc.selection = { [hit]: true };
      });
    }
  }

  // The ref of the shape with the greatest `z` under `point`, if any.
  function topmostHit(
    x: number,
    y: number,
    shapeLayerHandles: DocHandle<ShapeLayerDoc>[],
  ): string | undefined {
    debugger;
    let bestZ = -Infinity;
    let bestShape;
    for (const handle of shapeLayerHandles) {
      const shapes = handle.doc().shapes ?? [];
      shapes.forEach((shape, index) => {
        if (!hitTestShape(x, y, shape)) return;
        const z = shape.z ?? 0;
        if (!best || z >= best.z) best = { ref: shapeRef(entry.url, index), z };
      });
    }
    return best?.ref;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Shift") {
      shiftDown = true;
      return;
    }
    if (!active()) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const focus = focusHandle();
    const selected = focusDoc()?.selection;
    if (!focus || !selected || Object.keys(selected).length === 0) return;
    event.preventDefault();
    deleteSelected(selected);
    focus.change((doc) => {
      doc.selection = {};
    });
  }

  // Remove every selected shape from every layer, splicing from the highest
  // index down so earlier indices stay valid.
  function deleteSelected(selected: Record<string, true>) {
    console.log("todo implement delete");
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === "Shift") shiftDown = false;
  }
  function onBlur() {
    shiftDown = false;
  }

  const buttonStyle = (): JSX.CSSProperties => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    width: "34px",
    height: "34px",
    padding: "0",
    border: `1px solid ${active() ? "#1c1917" : "rgba(28, 25, 23, 0.1)"}`,
    "border-radius": "10px",
    background: active()
      ? "#1c1917"
      : hovered()
        ? "#ffffff"
        : "rgba(255, 255, 255, 0.9)",
    "box-shadow": "0 1px 3px rgba(28, 25, 23, 0.18)",
    "backdrop-filter": "blur(6px)",
    color: active() ? "#fafaf9" : "#44403c",
    cursor: "pointer",
    "pointer-events": "auto",
    transition:
      "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
  });

  return (
    <button
      ref={root}
      type="button"
      style={buttonStyle()}
      title="Select"
      aria-label="Select"
      aria-pressed={active()}
      onClick={toggle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Native (non-delegated) listeners: they run while the event bubbles
      // through the button, before the surface root's own listeners, so
      // pressing the button never reads as drawing on the surface.
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M4 3 L4 16 L8 12.5 L10.5 17 L12.5 16 L10 11.5 L15 11.5 Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}
