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
  type Point,
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

    // --- Pointer stamping + native drop-to-embed handling.
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

    // Stamp a pointer sample onto the shared state. The innermost surface
    // under the cursor owns the event (it stops propagation).
    const updatePointer = (event: PointerEvent, isPressed: boolean) => {
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
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;

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
      const isPressed = (event.buttons & 1) === 1;
      updatePointer(event, isPressed);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      updatePointer(event, false);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      updatePointer(event, false);
    };

    // Safety net for releases outside any surface: those never reach a surface
    // root, so clear the pressed flag here.
    const onWindowPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return;

      stateHandle().change((state) => {
        const p = state.pointer;
        if (!p?.isPressed) return;
        p.isPressed = false;
      });
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
      data-surface=""
      style={{ position: "absolute", inset: "0", "pointer-events": "auto" }}
    >
      {children}
    </div>
  );
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
