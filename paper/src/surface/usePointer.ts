import { createEffect, type Accessor } from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import type { Pointer, SurfacePointerState } from "./types";

export type { Pointer } from "./types";

export type PointerHandlers = {
  onPointerDown?: (point: { x: number; y: number }) => void;
  onPointerMove?: (pointer: Pointer) => void;
  onPointerUp?: (point: { x: number; y: number }) => void;
};

type ElementSource = HTMLElement | (() => HTMLElement | undefined);

// Subscribes to the provider's `surface:pointer` state and turns the stream of
// pointer snapshots into discrete down / move / up callbacks by watching the
// `isPressed` edge. Returns an accessor for the current pointer so callers can
// also read it directly.
//
// Sketch of the intended API:
//
//   const pointer = createSurfacePointer(element, {
//     onPointerDown: ({x, y}) => start(x, y),
//     onPointerMove: ({x, y, isPressed}) => isPressed && extendTo(x, y),
//     onPointerUp:   ({x, y}) => commit(x, y),
//   })
export function createSurfacePointer(
  element: ElementSource,
  handlers: PointerHandlers,
): Accessor<Pointer | undefined> {
  const state = subscribe<SurfacePointerState>(element, {
    type: "surface:pointer",
  });
  const pointer = () => state()?.pointer;

  let wasPressed = false;
  createEffect(() => {
    const next = pointer();
    if (!next) return;
    if (!wasPressed && next.isPressed) {
      handlers.onPointerDown?.({ x: next.x, y: next.y });
    } else if (wasPressed && !next.isPressed) {
      handlers.onPointerUp?.({ x: next.x, y: next.y });
    } else {
      handlers.onPointerMove?.(next);
    }
    wasPressed = next.isPressed;
  });

  return pointer;
}
