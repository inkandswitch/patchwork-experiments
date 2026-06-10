import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
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
import {
  DocWithLayers,
  type Point,
  type ShapeLayerDoc,
  SurfaceState,
} from "./types";
import { subscribeDoc } from "../vendor/providers-solid";
import type { EmbedShape } from "../embed/EmbedLayerTool";

// The sideboard stamps this media type on its drags. The payload is JSON
// `{ source, items }`, each item carrying at least the dragged document's url;
// the url is all we need to embed it.
const DND_MEDIA_TYPE = "text/x-patchwork-dnd";

// A fresh embed's on-canvas size, matching the fallback in `embedSize`.
const EMBED_WIDTH = 320;
const EMBED_HEIGHT = 240;
// Multi-item drops cascade so the embeds don't land exactly on top of each
// other.
const EMBED_CASCADE = 24;

type DroppedItem = { url: AutomergeUrl };

export function SurfaceProvider({
  handle,
  children,
  onMounted,
  toLocal,
}: {
  handle: DocHandle<DocWithLayers>;
  children: JSX.Element;
  onMounted?: () => void;
  // Converts screen coordinates into this surface's local coordinate space.
  // Defaults to plain rect-relative pixels; the map passes a projection from
  // screen pixels into geographic (Mercator world) coordinates so its shapes
  // are stored georeferenced. Every surface only ever converts for itself.
  // Takes raw client coordinates (not an event) so both pointer events and
  // drag events can feed it.
  toLocal?: (clientX: number, clientY: number) => Point;
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
      ((clientX: number, clientY: number): Point => {
        const rect = root.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
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
      const position = getLocalPosition(event.clientX, event.clientY);
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

    // A drag carrying a sideboard payload is a valid drop target. Marking it
    // (preventDefault) and forcing the copy cursor reflects that the embed
    // references the dragged doc — it never moves it. The payload itself is
    // only readable on `drop`, so here we can only sniff the media type.
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DND_MEDIA_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer?.getData(DND_MEDIA_TYPE);
      if (!data) return;

      // Innermost surface under the cursor owns the drop, like pointer
      // stamping: drag events bubble out of embedded patchwork-views (same-DOM
      // custom elements), so an ancestor surface would otherwise embed the
      // same doc too.
      const target = event.target as Element | null;
      if (target?.closest("[data-surface-root]") !== root) return;

      // Stop the browser from navigating to the dragged document's url.
      event.preventDefault();

      const items = parseDroppedItems(data);
      if (items.length === 0) return;

      const position = getLocalPosition(event.clientX, event.clientY);
      void createEmbeds(repo, handle, items, position);
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
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    root.addEventListener("patchwork:subscribe", onSubscribe);

    onCleanup(() => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
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

// Drop one embed shape per item onto `surfaceHandle`, anchored at `at` (in the
// surface's local space) and cascaded so multiple items don't stack exactly.
// No `toolId` is pinned, so each embed falls back to the default tool for its
// document's datatype.
async function createEmbeds(
  repo: Repo,
  surfaceHandle: DocHandle<DocWithLayers>,
  items: DroppedItem[],
  at: Point,
) {
  const layerHandle = await getEmbedLayerHandle(repo, surfaceHandle);

  layerHandle.change(({ shapes }) => {
    let z = Object.values(shapes).reduce(
      (max, shape) => Math.max(max, shape.z ?? 0),
      0,
    );
    items.forEach((item, i) => {
      const id = crypto.randomUUID();
      const embed: EmbedShape = {
        id,
        x: at.x + i * EMBED_CASCADE,
        y: at.y + i * EMBED_CASCADE,
        z: ++z,
        outline: { type: "rectangle", width: EMBED_WIDTH, height: EMBED_HEIGHT },
        docUrl: item.url,
      };
      shapes[id] = embed;
    });
  });
}

// The embed layer lives under the well-known `embed-shape-layer` key that
// `PaperDatatype.init` seeds; create it on the first drop onto a surface that
// doesn't have one yet (e.g. the map, or a blank nested paper).
async function getEmbedLayerHandle(
  repo: Repo,
  surfaceHandle: DocHandle<DocWithLayers>,
): Promise<DocHandle<ShapeLayerDoc>> {
  const existingUrl = surfaceHandle.doc()?.layers["embed-shape-layer"];
  if (existingUrl) {
    return repo.find<ShapeLayerDoc>(existingUrl);
  }

  const layerHandle = await repo.create2<ShapeLayerDoc>({
    "@patchwork": { type: "shape-layer" },
    title: "Embed",
    shapes: {},
  });
  surfaceHandle.change(
    (surface) => (surface.layers["embed-shape-layer"] = layerHandle.url),
  );
  return layerHandle;
}

// The drag payload is JSON `{ source, items }`; we only need each item's url.
// A malformed payload yields no items rather than throwing into the drop
// handler.
function parseDroppedItems(data: string): DroppedItem[] {
  try {
    const parsed = JSON.parse(data) as { items?: { url?: AutomergeUrl }[] };
    return (parsed.items ?? [])
      .filter((item): item is DroppedItem => typeof item.url === "string")
      .map((item) => ({ url: item.url }));
  } catch {
    return [];
  }
}
