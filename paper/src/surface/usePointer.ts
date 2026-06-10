import { createEffect, type Accessor } from "solid-js";
import { subscribeDoc } from "../vendor/providers-solid";
import type { Pointer, SurfaceState } from "./types";

export type { Pointer } from "./types";

export type PointerHandlers = {
  onPointerDown?: (point: { x: number; y: number }) => void;
  onPointerMove?: (pointer: Pointer) => void;
  onPointerUp?: (point: { x: number; y: number }) => void;
};

type ElementSource = HTMLElement | (() => HTMLElement | undefined);

// Subscribes to the surface provider's `surface:state` document and turns the
// stream of `state.pointer` snapshots into discrete down / move / up callbacks
// by watching the `isPressed` edge. Returns an accessor for the current pointer
// so callers can also read it directly.
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
  const [state] = subscribeDoc<SurfaceState>(element, {
    type: "surface:state",
  });
  const pointer = () => state()?.pointer;

  let wasPressed = false;
  createEffect(() => {
    const next = pointer();
    if (!next) return;
    // Snapshot the values synchronously: `next` is a live store proxy that
    // reconciles in place, so a deferred read could see a newer sample.
    const snapshot: Pointer = {
      x: next.x,
      y: next.y,
      isPressed: next.isPressed,
    };
    const wasPressedBefore = wasPressed;
    wasPressed = snapshot.isPressed;

    // Defer the consumer callbacks to a microtask. They typically mutate
    // another Automerge doc (e.g. a layer); running them synchronously here
    // would re-enter Automerge inside the `surface:state` change that produced
    // this snapshot, which the wasm backend rejects ("recursive use of an
    // object").
    queueMicrotask(() => {
      if (!wasPressedBefore && snapshot.isPressed) {
        handlers.onPointerDown?.({ x: snapshot.x, y: snapshot.y });
      } else if (wasPressedBefore && !snapshot.isPressed) {
        handlers.onPointerUp?.({ x: snapshot.x, y: snapshot.y });
      } else {
        handlers.onPointerMove?.(snapshot);
      }
    });
  });

  return pointer;
}
