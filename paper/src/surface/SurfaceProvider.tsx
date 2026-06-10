import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
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
import { request, subscribeDoc } from "../vendor/providers-solid";

export function SurfaceProvider({
  handle,
  children,
  onMounted,
}: {
  handle: DocHandle<DocWithLayers>;
  children: JSX.Element;
  onMounted?: () => void;
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

  // Ask the nearest ancestor surface for its url. Dispatched before this
  // provider's own subscribe listener attaches (request's onMount runs
  // first), so a provider can't answer itself. Stays undefined for a
  // top-level surface.
  const parentSurfaceUrl = request<AutomergeUrl>(() => root, {
    type: "surface:parent",
  });

  onMount(() => {
    if (onMounted) onMounted();

    const getLocalPosition = (event: PointerEvent): Point => {
      const rect = root.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const stampPointer = (event: PointerEvent, isPressed: boolean) => {
      stateHandle().change((state) => {
        const pointer: SurfaceState["pointer"] = {
          position: getLocalPosition(event),
          screenPosition: { x: event.clientX, y: event.clientY },
          surfaceUrl: handle.url,
          isPressed,
        };
        // Automerge rejects explicit undefined values, so only set when known.
        const parent = parentSurfaceUrl();
        if (parent) pointer.parentSurfaceUrl = parent;
        state.pointer = pointer;
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      event.stopPropagation();

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

      event.stopPropagation();

      // A hover move must not report "pressed"; derive it from the actual
      // button state instead of hardcoding true.
      stampPointer(event, (event.buttons & 1) === 1);
    };

    // On root, not window: whichever surface is under the cursor stamps the
    // release, and that sample is the drop target for cross-surface drags.
    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      event.stopPropagation();

      stampPointer(event, false);
    };

    // Safety net for releases outside any surface (toolbar, off-window):
    // only clears the pressed flag, never touches position or surface, so it
    // can't corrupt drop targets. In-surface releases stop propagation at
    // root and never reach this.
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

      if (selector?.type === "surface:parent") {
        accept<AutomergeUrl>(event, (respond) => {
          respond(handle.url);
        });
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
    <div ref={root} style={{ position: "absolute", inset: "0" }}>
      {children}
    </div>
  );
}
