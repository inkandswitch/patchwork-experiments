import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocumentProjection,
  useRepo,
} from "../vendor/automerge-solid-primitives";
import { accept, subscribe, type SubscribeEvent } from "../vendor/providers";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
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
  type Shape,
  type ShapeLayerDoc,
  SurfaceState,
} from "./types";
import { subscribeDoc } from "../vendor/providers-solid";
import { createPositionRegistry, positionOfUrl } from "./position";
import { hitTestShape } from "./geometry";
import type { EmbedShape } from "../embed/EmbedLayerTool";

const DND_MEDIA_TYPE = "text/x-patchwork-dnd";

const EMBED_WIDTH = 320;
const EMBED_HEIGHT = 240;
const EMBED_CASCADE = 24;

// Client px a pressed pointer must travel before it counts as a drag.
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
  // Converts screen coordinates into this surface's local space. Defaults to
  // rect-relative pixels; the map passes a screen -> geographic projection.
  toLocal?: (clientX: number, clientY: number) => Point;
  // Screen pixels per local unit. Stamped onto every sample and used to scale
  // dropped embeds. 1 for paper; the map passes its zoom-derived scale.
  scale?: Accessor<number>;
}): JSX.Element {
  let root!: HTMLDivElement;

  const repo = useRepo();

  const [, _stateHandle] = subscribeDoc<SurfaceState>(() => root, {
    type: "surface:state",
  });
  // Fallback until an ancestor surface's state doc resolves; created once so
  // re-runs can't mint orphan docs.
  let fallback: DocHandle<SurfaceState> | undefined;
  const stateHandle = createMemo(
    () => _stateHandle() ?? (fallback ??= repo.create<SurfaceState>()),
  );

  onMount(() => {
    if (onMounted) onMounted();

    // --- Selection: the default behavior whenever no drawing tool is active.
    // Every surface runs this, but they share one `surface:state` pointer, so
    // each only begins a gesture for samples its own surface stamped. The
    // surface the press lands on owns the drag and keeps driving it across
    // boundaries, so a cross-surface drag still has exactly one driver.
    const surfaceState = createDocumentProjection<SurfaceState>(stateHandle);

    const [focusHandle, setFocusHandle] = createSignal<DocHandle<FocusDoc>>();
    onCleanup(
      subscribe<AutomergeUrl>(root, { type: "patchwork:focus" }, (url) => {
        if (!url) return;
        void Promise.resolve(repo.find<FocusDoc>(url)).then((h) =>
          setFocusHandle(() => h),
        );
      }),
    );

    const active = () => !surfaceState()?.selectedToolId;

    let shiftDown = false;
    let wasPressed = false;
    // The shapes being dragged, re-homed into the surface under the cursor as
    // the drag crosses boundaries so their single position stays in-space.
    let dragShapes: DragShape[] | null = null;
    // Guards against overlapping async reparent passes on rapid moves.
    let reparenting = false;

    // The drag set is the selection homed in the pressed surface (only those
    // have a meaningful grab offset in the single pointer sample's space).
    const resolveDragShapes = async (
      urls: AutomergeUrl[],
      pointer: SurfacePointer,
    ): Promise<DragShape[]> => {
      const surfaceHandle = await repo.find<DocWithLayers>(pointer.surfaceUrl);
      const layerUrls = Object.values(surfaceHandle.doc()?.layers ?? {});

      const shapes: DragShape[] = [];
      for (const url of urls) {
        if (!layerUrls.some((layerUrl) => url.startsWith(layerUrl))) continue;
        const shapeHandle = await repo.find<Shape>(url);
        const shape = shapeHandle.doc();
        if (!shape) continue;
        shapes.push({
          handle: shapeHandle,
          homeSurfaceUrl: pointer.surfaceUrl,
          grabOffset: {
            x: shape.x - pointer.position.x,
            y: shape.y - pointer.position.y,
          },
          homeScale: pointer.scale,
        });
      }
      return shapes;
    };

    const applyMove = (shapes: DragShape[], pointer: SurfacePointer) => {
      for (const dragShape of shapes) {
        const { handle: shapeHandle, homeSurfaceUrl, grabOffset } = dragShape;
        if (homeSurfaceUrl !== pointer.surfaceUrl) continue;
        if (shapeHandle.doc() === undefined) continue;
        queueMicrotask(() => {
          shapeHandle.change((shape) => {
            shape.x = pointer.position.x + grabOffset.x;
            shape.y = pointer.position.y + grabOffset.y;
          });
        });
      }
    };

    const reparentDrag = async (
      shapes: DragShape[],
      pointer: SurfacePointer,
    ) => {
      if (reparenting) return;
      const movers = shapes.filter(
        (shape) => shape.homeSurfaceUrl !== pointer.surfaceUrl,
      );
      if (movers.length === 0) return;

      reparenting = true;
      try {
        for (const dragShape of movers) {
          await rehome(
            dragShape,
            pointer.surfaceUrl,
            pointer.position,
            pointer.scale,
          );
        }
      } finally {
        reparenting = false;
      }
    };

    // Move a dragged shape into the target surface under the same layer key
    // (created on demand), repointing the drag entry and selection url at the
    // new sub-handle. The shape keeps its uuid id across the move.
    const rehome = async (
      dragShape: DragShape,
      dropSurfaceUrl: AutomergeUrl,
      dropPosition: Point,
      dropScale: number,
    ) => {
      const {
        handle: shapeHandle,
        homeSurfaceUrl,
        grabOffset,
        homeScale,
      } = dragShape;

      const shape = shapeHandle.doc();
      if (!shape) return;
      // An embed can't be dropped into its own document.
      if ((shape as EmbedShape).docUrl === dropSurfaceUrl) return;

      const id = String(shapeHandle.path.at(-1)?.prop);

      const homeHandle = await repo.find<DocWithLayers>(homeSurfaceUrl);
      const sourceLayer = Object.entries(homeHandle.doc()?.layers ?? {}).find(
        ([, layerUrl]) => shapeHandle.url.startsWith(layerUrl),
      );
      if (!sourceLayer) return;
      const [layerKey, sourceLayerUrl] = sourceLayer;

      const dropSurfaceHandle = await repo.find<DocWithLayers>(dropSurfaceUrl);
      const dropLayerUrl = dropSurfaceHandle.doc()?.layers[layerKey];
      let dropLayerHandle: DocHandle<ShapeLayerDoc>;
      if (dropLayerUrl) {
        dropLayerHandle = await repo.find<ShapeLayerDoc>(dropLayerUrl);
      } else {
        const sourceLayerHandle =
          await repo.find<ShapeLayerDoc>(sourceLayerUrl);
        dropLayerHandle = await repo.create2<ShapeLayerDoc>({
          "@patchwork": { type: "shape-layer" },
          title: sourceLayerHandle.doc()?.title ?? "Layer",
          shapes: {},
        });
        queueMicrotask(() => {
          dropSurfaceHandle.change(
            (surface) => (surface.layers[layerKey] = dropLayerHandle.url),
          );
        });
      }

      // Rescale the offset and the shape's scale by the home/drop ratio so it
      // keeps its on-screen size and stays under the cursor across zoom levels.
      const ratio = homeScale / dropScale;

      const moved = JSON.parse(JSON.stringify(shape)) as Shape;
      moved.scale = shape.scale * ratio;
      moved.x = dropPosition.x + grabOffset.x * ratio;
      moved.y = dropPosition.y + grabOffset.y * ratio;

      queueMicrotask(() => {
        dropLayerHandle.change(({ shapes }) => {
          shapes[id] = moved;
        });
      });
      shapeHandle.remove();

      focusHandle()?.change((doc) => {
        if (doc.selection?.[shapeHandle.url]) {
          delete doc.selection[shapeHandle.url];
          doc.selection[dropLayerHandle.sub("shapes", id).url] = true;
        }
      });

      dragShape.handle = dropLayerHandle.sub("shapes", id) as DocHandle<Shape>;
      dragShape.homeSurfaceUrl = dropSurfaceUrl;
      dragShape.homeScale = dropScale;
      dragShape.grabOffset = {
        x: grabOffset.x * ratio,
        y: grabOffset.y * ratio,
      };
    };

    const onSelectPress = async (pointer: SurfacePointer) => {
      const focus = focusHandle();
      if (!focus) return;

      const hit = pointer.shapeUrl;

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

      const current = focusHandle()?.doc()?.selection ?? {};
      let urls: AutomergeUrl[];
      if (current[hit]) {
        // Clicking an already-selected shape drags the whole selection.
        urls = Object.keys(current) as AutomergeUrl[];
      } else {
        urls = [hit];
        focus.change((doc) => {
          doc.selection = { [hit]: true };
        });
      }

      dragShapes = await resolveDragShapes(urls, pointer);
    };

    const onSelectRelease = async (pointer: SurfacePointer) => {
      const finished = dragShapes;
      dragShapes = null;
      if (!finished) return;
      applyMove(finished, pointer);
      await reparentDrag(finished, pointer);
    };

    // Idempotent: every surface's driver runs this off the shared selection,
    // so a repeated removal is a no-op rather than a throw.
    const deleteSelected = async (selected: Record<string, true>) => {
      for (const url of Object.keys(selected)) {
        try {
          const shapeHandle = await repo.find<Shape>(url as AutomergeUrl);
          if (shapeHandle.doc() === undefined) continue;
          shapeHandle.remove();
        } catch {
          // already gone
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftDown = true;
        return;
      }
      if (!active()) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const focus = focusHandle();
      const selected = focusHandle()?.doc()?.selection;
      if (!focus || !selected || Object.keys(selected).length === 0) return;
      event.preventDefault();
      void deleteSelected(selected);
      focus.change((doc) => {
        doc.selection = {};
      });
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftDown = false;
    };

    const onBlur = () => {
      shiftDown = false;
    };

    createEffect(async () => {
      const state = surfaceState();
      const pointer = state?.pointer;
      if (!pointer) return;

      if (state?.selectedToolId) {
        // A drawing tool is active: drop any drag and keep the pressed flag
        // current so falling back to select doesn't resume a stale drag.
        dragShapes = null;
        wasPressed = pointer.isPressed;
        return;
      }

      const isPressed = pointer.isPressed;
      const startedPress = !wasPressed && isPressed;
      const endedPress = wasPressed && !isPressed;
      // Update before any await so re-runs mid-handler see the new value.
      wasPressed = isPressed;

      if (startedPress) {
        // Only the surface that stamped the press begins the drag; from there
        // `dragShapes` keeps it the sole driver across surface boundaries.
        if (pointer.surfaceUrl === handle.url) await onSelectPress(pointer);
      } else if (endedPress) {
        await onSelectRelease(pointer);
      } else if (isPressed && dragShapes) {
        applyMove(dragShapes, pointer);
        void reparentDrag(dragShapes, pointer);
      }
    });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });

    // --- Pointer stamping + native drag-and-drop emulation.
    const positions = createPositionRegistry(root);
    onCleanup(() => positions.dispose());

    const getLocalPosition =
      toLocal ??
      ((clientX: number, clientY: number): Point => {
        const rect = root.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      });

    // Layer handles resolved so far, for synchronous hit detection. `null`
    // marks an in-flight find so each layer is fetched once.
    const layerHandles = new Map<
      AutomergeUrl,
      DocHandle<ShapeLayerDoc> | null
    >();

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

    let dragState: {
      downClient: { x: number; y: number };
      started: boolean;
      targetEl: Element | null;
      dropEffect: DropEffect;
    } | null = null;

    // Stamp a pointer sample onto the shared state. The innermost surface
    // under the cursor owns the event (it stops propagation). `clearDrag`
    // drops any payload on press; `finalizeDrag` records the drop outcome in
    // the same change so a source reads it on the same release.
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

    // Drive native drag events off a pressed move once a payload is present
    // and the threshold is crossed, so native dragover/drop listeners (incl.
    // this surface's embed handler) participate.
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

      // No capture: moves and the release must hit-test whatever surface is
      // under the cursor so cross-surface drags read their drop target.
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

      updatePointer(event, true, { clearDrag: true });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
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

    // Safety net for releases outside any surface: those never reach a surface
    // root, so clear the pressed flag and reject any in-progress drag here.
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

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DND_MEDIA_TYPE)) return;
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer?.getData(DND_MEDIA_TYPE);
      if (!data) return;

      // Innermost surface owns the drop, and don't let the browser navigate.
      event.stopPropagation();
      event.preventDefault();

      const items = parseDroppedItems(data);
      if (items.length === 0) return;

      const position = getLocalPosition(event.clientX, event.clientY);
      void createEmbeds(repo, handle, items, position, scale());
    };

    const onSubscribe = (event: SubscribeEvent) => {
      const selector = event.detail?.selector;

      if (selector?.type === "surface:state") {
        // Respond reactively so children pick up the inherited state once it
        // resolves rather than getting stuck on the fallback doc.
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
        // Decline (keep bubbling) when nothing in this subtree renders the url.
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

  // Fills the surface so this div is the hit target (layers/overlays are
  // pointer-events: none, and an unpositioned div has zero height here).
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

// One shape in the current select drag. `handle` is a sub-handle scoped to the
// shape inside its layer doc; both it and `homeSurfaceUrl` are rewritten in
// place when the drag crosses into another surface (see `rehome`).
type DragShape = {
  handle: DocHandle<Shape>;
  homeSurfaceUrl: AutomergeUrl;
  // Shape origin minus pointer-down position, in the home surface's space;
  // rescaled by the surface scale ratio when the drag crosses a boundary.
  grabOffset: Point;
  homeScale: number;
};

// The shared focus doc; keys are shape sub-document URLs.
type FocusDoc = {
  selection: Record<string, true>;
};

type SurfacePointer = NonNullable<SurfaceState["pointer"]>;

// Build a native drag event carrying a pointer drag payload, to dispatch at
// the element under the cursor. Values are only attached on the drop.
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
  // Some browsers ignore `dataTransfer` from the constructor; attach it back.
  if (!dragEvent.dataTransfer) {
    Object.defineProperty(dragEvent, "dataTransfer", { value: dataTransfer });
  }
  return dragEvent;
}

// The effect a target settled on when it accepted a drag, falling back to the
// negotiated value and finally to "copy".
function acceptedEffect(
  fromEvent: DropEffect | undefined,
  negotiated: DropEffect,
): DropEffect {
  if (fromEvent && fromEvent !== "none") return fromEvent;
  if (negotiated !== "none") return negotiated;
  return "copy";
}

// Drop one embed shape per item onto `surfaceHandle`, anchored at `at` and
// cascaded so multiple items don't stack exactly. The embed records
// `1 / surfaceScale` so its pixel footprint renders at a fixed on-screen size.
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

// The embed layer lives under the well-known `embed-shape-layer` key; create
// it on the first drop onto a surface that doesn't have one yet.
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
