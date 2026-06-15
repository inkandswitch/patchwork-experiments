import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { useRepo } from "../vendor/automerge-solid-primitives";
import { accept, type SubscribeEvent } from "../vendor/providers";
import {
  createEffect,
  createMemo,
  createRoot,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  DocWithLayers,
  type DropEffect,
  type Point,
  type PointerDrag,
  type ShapeLayerDoc,
  SurfaceState,
} from "./types";
import { subscribeDoc } from "../vendor/providers-solid";
import { createPositionRegistry, positionOfUrl } from "./position";
import { hitTestShape } from "./geometry";
import type { EmbedShape } from "../embed/EmbedLayerTool";

// The sideboard stamps this media type on its drags. The payload is JSON
// `{ source, items }`, each item carrying at least the dragged document's url;
// the url is all we need to embed it.
const DND_MEDIA_TYPE = "text/x-patchwork-dnd";

// A fresh embed's on-canvas footprint (drag handle included), matching the
// fallback in `embedSize`.
const EMBED_WIDTH = 320;
const EMBED_HEIGHT = 240;
// Multi-item drops cascade so the embeds don't land exactly on top of each
// other.
const EMBED_CASCADE = 24;

// Movement (in client px) a pressed pointer carrying drag data must travel
// before it counts as a drag and the surface starts dispatching native drag
// events. Keeps a plain click on a drag source from firing a drop.
const DRAG_THRESHOLD = 4;

type DroppedItem = { url: AutomergeUrl };

export function SurfaceProvider({
  handle,
  children,
  onMounted,
  toLocal,
  scale = () => 1,
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
  // This surface's current scale (screen pixels per local unit). Stamped onto
  // every pointer sample and used to scale dropped embeds. Defaults to 1 (the
  // plain pixel surface, e.g. paper); the map passes its zoom-derived scale.
  scale?: Accessor<number>;
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

    // Live `surface:position` subscriptions against this surface's subtree.
    const positions = createPositionRegistry(root);
    onCleanup(() => positions.dispose());

    const getLocalPosition =
      toLocal ??
      ((clientX: number, clientY: number): Point => {
        const rect = root.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      });

    // Layer handles resolved so far, for synchronous hit detection while
    // stamping. `null` marks an in-flight find so each layer is fetched once;
    // a layer that isn't resolved yet simply doesn't participate (by the next
    // sample it will). A find that rejects is dropped so the next pass retries.
    const layerHandles = new Map<
      AutomergeUrl,
      DocHandle<ShapeLayerDoc> | null
    >();

    // The topmost shape (greatest z) under a point in this surface's local
    // space, or undefined. Fully synchronous: only already-resolved layer
    // handles are inspected. Layers are read fresh from the surface doc each
    // call, so added layers are picked up and removed ones never consulted.
    const topmostShapeAt = (x: number, y: number): AutomergeUrl | undefined => {
      const layers = handle.doc()?.layers ?? {};
      let bestUrl: AutomergeUrl | undefined;
      let bestZ: number | undefined;
      for (const layerUrl of Object.values(layers)) {
        const layerHandle = layerHandles.get(layerUrl);
        if (layerHandle === undefined) {
          layerHandles.set(layerUrl, null);
          void repo
            .find<ShapeLayerDoc>(layerUrl)
            .then((resolved) => layerHandles.set(layerUrl, resolved))
            .catch(() => layerHandles.delete(layerUrl));
          continue;
        }
        if (layerHandle === null) continue;
        for (const shape of Object.values(layerHandle.doc()?.shapes ?? {})) {
          if (!hitTestShape(x, y, shape)) continue;
          const z = shape.z ?? 0;
          if (bestZ === undefined || z >= bestZ) {
            bestUrl = layerHandle.sub("shapes", shape.id).url;
            bestZ = z;
          }
        }
      }
      return bestUrl;
    };

    // --- pointer-driven drag-and-drop gesture state (one primary pointer) ---
    // Non-null only between pointerdown and release. `started` flips once the
    // press crosses DRAG_THRESHOLD; `targetEl` is what the synthetic
    // dragenter/dragleave pair currently points at; `dropEffect` is what the
    // last dragover negotiated (it seeds and finalizes the drop).
    let dragState: {
      downClient: { x: number; y: number };
      started: boolean;
      targetEl: Element | null;
      dropEffect: DropEffect;
    } | null = null;

    // Stamp a pointer sample onto the surface state, merging fields in place so
    // a drag payload written by a source survives across moves. The innermost
    // surface under the cursor owns the event: its root is the first surface
    // root the bubbling event reaches, so it stamps and stops propagation —
    // ancestor surfaces never see it. `shapeUrl` is cleared when nothing is
    // under the cursor; `clearDrag` (pointerdown) drops any payload to start
    // fresh; `finalizeDrag` (release) records the drop outcome in the same
    // change, so a source reads it on the same release transition.
    const updatePointer = (
      event: PointerEvent,
      isPressed: boolean,
      opts?: { clearDrag?: boolean; finalizeDrag?: DropEffect },
    ) => {
      event.stopPropagation();
      const position = getLocalPosition(event.clientX, event.clientY);
      const shapeUrl = topmostShapeAt(position.x, position.y);
      const currentScale = scale();
      stateHandle().change((state) => {
        const p = state.pointer;
        if (!p) {
          state.pointer = {
            position,
            surfaceUrl: handle.url,
            isPressed,
            scale: currentScale,
          };
          if (shapeUrl) state.pointer.shapeUrl = shapeUrl;
          return;
        }
        p.position = position;
        p.surfaceUrl = handle.url;
        p.isPressed = isPressed;
        p.scale = currentScale;
        if (shapeUrl) p.shapeUrl = shapeUrl;
        else delete p.shapeUrl;
        if (opts?.clearDrag) {
          delete p.drag;
        } else if (
          opts?.finalizeDrag !== undefined &&
          p.drag &&
          p.drag.dropEffect === undefined
        ) {
          p.drag.dropEffect = opts.finalizeDrag;
        }
      });
    };

    // Drive native drag events off a pressed move once a drag payload is
    // present and the threshold is crossed. Dispatched at the element under the
    // cursor (real DragEvents, blank values mid-drag), so any native
    // dragover/drop listener — including this surface's own embed handler —
    // participates. Records the negotiated drop effect for the eventual drop.
    const updateDrag = (event: PointerEvent) => {
      if (!dragState) return;
      const drag = stateHandle().doc()?.pointer?.drag;
      if (!drag || drag.dropEffect !== undefined) return;

      if (!dragState.started) {
        const dx = event.clientX - dragState.downClient.x;
        const dy = event.clientY - dragState.downClient.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragState.started = true;
      }

      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (target !== dragState.targetEl) {
        if (dragState.targetEl) {
          dragState.targetEl.dispatchEvent(
            buildDragEvent("dragleave", drag, false, event),
          );
        }
        if (target) {
          target.dispatchEvent(buildDragEvent("dragenter", drag, false, event));
        }
        dragState.targetEl = target;
      }

      if (!target) {
        dragState.dropEffect = "none";
        return;
      }
      const over = buildDragEvent("dragover", drag, false, event);
      target.dispatchEvent(over);
      dragState.dropEffect = over.defaultPrevented
        ? acceptedEffect(over.dataTransfer?.dropEffect, "none")
        : "none";
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

      dragState = {
        downClient: { x: event.clientX, y: event.clientY },
        started: false,
        targetEl: null,
        dropEffect: "none",
      };

      // Clear any prior drag payload so each press starts a fresh gesture; a
      // source writes the new payload in its own reaction to this sample.
      updatePointer(event, true, { clearDrag: true });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      // A hover move must not report "pressed"; derive it from the actual
      // button state instead of hardcoding true.
      const isPressed = (event.buttons & 1) === 1;
      updatePointer(event, isPressed);
      if (isPressed) updateDrag(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      // Offer the drop synchronously so its outcome is known before the state
      // change below; the source reads `drag.dropEffect` on the same release.
      const drag = stateHandle().doc()?.pointer?.drag;
      let dropEffect: DropEffect = "none";
      if (drag && drag.dropEffect === undefined && dragState?.started) {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target) {
          const dropEvent = buildDragEvent("drop", drag, true, event);
          if (dropEvent.dataTransfer) {
            dropEvent.dataTransfer.dropEffect = dragState.dropEffect;
          }
          target.dispatchEvent(dropEvent);
          dropEffect = dropEvent.defaultPrevented
            ? acceptedEffect(
                dropEvent.dataTransfer?.dropEffect,
                dragState.dropEffect,
              )
            : "none";
        }
      }

      updatePointer(event, false, { finalizeDrag: dropEffect });
      dragState = null;
    };

    // A cancelled pointer (e.g. the OS stealing the gesture) can't reach a drop
    // target, so any in-progress drag is rejected: leave the current target and
    // finalize `dropEffect` to "none" in the same change as the release.
    const onPointerCancel = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      const drag = stateHandle().doc()?.pointer?.drag;
      if (
        drag &&
        drag.dropEffect === undefined &&
        dragState?.started &&
        dragState.targetEl
      ) {
        dragState.targetEl.dispatchEvent(
          buildDragEvent("dragleave", drag, false, event),
        );
      }

      updatePointer(event, false, { finalizeDrag: "none" });
      dragState = null;
    };

    // Safety net for releases outside any surface (toolbar, off-window): those
    // never pass through a surface root, so nothing else clears the pressed
    // flag. Position and surface are left untouched so drop targets can't be
    // corrupted; an in-progress drag is rejected, since a release off any
    // surface can't have hit a drop target.
    const onWindowPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      stateHandle().change((state) => {
        const p = state.pointer;
        if (!p?.isPressed) return;
        p.isPressed = false;
        if (p.drag && p.drag.dropEffect === undefined)
          p.drag.dropEffect = "none";
      });
      dragState = null;
    };

    // A drag carrying a sideboard payload is a valid drop target. Marking it
    // (preventDefault) and forcing the copy cursor reflects that the embed
    // references the dragged doc — it never moves it. The payload itself is
    // only readable on `drop`, so here we can only sniff the media type.
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DND_MEDIA_TYPE)) return;
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer?.getData(DND_MEDIA_TYPE);
      if (!data) return;

      // Like pointer stamping, the innermost surface owns the drop: drag
      // events bubble out of embedded patchwork-views (same-DOM custom
      // elements), so without this an ancestor would embed the same doc too.
      event.stopPropagation();
      // Stop the browser from navigating to the dragged document's url.
      event.preventDefault();

      const items = parseDroppedItems(data);
      if (items.length === 0) return;

      const position = getLocalPosition(event.clientX, event.clientY);
      void createEmbeds(repo, handle, items, position, scale());
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

      if (selector?.type === "surface:position") {
        const url = selector.url;
        if (typeof url !== "string") return;

        // Decline — return without accepting, so the event keeps bubbling —
        // when nothing in this subtree renders the url; an ancestor surface
        // whose subtree contains both the consumer and the target answers
        // instead. Positions are streamed in screen coordinates, so any
        // surface's answer is equally valid.
        if (positionOfUrl(root, url) === null) return;

        accept<Point>(event, (respond) => positions.add(url, respond));
      }
    };

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    root.addEventListener("patchwork:subscribe", onSubscribe);

    onCleanup(() => {
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
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
      style={{ position: "absolute", inset: "0", "pointer-events": "auto" }}
    >
      {children}
    </div>
  );
}

// Build a real native drag event carrying a pointer drag payload, to dispatch
// at the element under the cursor so ordinary dragover/drop listeners take
// part. Values are only attached on the drop (`withValues`), matching native
// protected mode where dragover exposes the types but not their values.
function buildDragEvent(
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  drag: PointerDrag,
  withValues: boolean,
  event: PointerEvent,
): DragEvent {
  const dataTransfer = new DataTransfer();
  dataTransfer.effectAllowed = drag.effectAllowed;
  for (const [mediaType, value] of Object.entries(drag.data)) {
    dataTransfer.setData(mediaType, withValues ? value : "");
  }
  const dragEvent = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: event.clientX,
    clientY: event.clientY,
    dataTransfer,
  });
  // Some browsers ignore `dataTransfer` in the DragEvent constructor; attach it
  // directly so listeners can still read it.
  if (!dragEvent.dataTransfer) {
    Object.defineProperty(dragEvent, "dataTransfer", { value: dataTransfer });
  }
  return dragEvent;
}

// The effect a target settled on when it accepted a drag (preventDefault).
// Targets often accept without setting an explicit dropEffect, so fall back to
// the negotiated value and finally to "copy".
function acceptedEffect(
  fromEvent: DropEffect | undefined,
  negotiated: DropEffect,
): DropEffect {
  if (fromEvent && fromEvent !== "none") return fromEvent;
  if (negotiated !== "none") return negotiated;
  return "copy";
}

// Drop one embed shape per item onto `surfaceHandle`, anchored at `at` (in the
// surface's local space) and cascaded so multiple items don't stack exactly.
// No `toolId` is pinned, so each embed falls back to the default tool for its
// document's datatype. `surfaceScale` is the surface's current scale (screen
// px per local unit); the embed records `1 / surfaceScale` so its pixel-sized
// footprint renders at that size on drop and the cascade lands at a fixed
// on-screen offset regardless of map zoom.
async function createEmbeds(
  repo: Repo,
  surfaceHandle: DocHandle<DocWithLayers>,
  items: DroppedItem[],
  at: Point,
  surfaceScale: number,
) {
  const layerHandle = await getEmbedLayerHandle(repo, surfaceHandle);
  const embedScale = 1 / surfaceScale;

  layerHandle.change(({ shapes }) => {
    let z = Object.values(shapes).reduce(
      (max, shape) => Math.max(max, shape.z ?? 0),
      0,
    );
    items.forEach((item, i) => {
      const id = crypto.randomUUID();
      const embed: EmbedShape = {
        id,
        x: at.x + i * EMBED_CASCADE * embedScale,
        y: at.y + i * EMBED_CASCADE * embedScale,
        z: ++z,
        scale: embedScale,
        outline: {
          type: "rectangle",
          width: EMBED_WIDTH,
          height: EMBED_HEIGHT,
        },
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
