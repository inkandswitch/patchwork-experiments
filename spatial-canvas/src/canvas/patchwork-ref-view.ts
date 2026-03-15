import type { Repo } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { CanvasShape } from "./types.js";

/**
 * PatchworkRefViewElement — the <patchwork-ref-view> custom element.
 *
 * Accepts a `ref-url` attribute in the format `automerge:docId/path` (a RefUrl
 * pointing to a shape entry inside a CanvasDoc). It:
 *
 *  1. Parses the docId and path out of the ref URL.
 *  2. Watches the document for changes to the value at that path.
 *  3. Applies x, y, width, height, zIndex from the shape value as its own
 *     inline layout styles (position:absolute etc.) — shape tools never touch
 *     layout.
 *  4. Looks up `canvas-{shape.type}` in the patchwork tool registry and mounts
 *     that tool, passing the canvas DocHandle and this element as the mount
 *     point.
 *
 * The `repo` property must be set before (or immediately after) `ref-url` is
 * set. In practice the generic shape layer sets it before appending.
 */
export class PatchworkRefViewElement extends HTMLElement {
  static observedAttributes = ["ref-url"];

  repo: Repo | null = null;

  #refUrl: string | null = null;
  #cleanup: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "ref-url") {
      this.#refUrl = value;
      this.#mount();
    }
  }

  connectedCallback() {
    if (this.#refUrl) this.#mount();
  }

  disconnectedCallback() {
    this.#teardown();
  }

  async #mount() {
    this.#teardown();
    if (!this.#refUrl || !this.repo) {
      console.warn("[patchwork-ref-view] #mount: missing refUrl or repo", { refUrl: this.#refUrl, hasRepo: !!this.repo });
      return;
    }

    const parsed = parseRefUrl(this.#refUrl);
    if (!parsed) {
      console.warn("[patchwork-ref-view] #mount: failed to parse ref-url", this.#refUrl);
      return;
    }

    const { docId, path } = parsed;
    console.log("[patchwork-ref-view] #mount: finding doc", { docId, path });
    const handle = await this.repo.find(docId as any);

    // Abort if teardown was called while we were awaiting
    if (!this.#refUrl) {
      console.log("[patchwork-ref-view] #mount: aborted (teardown during await)");
      return;
    }

    const update = () => {
      const doc = handle.doc() as Record<string, any> | undefined;
      if (!doc) {
        console.warn("[patchwork-ref-view] update: doc not ready yet");
        return;
      }

      const shape = resolvePathInDoc(doc, path) as CanvasShape | undefined;
      if (!shape || typeof shape !== "object") {
        console.warn("[patchwork-ref-view] update: shape not found at path", path, "doc.shapes keys:", Object.keys((doc as any).shapes ?? {}));
        return;
      }

      console.log("[patchwork-ref-view] update: shape found", { type: shape.type, x: shape.x, y: shape.y, w: (shape as any).width, h: (shape as any).height });
      applyLayout(this, shape);

      const toolId = `canvas-${shape.type}`;
      const existing = this.getAttribute("data-mounted-tool");
      if (existing !== toolId) {
        console.log("[patchwork-ref-view] mounting tool", toolId);
        this.#mountTool(handle as any, toolId);
        this.setAttribute("data-mounted-tool", toolId);
      }
    };

    handle.on("change", update);
    this.#unsubscribe = () => handle.off("change", update);

    // Seed immediately if the doc is already available
    if (handle.doc()) update();
    else console.warn("[patchwork-ref-view] doc not ready after find, waiting for change event");
  }

  async #mountTool(handle: any, toolId: string) {
    if (this.#cleanup) {
      this.#cleanup();
      this.#cleanup = null;
    }
    this.innerHTML = "";

    const registry = getRegistry("patchwork:tool");
    console.log("[patchwork-ref-view] #mountTool: loading", toolId);
    const loaded = await registry.load(toolId);
    if (!loaded?.module) {
      console.error("[patchwork-ref-view] #mountTool: tool not found in registry:", toolId, "available ids:", registry.filter(() => true).map((p: any) => p.id));
      return;
    }

    console.log("[patchwork-ref-view] #mountTool: mounting", toolId);
    const cleanup = (loaded.module as any)(handle, this);
    if (typeof cleanup === "function") this.#cleanup = cleanup;
  }

  #teardown() {
    this.#cleanup?.();
    this.#cleanup = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.innerHTML = "";
    this.removeAttribute("data-mounted-tool");
  }
}

if (!customElements.get("patchwork-ref-view")) {
  customElements.define("patchwork-ref-view", PatchworkRefViewElement);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a RefUrl of the form `automerge:docId/seg1/seg2/...` into its
 * document id and path segments. The `#heads` suffix is stripped.
 */
function parseRefUrl(refUrl: string): { docId: string; path: string[] } | null {
  // Strip optional #heads suffix
  const withoutHeads = refUrl.split("#")[0];

  // Must start with automerge:
  if (!withoutHeads.startsWith("automerge:")) return null;

  const rest = withoutHeads.slice("automerge:".length);
  const slashIdx = rest.indexOf("/");

  if (slashIdx === -1) {
    // Just a plain AutomergeUrl with no path — not a ref
    return null;
  }

  const docId = "automerge:" + rest.slice(0, slashIdx);
  const pathStr = rest.slice(slashIdx + 1);
  const path = pathStr.split("/").map(decodeURIComponent).filter(Boolean);

  return { docId, path };
}

/**
 * Walk a plain object along `path` and return the value, or undefined.
 */
function resolvePathInDoc(doc: Record<string, any>, path: string[]): unknown {
  let cur: any = doc;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Apply canvas layout fields from a shape value as inline styles on the element.
 * The shape tool is responsible only for visual content — never layout.
 */
function applyLayout(el: HTMLElement, shape: Partial<CanvasShape> & Record<string, any>) {
  el.style.position = "absolute";
  el.style.top = "0";
  el.style.left = "0";
  el.style.transform = `translate(${shape.x ?? 0}px, ${shape.y ?? 0}px)`;
  el.style.zIndex = shape.zIndex != null ? String(shape.zIndex) : "0";

  if (shape.width != null) {
    el.style.width = `${shape.width}px`;
  } else {
    el.style.width = "";
  }

  if (shape.height != null) {
    el.style.height = `${shape.height}px`;
  } else {
    el.style.height = "";
  }
}
