import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocumentProjection,
  useRepo,
} from "../vendor/automerge-solid-primitives";
import { accept, type SubscribeEvent } from "../vendor/providers";
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
  type Point,
  type Shape,
  type ShapeLayerDoc,
  SurfaceState,
} from "./types";
import { subscribeDoc } from "../vendor/providers-solid";
import { createPositionRegistry, positionOfUrl } from "./position";
import { createLayerIndex, topmostShapeAt, type LayerIndex } from "./layers";
import type { EmbedShape } from "../embed/EmbedLayerTool";

const DND_MEDIA_TYPE = "text/x-patchwork-dnd";

const EMBED_WIDTH = 320;
const EMBED_HEIGHT = 240;
const EMBED_CASCADE = 24;

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
  const surfaceUrl = handle.url;

  // ----- Shared pointer state -------------------------------------------------
  // Every surface stamps the one shared `SurfaceState` doc. A child inherits it
  // from the nearest ancestor surface via `surface:state`; only the root
  // surface (no ancestor surface in the DOM) owns one, so nested surfaces never
  // mint throwaway state.
  const [, _stateHandle] = subscribeDoc<SurfaceState>(() => root, {
    type: "surface:state",
  });
  const [ownState, setOwnState] = createSignal<DocHandle<SurfaceState>>();
  const stateHandle = createMemo(() => _stateHandle() ?? ownState());
  const surfaceState = createDocumentProjection<SurfaceState>(stateHandle);

  // Shape layers resolved and kept in memory so pointer hit-testing stays
  // synchronous (used by updatePointer and the drag controller below).
  const layerIndex = createLayerIndex(repo, handle);
  onCleanup(() => layerIndex.dispose());

  // ----- Dragging shapes ------------------------------------------------------
  // A drag is owned by the surface it starts in. When a press lands on a shape
  // in *this* surface, this effect owns the whole gesture: the shape follows
  // the cursor and, the moment the cursor crosses into another surface, the
  // shape's document is reparented into that surface's matching layer. All drag
  // bookkeeping is local; nothing about the in-progress drag is published.
  //
  // Reparenting changes the shape's automerge url (its layer document changes),
  // so links/selection pointing at a shape break when it is moved across
  // surfaces. That is accepted for now; same-surface drags never reparent.
  let drag: DragState | null = null;
  let wasPressed = false;

  createEffect(async () => {
    const state = surfaceState();
    const pointer = state?.pointer;
    if (!state || !pointer) {
      wasPressed = false;
      return;
    }

    // Snapshot the sample synchronously before the reparent await below so the
    // transition logic can't be confused by a newer pointer arriving mid-move.
    const selectMode = !state.selectedToolId;
    const isPressed = pointer.isPressed;
    const pointerSurfaceUrl = pointer.surfaceUrl;
    const shapeUrl = pointer.shapeUrl;
    const position: Point = { x: pointer.position.x, y: pointer.position.y };
    const pointerScale = pointer.scale;

    const startedDrag = !wasPressed && isPressed;
    const endedDrag = wasPressed && !isPressed;
    wasPressed = isPressed;

    if (startedDrag) {
      // A new press supersedes any prior drag. Select is the default
      // interaction (no tool selected); only the surface the press landed on,
      // and only on a shape, claims the drag.
      drag =
        selectMode && pointerSurfaceUrl === surfaceUrl && shapeUrl
          ? beginDrag(layerIndex, surfaceUrl, shapeUrl, position, pointerScale)
          : null;
      return;
    }

    if (!drag) return;

    if (endedDrag) {
      drag = null;
      return;
    }

    if (!isPressed) return;

    // Crossed a surface boundary: move the document into the new surface's
    // matching layer before repositioning.
    if (pointerSurfaceUrl !== drag.surfaceUrl) {
      const moved = await reparent(repo, drag, pointerSurfaceUrl);
      if (moved) drag = moved;
    }

    moveShape(drag, position, pointerScale);
  });

  onMount(() => {
    // Only the root surface (no ancestor surface answers `surface:state`) mints
    // its own state doc; nested surfaces read the inherited one.
    if (!root.parentElement?.closest("[data-surface]")) {
      setOwnState(repo.create<SurfaceState>());
    }
    if (onMounted) onMounted();

    const positions = createPositionRegistry(root);
    onCleanup(() => positions.dispose());

    const getLocalPosition =
      toLocal ??
      ((clientX: number, clientY: number): Point => {
        const rect = root.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
      });

    // ----- Generic pointer logic ----------------------------------------------
    // Stamp a pointer sample onto the shared state. The innermost surface under
    // the cursor owns the event (it stops propagation).
    const updatePointer = (event: PointerEvent, isPressed: boolean) => {
      const sharedState = stateHandle();
      if (!sharedState) return;
      const position = getLocalPosition(event.clientX, event.clientY);
      const shapeUrl = topmostShapeAt(
        layerIndex.layers(),
        position.x,
        position.y,
      );
      const currentScale = scale();
      sharedState.change((state) => {
        state.pointer = {
          position,
          surfaceUrl,
          isPressed,
          scale: currentScale,
          ...(shapeUrl ? { shapeUrl } : {}),
        };
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.stopPropagation();

      // No capture: moves and the release must hit-test whatever surface is
      // under the cursor so cross-surface drags read their drop target.
      const target = event.target as Element;
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }

      updatePointer(event, true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.stopPropagation();
      const isPressed = (event.buttons & 1) === 1;
      updatePointer(event, isPressed);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.stopPropagation();
      updatePointer(event, false);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      event.stopPropagation();
      updatePointer(event, false);
    };

    // Safety net for releases outside any surface: those never reach a surface
    // root, so clear the pressed flag here.
    const onWindowPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      stateHandle()?.change((state) => {
        if (state.pointer?.isPressed) state.pointer.isPressed = false;
      });
    };

    // ----- Native drag & drop -------------------------------------------------
    // Drop external items (a `text/x-patchwork-dnd` payload) onto the surface
    // as embeds.
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

    // ----- Provider protocol --------------------------------------------------
    // Answer descendants asking for the shared state doc and for the screen
    // positions of shapes rendered in this subtree.
    const onSubscribe = (event: SubscribeEvent) => {
      const selector = event.detail?.selector;

      if (selector?.type === "surface:state") {
        // Respond reactively so children pick up the doc once it resolves.
        accept<AutomergeUrl>(event, (respond) =>
          createRoot((dispose) => {
            createEffect(() => {
              const sharedState = stateHandle();
              if (sharedState) respond(sharedState.url);
            });
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
      data-surface=""
      style={{ position: "absolute", inset: "0", "pointer-events": "auto" }}
    >
      {children}
    </div>
  );
}

// The live drag: which shape (its layer handle + key in the map), which surface
// it currently lives in, and the grab offset in screen pixels (so it survives
// crossing into a surface drawn at a different scale).
type DragState = {
  layerHandle: DocHandle<ShapeLayerDoc>;
  id: string;
  layerKey: string;
  surfaceUrl: AutomergeUrl;
  grabScreen: Point;
};

// Resolve the pressed shape through the surface's layer index and capture the
// grab offset. Synchronous: the layer was already resolved to hit-test the
// shape under the pointer. Returns null if the shape can't be found (the press
// then does nothing).
function beginDrag(
  index: LayerIndex,
  surfaceUrl: AutomergeUrl,
  shapeUrl: AutomergeUrl,
  position: Point,
  pointerScale: number,
): DragState | null {
  const parts = shapeUrl.split("/");
  if (parts.length < 3 || parts[1] !== "shapes") return null;
  const layerUrl = parts[0] as AutomergeUrl;
  const id = parts[2];

  const layer = index.layers().find((entry) => entry.url === layerUrl);
  const shape = layer?.handle.doc()?.shapes[id];
  if (!layer || !shape) return null;

  // (cursor - anchor) is a local offset; scale it to screen pixels so the grab
  // survives crossing into a surface drawn at a different scale.
  const grabScreen: Point = {
    x: (position.x - shape.x) * pointerScale,
    y: (position.y - shape.y) * pointerScale,
  };

  return {
    layerHandle: layer.handle,
    id,
    layerKey: layer.key,
    surfaceUrl,
    grabScreen,
  };
}

// Write the shape's anchor so the cursor keeps the grab offset, converting the
// screen-space offset back into the current surface's local units.
function moveShape(
  drag: DragState,
  position: Point,
  pointerScale: number,
): void {
  const offset: Point = {
    x: drag.grabScreen.x / pointerScale,
    y: drag.grabScreen.y / pointerScale,
  };
  drag.layerHandle.change(({ shapes }) => {
    const shape = shapes[drag.id];
    if (!shape) return;
    shape.x = position.x - offset.x;
    shape.y = position.y - offset.y;
  });
}

// Move the shape's value out of its current layer and into the matching layer
// on `targetSurfaceUrl` (created on demand), landing on top. Returns the new
// drag state, or null when the move is refused (e.g. a surface dropped into
// itself) so the caller keeps driving the shape in its current layer.
async function reparent(
  repo: Repo,
  drag: DragState,
  targetSurfaceUrl: AutomergeUrl,
): Promise<DragState | null> {
  const source = drag.layerHandle.doc()?.shapes[drag.id];
  if (!source) return null;

  // A surface embed can't be dropped into itself or anything nested inside it,
  // or the document would contain itself.
  const embeddedUrl = (source as EmbedShape).docUrl;
  if (
    embeddedUrl &&
    (await isSelfOrDescendant(repo, embeddedUrl, targetSurfaceUrl))
  ) {
    return null;
  }

  const targetLayer = await getOrCreateLayer(
    repo,
    targetSurfaceUrl,
    drag.layerKey,
  );
  if (!targetLayer) return null;

  const value = structuredClone(source) as Shape;
  const newId = crypto.randomUUID();
  value.id = newId;
  targetLayer.change(({ shapes }) => {
    const top = Object.values(shapes).reduce(
      (m, s) => Math.max(m, s.z ?? 0),
      0,
    );
    value.z = top + 1;
    shapes[newId] = value;
  });
  drag.layerHandle.change(({ shapes }) => {
    delete shapes[drag.id];
  });

  return {
    ...drag,
    layerHandle: targetLayer,
    id: newId,
    surfaceUrl: targetSurfaceUrl,
  };
}

// The `layerKey` layer on a surface, created (and linked into the surface) if
// it doesn't exist yet — mirrors the layer tools' lazy layer creation.
async function getOrCreateLayer(
  repo: Repo,
  surfaceUrl: AutomergeUrl,
  layerKey: string,
): Promise<DocHandle<ShapeLayerDoc> | null> {
  try {
    const surface = await repo.find<DocWithLayers>(surfaceUrl);
    const existing = surface.doc()?.layers[layerKey];
    if (existing) return repo.find<ShapeLayerDoc>(existing);

    const layer = await repo.create2<ShapeLayerDoc>({
      "@patchwork": { type: "shape-layer" },
      title: titleForLayerKey(layerKey),
      shapes: {},
    });
    surface.change((s) => {
      s.layers[layerKey] = layer.url;
    });
    return layer;
  } catch {
    return null;
  }
}

// Whether `candidateUrl` is `rootSurfaceUrl` or a surface nested anywhere
// inside it, walking the embed shapes down the tree.
async function isSelfOrDescendant(
  repo: Repo,
  rootSurfaceUrl: AutomergeUrl,
  candidateUrl: AutomergeUrl,
): Promise<boolean> {
  if (rootSurfaceUrl === candidateUrl) return true;

  const visited = new Set<string>();
  const queue: AutomergeUrl[] = [rootSurfaceUrl];
  while (queue.length > 0) {
    const surfaceUrl = queue.shift()!;
    if (visited.has(surfaceUrl)) continue;
    visited.add(surfaceUrl);

    let surface: DocHandle<DocWithLayers>;
    try {
      surface = await repo.find<DocWithLayers>(surfaceUrl);
    } catch {
      continue;
    }

    for (const layerUrl of Object.values(surface.doc()?.layers ?? {})) {
      let layer: DocHandle<ShapeLayerDoc>;
      try {
        layer = await repo.find<ShapeLayerDoc>(layerUrl);
      } catch {
        continue;
      }
      for (const shape of Object.values(layer.doc()?.shapes ?? {})) {
        const childUrl = (shape as EmbedShape).docUrl;
        if (!childUrl) continue;
        if (childUrl === candidateUrl) return true;
        queue.push(childUrl);
      }
    }
  }
  return false;
}

function titleForLayerKey(layerKey: string): string {
  switch (layerKey) {
    case "rect-shape-layer":
      return "Rectangles";
    case "line-shape-layer":
      return "Lines";
    case "embed-shape-layer":
      return "Embed";
    default:
      return "Shapes";
  }
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
