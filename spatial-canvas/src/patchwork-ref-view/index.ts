import type { Repo } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { CanvasShape } from "../canvas/types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

/**
 * <patchwork-ref-view> — custom element that mounts a canvas shape tool.
 *
 * Accepts a `ref-url` attribute in the format `automerge:docId/path` pointing
 * to a shape entry inside a CanvasDoc. On each doc change it:
 *  1. Applies x, y, width, height, zIndex as inline layout styles.
 *  2. Looks up `canvas-{shape.type}` in the tool registry and mounts it.
 */
export class PatchworkRefViewElement extends HTMLElement {
  static observedAttributes = ["ref-url"];

  #repo: Repo | null = null;

  get repo(): Repo | null {
    return this.#repo;
  }

  set repo(value: Repo | null) {
    this.#repo = value;
    if (value) this.#mount();
  }

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
    if (!this.#refUrl || !this.#repo) return;

    const parsed = parseRefUrl(this.#refUrl);
    if (!parsed) return;

    const { docId, path } = parsed;
    const handle = await this.#repo.find(docId as any);

    if (!this.#refUrl) return; // teardown was called while awaiting

    const update = () => {
      const doc = handle.doc() as Record<string, any> | undefined;
      if (!doc) return;

      const shape = resolvePathInDoc(doc, path) as CanvasShape | undefined;
      if (!shape || typeof shape !== "object") return;

      applyLayout(this, shape);

      const toolId = `canvas-${shape.type}`;
      if (this.getAttribute("data-mounted-tool") !== toolId) {
        this.#mountTool(handle as any, toolId);
        this.setAttribute("data-mounted-tool", toolId);
      }
    };

    handle.on("change", update);
    this.#unsubscribe = () => handle.off("change", update);

    if (handle.doc()) update();
  }

  async #mountTool(handle: any, toolId: string) {
    this.#cleanup?.();
    this.#cleanup = null;
    this.innerHTML = "";

    const registry = getRegistry("patchwork:tool");
    const loaded = await registry.load(toolId);
    if (!loaded?.module) return;

    const cleanup = (loaded.module as any)(handle, this, this.#refUrl);
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

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-ref-view": Omit<Partial<PatchworkRefViewElement>, "style"> & {
        style?: string;
        [key: string]: unknown;
      };
      "patchwork-view": Omit<Partial<PatchworkViewElement>, "style"> & {
        style?: string;
        class?: string;
        "doc-url"?: string;
        "tool-id"?: string;
        [key: string]: unknown;
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseRefUrl = (refUrl: string): { docId: string; path: string[] } | null => {
  const withoutHeads = refUrl.split("#")[0];
  if (!withoutHeads.startsWith("automerge:")) return null;

  const rest = withoutHeads.slice("automerge:".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return null;

  const docId = "automerge:" + rest.slice(0, slashIdx);
  const path = rest
    .slice(slashIdx + 1)
    .split("/")
    .map(decodeURIComponent)
    .filter(Boolean);
  return { docId, path };
};

const resolvePathInDoc = (doc: Record<string, any>, path: string[]): unknown => {
  let cur: any = doc;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
};

const applyLayout = (el: HTMLElement, shape: Partial<CanvasShape> & Record<string, any>) => {
  el.style.position = "absolute";
  el.style.top = "0";
  el.style.left = "0";
  el.style.transform = `translate(${shape.x ?? 0}px, ${shape.y ?? 0}px)`;
  el.style.zIndex = shape.zIndex != null ? String(shape.zIndex) : "0";
  el.style.width = shape.width != null ? `${shape.width}px` : "";
  el.style.height = shape.height != null ? `${shape.height}px` : "";
};
