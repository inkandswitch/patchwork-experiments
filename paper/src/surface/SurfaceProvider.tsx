import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
import { accept, request, type SubscribeEvent } from "../vendor/providers";
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

  onMount(() => {
    if (onMounted) onMounted();

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      event.stopPropagation();

      // Capture so the drag keeps streaming through root even when the
      // pointer crosses layer views or leaves the canvas.
      root.setPointerCapture(event.pointerId);

      stateHandle().change((state) => {
        state.pointer = {
          position: getLocalPosition(event),
          surfaceUrl: handle.url,
          isPressed: true,
        };
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      event.stopPropagation();

      // A hover move must not report "pressed"; derive it from the actual
      // button state instead of hardcoding true.
      const isPressed = (event.buttons & 1) === 1;

      stateHandle().change((state) => {
        state.pointer = {
          position: getLocalPosition(event),
          surfaceUrl: handle.url,
          isPressed,
        };
      });
    };

    // Listen for release/cancel on the window so a drag that ends off-canvas
    // still clears the pressed state.
    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      event.stopPropagation();

      stateHandle().change((state) => {
        state.pointer = {
          position: getLocalPosition(event),
          surfaceUrl: handle.url,
          isPressed: false,
        };
      });
    };

    const getLocalPosition = (event: PointerEvent): Point => {
      const rect = root.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    root.addEventListener("patchwork:subscribe", onSubscribe);

    onCleanup(() => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
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
