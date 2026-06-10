import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "../vendor/automerge-solid-primitives";
import { accept, type SubscribeEvent } from "../vendor/providers";
import {
  createEffect,
  createMemo,
  createRoot,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { DocWithLayers, type Point, SurfaceState } from "./types";
import { subscribeDoc } from "../vendor/providers-solid";

export function SurfaceProvider({
  handle,
  children,
  onMounted,
  toLocal,
}: {
  handle: DocHandle<DocWithLayers>;
  children: JSX.Element;
  onMounted?: () => void;
  // Converts a pointer event into this surface's local coordinate space.
  // Defaults to plain rect-relative pixels; the map passes a projection from
  // screen pixels into geographic (Mercator world) coordinates so its shapes
  // are stored georeferenced. Every surface only ever converts for itself.
  toLocal?: (event: PointerEvent) => Point;
}): JSX.Element {
  let root!: HTMLDivElement;

  const repo = useRepo();

  const [, _stateHandle] = subscribeDoc<SurfaceState>(() => root, {
    type: "surface:state",
  });
  // The ancestor's answer arrives async (MessagePort + repo.find), so the
  // memo runs with `undefined` first and needs a fallback doc — created once,
  // not per evaluation, so re-runs can't mint orphan docs.
  let fallback: DocHandle<SurfaceState> | undefined;
  const stateHandle = createMemo(
    () => _stateHandle() ?? (fallback ??= repo.create<SurfaceState>()),
  );

  onMount(() => {
    if (onMounted) onMounted();

    const getLocalPosition =
      toLocal ??
      ((event: PointerEvent): Point => {
        const rect = root.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      });

    // The event target's nearest surface root is the innermost surface under
    // the cursor. Only that provider owns the sample (resets it and stamps
    // `surfaceUrl`); every ancestor surface, reached as the event bubbles,
    // merely adds its own position entry.
    const isInnermost = (event: PointerEvent): boolean => {
      const target = event.target as Element | null;
      return target?.closest("[data-surface-root]") === root;
    };

    const stampPointer = (event: PointerEvent, isPressed: boolean) => {
      const position = getLocalPosition(event);
      stateHandle().change((state) => {
        if (isInnermost(event)) {
          state.pointer = {
            positions: { [handle.url]: position },
            surfaceUrl: handle.url,
            isPressed,
          };
        } else if (state.pointer) {
          // An ancestor surface: the innermost provider already ran (bubbling
          // is innermost-first) and reset the sample, so just contribute this
          // surface's view of the same cursor location.
          state.pointer.positions[handle.url] = position;
        }
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      // No capture: moves and the release must hit-test to whatever surface
      // is under the cursor, so cross-surface drags can read their drop
      // target straight from the pointer state. Touch pointers are
      // implicitly captured to the down target, so release that too.
      const target = event.target as Element;
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }

      stampPointer(event, true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      // A hover move must not report "pressed"; derive it from the actual
      // button state instead of hardcoding true.
      stampPointer(event, (event.buttons & 1) === 1);
    };

    // No stopPropagation anywhere: the event must bubble through every
    // ancestor surface root so each can stamp its own position entry. The
    // innermost surface is identified structurally (isInnermost), not by
    // suppressing the ancestors.
    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      stampPointer(event, false);
    };

    // Safety net for releases outside any surface (toolbar, off-window):
    // only clears the pressed flag, never touches positions or surface, so it
    // can't corrupt drop targets. In-surface releases now bubble here too, but
    // the surface handler has already cleared the flag, so this is a no-op for
    // them.
    const onWindowPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      stateHandle().change((state) => {
        if (state.pointer?.isPressed) state.pointer.isPressed = false;
      });
    };

    const onSubscribe = (event: SubscribeEvent) => {
      const selector = event.detail?.selector;

      if (selector?.type === "surface:state") {
        // Respond reactively: children often subscribe before this provider's
        // own upstream subscription has resolved, so they'd otherwise be
        // stuck on the fallback doc when the inherited state arrives. The
        // DOM listener runs outside any Solid owner, hence createRoot; accept
        // runs the returned dispose as teardown on unsubscribe.
        accept<AutomergeUrl>(event, (respond) =>
          createRoot((dispose) => {
            createEffect(() => respond(stateHandle().url));
            return dispose;
          }),
        );
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    root.addEventListener("patchwork:subscribe", onSubscribe);

    onCleanup(() => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      root.removeEventListener("patchwork:subscribe", onSubscribe);
    });
  });

  // Must fill the surface: the layer views and overlays are pointer-events:
  // none, so this div is the actual hit target for canvas pointer events. An
  // unpositioned div has zero height here and never receives them.
  return (
    <div
      ref={root}
      data-surface-root=""
      style={{ position: "absolute", inset: "0" }}
    >
      {children}
    </div>
  );
}
