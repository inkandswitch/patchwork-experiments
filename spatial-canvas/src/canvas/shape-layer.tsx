import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { For, onCleanup } from "solid-js";
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";
import type { CanvasDoc, CanvasShape, Rect } from "./types.js";

export type ShapeLayerAPI = {
  shapesAtPoint(screenX: number, screenY: number): CanvasShape[];
  shapesOverlapping(screenRect: Rect): CanvasShape[];
  notifyCameraChanged(): void;
};

type Props = {
  handle: DocHandle<CanvasDoc>;
  repo: Repo;
  ref?: (api: ShapeLayerAPI) => void;
};

export function ShapeRenderLayer(props: Props) {
  const doc = makeDocumentProjection(props.handle);
  const viewRefs = new Map<string, HTMLElement>();
  const bboxCache = new Map<string, DOMRect>();

  const api: ShapeLayerAPI = {
    shapesAtPoint(screenX, screenY) {
      const currentDoc = props.handle.doc();
      if (!currentDoc) return [];

      const seen = new Set<string>();
      const result: CanvasShape[] = [];

      for (const el of document.elementsFromPoint(screenX, screenY)) {
        let node: Element | null = el;
        while (node) {
          if (node.tagName.toLowerCase() === "patchwork-ref-view") {
            const id = shapeIdFromRefUrl(node.getAttribute("ref-url") ?? "");
            if (id && !seen.has(id)) {
              seen.add(id);
              const shape = currentDoc.shapes[id];
              if (shape) result.push(shape);
            }
            break;
          }
          node = node.parentElement;
        }
      }
      return result;
    },

    shapesOverlapping(screenRect) {
      const currentDoc = props.handle.doc();
      if (!currentDoc) return [];

      const result: CanvasShape[] = [];
      for (const [id, view] of viewRefs) {
        const bbox = getBbox(id, view, bboxCache);
        if (rectsIntersect(screenRect, bbox)) {
          const shape = currentDoc.shapes[id];
          if (shape) result.push(shape);
        }
      }
      return result;
    },

    notifyCameraChanged() {
      bboxCache.clear();
    },
  };

  props.ref?.(api);

  return (
    <For each={Object.keys(doc.shapes ?? {})}>
      {(id) => {
        onCleanup(() => {
          viewRefs.delete(id);
          bboxCache.delete(id);
        });
        return (
          <patchwork-ref-view
            style="position:absolute;top:0;left:0;pointer-events:auto;"
            ref={(el: HTMLElement) => {
              (el as any).repo = props.repo;
              viewRefs.set(id, el);
            }}
            attr:ref-url={`${props.handle.url}/shapes/${id}`}
          />
        );
      }}
    </For>
  );
}

function shapeIdFromRefUrl(refUrl: string): string | null {
  const parts = refUrl.split("/");
  return parts.length >= 2 ? decodeURIComponent(parts[parts.length - 1]) : null;
}

function getBbox(id: string, view: HTMLElement, cache: Map<string, DOMRect>): DOMRect {
  let cached = cache.get(id);
  if (!cached) {
    cached = view.getBoundingClientRect();
    if (cached.width > 0 || cached.height > 0) {
      cache.set(id, cached);
    }
  }
  return cached ?? new DOMRect();
}

function rectsIntersect(a: Rect | DOMRect, b: Rect | DOMRect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}
