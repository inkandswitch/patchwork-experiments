import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
import {
  accept,
  request,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";
import { onCleanup, onMount, type JSX } from "solid-js";
import {
  DocWithLayers,
  SurfaceTool,
  type Point,
  type SurfacePointer,
} from "./types";

// Brokers the canvas interaction for the paper surface. It owns an ephemeral
// selection-state document — exposing it over `surface:state` and seeding it
// with the paper's url so tools can open the paper doc directly — and tracks
// the canvas pointer. Consumers find it purely by dispatching
// `patchwork:subscribe` from their own element — there is no Solid context
// wiring them together.
export function SurfaceProvider(props: {
  element: HTMLElement;
  handle: DocHandle<DocWithLayers>;
  children: JSX.Element;
}): JSX.Element {
  const repo = useRepo();
  const pointerHandle = repo.create<SurfacePointer>({
    surfaceUrl: props.handle.url,
    isPressed: false,
  });
  const toolHandle = repo.create<SurfaceTool>();

  onMount(() => {
    const el = props.element;

    let activePointerUrl: AutomergeUrl = pointerHandle.url;

    const pointerListeners = new Set<(url: AutomergeUrl) => void>();

    const setActivePointerUrl = (url: AutomergeUrl) => {
      if (url === activePointerUrl) {
        return;
      }

      activePointerUrl = url;
      for (const listener of pointerListeners) {
        listener(activePointerUrl);
      }
    };

    const onPointerDown = async (event: PointerEvent) => {
      console.log("pointer down event");

      const target = event.target as HTMLElement | null;
      if (!target || !event.isPrimary) return;

      setActivePointerUrl(
        await request<AutomergeUrl>(target, {
          type: "surface:pointer",
        }),
      );

      if (activePointerUrl == pointerHandle.url) {
        pointerHandle.change((pointer) => {
          pointer.position = toLocal(event);
          pointer.isPressed = true;
        });
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      console.log("pointer move event");

      if (!event.isPrimary) return;

      if (pointerHandle.url === activePointerUrl) {
        pointerHandle.change((state) => {
          state.position = toLocal(event);
        });
      }
    };

    // Listen for release/cancel on the window so a drag that ends off-canvas
    // still clears the pressed state.
    const onPointerUp = (event: PointerEvent) => {
      console.log("pointer up event");
      if (!event.isPrimary) return;

      if (pointerHandle.url === activePointerUrl) {
        pointerHandle.change((state) => {
          state.isPressed = false;
        });
      }

      setActivePointerUrl(pointerHandle.url);
    };

    const toLocal = (event: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onSubscribe = (event: SubscribeEvent) => {
      const selector = event.detail?.selector;

      switch (selector?.type) {
        case "surface:pointer":
          accept<AutomergeUrl>(event, (respond) => {
            respond(activePointerUrl);

            pointerListeners.add(respond);
            return () => {
              pointerListeners.delete(respond);
            };
          });

          break;

        case "surface:tool":
          accept<AutomergeUrl>(event, (respond) => respond(toolHandle.url));
      }

      if (selector && selector.type === "surface:state") {
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("patchwork:subscribe", onSubscribe);

    onCleanup(() => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("patchwork:subscribe", onSubscribe);
    });
  });

  return <>{props.children}</>;
}
