import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { CanvasDoc, CanvasShape, Rect } from "../types.js";
import { PatchworkRefViewElement } from "../patchwork-ref-view.js";

export class ShapeRenderLayer {
  #handle: DocHandle<CanvasDoc>;
  #element: HTMLElement;
  #repo: Repo;

  #views = new Map<string, PatchworkRefViewElement>();
  #bboxCache = new Map<string, DOMRect>();
  #prevShapes = new Map<string, CanvasShape>();

  #offDocChange: () => void;

  constructor(handle: DocHandle<CanvasDoc>, element: HTMLElement, repo: Repo) {
    this.#handle = handle;
    this.#element = element;
    this.#repo = repo;

    element.style.cssText = "position:absolute;inset:0;pointer-events:none;";

    if (!customElements.get("patchwork-ref-view")) {
      customElements.define("patchwork-ref-view", PatchworkRefViewElement);
    }

    const onDocChange = ({ doc }: { doc: CanvasDoc }) => this.#onDocChange(doc);
    handle.on("change", onDocChange);
    this.#offDocChange = () => handle.off("change", onDocChange);

    const initial = handle.doc();
    if (initial) this.#syncViews(initial);
  }

  // ---------------------------------------------------------------------------
  // Public: hit-test
  // ---------------------------------------------------------------------------

  shapesAtPoint(screenX: number, screenY: number): CanvasShape[] {
    const doc = this.#handle.doc();
    if (!doc) return [];

    const seen = new Set<string>();
    const result: CanvasShape[] = [];

    for (const el of document.elementsFromPoint(screenX, screenY)) {
      let node: Element | null = el;
      while (node) {
        const id = (node as HTMLElement).dataset?.shapeId;
        if (id && !seen.has(id)) {
          seen.add(id);
          const shape = doc.shapes[id];
          if (shape) result.push(shape);
          break;
        }
        node = node.parentElement;
      }
    }

    return result;
  }

  shapesOverlapping(screenRect: Rect): CanvasShape[] {
    const doc = this.#handle.doc();
    if (!doc) return [];

    const result: CanvasShape[] = [];

    for (const [id, view] of this.#views) {
      const bbox = this.#getBbox(id, view);
      if (rectsIntersect(screenRect, bbox)) {
        const shape = doc.shapes[id];
        if (shape) result.push(shape);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Public: camera notifications (bbox cache only, no culling yet)
  // ---------------------------------------------------------------------------

  notifyCameraChanged() {
    this.#bboxCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Public: cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    this.#offDocChange();
    for (const view of this.#views.values()) view.remove();
    this.#views.clear();
    this.#bboxCache.clear();
    this.#prevShapes.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  #onDocChange(doc: CanvasDoc) {
    this.#syncViews(doc);

    // Evict bbox cache for changed shapes
    for (const [id, shape] of Object.entries(doc.shapes)) {
      if (this.#prevShapes.get(id) !== shape) {
        this.#bboxCache.delete(id);
        this.#prevShapes.set(id, shape);
      }
    }

    // Clean up deleted shapes
    for (const id of this.#prevShapes.keys()) {
      if (!doc.shapes[id]) {
        this.#prevShapes.delete(id);
        this.#bboxCache.delete(id);
      }
    }
  }

  #syncViews(doc: CanvasDoc) {
    const currentIds = new Set(Object.keys(doc.shapes));

    for (const [id, view] of this.#views) {
      if (!currentIds.has(id)) {
        view.remove();
        this.#views.delete(id);
      }
    }

    for (const id of currentIds) {
      if (!this.#views.has(id)) {
        const view = document.createElement("patchwork-ref-view") as PatchworkRefViewElement;
        view.style.cssText = "position:absolute;top:0;left:0;pointer-events:auto;";
        view.dataset.shapeId = id;
        view.repo = this.#repo;
        view.setAttribute("ref-url", `${this.#handle.url}/shapes/${id}`);
        this.#element.appendChild(view);
        this.#views.set(id, view);
        this.#prevShapes.set(id, doc.shapes[id]);
      }
    }
  }

  #getBbox(id: string, view: PatchworkRefViewElement): DOMRect {
    let cached = this.#bboxCache.get(id);
    if (!cached) {
      cached = view.getBoundingClientRect();
      if (cached.width > 0 || cached.height > 0) {
        this.#bboxCache.set(id, cached);
      }
    }
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rectsIntersect = (a: Rect | DOMRect, b: Rect | DOMRect): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
