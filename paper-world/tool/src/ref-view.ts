import { findRef, Ref } from "./ref";
import type { Schema } from "./schema";
import type { Filesystem } from "./filesystem";
import type { PluginRegistry } from "./plugins";
import type { Repo } from "@automerge/automerge-repo";

console.log("ref-view.ts loaded");

const ATTR_VIEW = "view-url";
const ATTR_REF = "ref-url";

export type RefViewHostElement = HTMLElement & {
  readonly ref: Ref;
  readonly filesystem: Filesystem;
  readonly plugins: PluginRegistry;
  has(schema: Schema<unknown>): boolean;
  get<T>(schema: Schema<T>): Ref<T> | null;
  getOrCreate<T>(schema: Schema<T>): Ref<T>;
  findClosest(schema: Schema<unknown>): RefViewHostElement | null;
  findParent(schema: Schema<unknown>): RefViewHostElement | null;
  findRef(refUrl: string): Promise<Ref>;
};

type MountModule = {
  default: (element: RefViewHostElement) => void | (() => void);
};

type ViewDescriptor = {
  toolUrl?: string;
  [key: string]: unknown;
};

/**
 * Defines **`ref-view`** once, with `repo` and optional default `filesystem` closed over.
 */
export function registerRefView(
  repo: Repo,
  filesystem: Filesystem,
  pluginRegistry: PluginRegistry,
): void {
  if (customElements.get("ref-view")) return;

  class RefViewElement extends HTMLElement implements RefViewHostElement {
    #cleanup: (() => void) | null = null;
    #mountAbort: AbortController | null = null;
    #ref: Ref | null = null;
    #viewRef: Ref<string> | null = null;
    #viewUnsub: (() => void) | null = null;
    #folderCleanup: (() => void) | null = null;

    get filesystem(): Filesystem {
      return filesystem;
    }

    get plugins(): PluginRegistry {
      return pluginRegistry;
    }

    static get observedAttributes(): string[] {
      return [ATTR_VIEW, ATTR_REF];
    }

    get ref(): Ref {
      if (!this.#ref) throw new Error("ref-view: ref not ready (called before mount resolved)");
      return this.#ref;
    }

    has(schema: Schema<unknown>): boolean {
      if (schema.methods) {
        return schema.methods.every(
          (m) => typeof (this as unknown as Record<string, unknown>)[m] === "function"
        );
      }
      if (!this.#ref) return false;
      const target = schema.namespace ? this.#ref.at(schema.namespace) : this.#ref;
      if (!target.has()) return false;
      try {
        schema.parse(target.value());
        return true;
      } catch {
        return false;
      }
    }

    get<T>(schema: Schema<T>): Ref<T> | null {
      if (!this.#ref) return null;
      const target = schema.namespace ? this.#ref.at(schema.namespace) : this.#ref;
      if (!target.has()) return null;
      return target as unknown as Ref<T>;
    }

    getOrCreate<T>(schema: Schema<T>): Ref<T> {
      if (!this.#ref) throw new Error("ref-view: cannot getOrCreate before ref is resolved");
      const target = schema.namespace ? this.#ref.at(schema.namespace) : this.#ref;
      if (!target.has()) {
        target.change((() => schema.init()) as unknown as () => void);
      }
      return target as unknown as Ref<T>;
    }

    findClosest(schema: Schema<unknown>): RefViewHostElement | null {
      if (this.has(schema)) return this as RefViewHostElement;
      const parent = parentRefView(this as unknown as HTMLElement);
      if (!parent) return null;
      return parent.findClosest(schema);
    }

    findParent(schema: Schema<unknown>): RefViewHostElement | null {
      const parent = parentRefView(this as unknown as HTMLElement);
      if (!parent) return null;
      return parent.findClosest(schema);
    }

    findRef(refUrl: string): Promise<Ref> {
      return findRef(repo, refUrl);
    }

    get viewUrl(): string {
      return this.getAttribute(ATTR_VIEW) ?? "";
    }

    set viewUrl(value: string | Ref<string> | null | undefined) {
      if (value instanceof Ref) {
        this.#viewRef = value as Ref<string>;
        this.removeAttribute(ATTR_VIEW);
        if (this.isConnected) this.#scheduleMount();
        return;
      }
      this.#viewRef = null;
      const v = value == null ? "" : String(value);
      const cur = this.getAttribute(ATTR_VIEW) ?? "";
      if (v === cur) return;
      if (v === "") this.removeAttribute(ATTR_VIEW);
      else this.setAttribute(ATTR_VIEW, v);
    }

    get refUrl(): string {
      return this.getAttribute(ATTR_REF) ?? "";
    }

    set refUrl(value: string | null | undefined) {
      const v = value == null ? "" : String(value);
      const cur = this.getAttribute(ATTR_REF) ?? "";
      if (v === cur) return;
      if (v === "") this.removeAttribute(ATTR_REF);
      else this.setAttribute(ATTR_REF, v);
    }

    connectedCallback(): void {
      this.#scheduleMount();
    }

    disconnectedCallback(): void {
      this.#mountAbort?.abort();
      this.#mountAbort = null;
      this.#teardown();
    }

    attributeChangedCallback(_name: string, oldVal: string, newVal: string): void {
      if (oldVal === newVal || !this.isConnected) return;
      this.#scheduleMount();
    }

    #scheduleMount(): void {
      this.#mountAbort?.abort();
      const ac = new AbortController();
      this.#mountAbort = ac;
      const { signal } = ac;
      queueMicrotask(() => {
        if (!this.isConnected || signal.aborted) return;
        void this.#mount(signal);
      });
    }

    #teardown(): void {
      this.#ref = null;
      if (this.#viewUnsub) {
        this.#viewUnsub();
        this.#viewUnsub = null;
      }
      if (this.#folderCleanup) {
        this.#folderCleanup();
        this.#folderCleanup = null;
      }
      if (this.#cleanup) {
        try {
          this.#cleanup();
        } catch {
          // ignore cleanup errors
        }
        this.#cleanup = null;
      }
    }

    #stale(signal: AbortSignal): boolean {
      return signal.aborted || !this.isConnected;
    }

    #showError(err: unknown): void {
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.textContent =
        err instanceof Error ? `ref-view: ${err.message}` : `ref-view: ${String(err)}`;
      this.appendChild(pre);
    }

    async #mount(signal: AbortSignal): Promise<void> {
      this.#teardown();
      const refUrl = this.refUrl;
      if (!refUrl) {
        this.replaceChildren();
        return;
      }

      let viewUrl: string;
      if (this.#viewRef) {
        const val = this.#viewRef.value();
        if (typeof val !== "string" || !val) {
          this.replaceChildren();
          return;
        }
        viewUrl = val;

        let current = viewUrl;
        this.#viewUnsub = this.#viewRef.subscribe((newVal) => {
          const newUrl = typeof newVal === "string" ? newVal : "";
          if (newUrl && newUrl !== current) {
            current = newUrl;
            this.#scheduleMount();
          }
        });
      } else {
        viewUrl = this.viewUrl;
        if (!viewUrl) {
          this.replaceChildren();
          return;
        }
      }

      this.replaceChildren();

      try {
        const ref = await findRef(repo, refUrl);
        if (this.#stale(signal)) return;

        this.#ref = ref;

        const toolUrl = await resolveToolUrlFromView(filesystem, viewUrl);
        if (this.#stale(signal)) return;

        const resolvedToolUrl = await filesystem.resolveToolUrl(toolUrl);
        if (this.#stale(signal)) return;

        const viewParts = viewUrl.split("/");
        const watchPath = viewParts.length > 1 ? viewParts[0] : viewUrl;
        const folderHandle = await filesystem.getDocHandle(watchPath);
        if (this.#stale(signal)) return;

        let lastResolvedUrl = resolvedToolUrl;
        let lastHeads = folderHandle.heads().join("|");
        const onFolderChange = () => {
          const newHeads = folderHandle.heads().join("|");
          const headsChanged = newHeads !== lastHeads;
          if (!headsChanged) return;
          lastHeads = newHeads;
          void (async () => {
            try {
              const newToolUrl = await resolveToolUrlFromView(filesystem, viewUrl);
              const newUrl = await filesystem.resolveToolUrl(newToolUrl);
              if (newUrl !== lastResolvedUrl) {
                lastResolvedUrl = newUrl;
                this.#scheduleMount();
              }
            } catch {
              // ignore resolution errors during change detection
            }
          })();
        };
        folderHandle.on("change", onFolderChange);
        this.#folderCleanup = () => folderHandle.off("change", onFolderChange);

        const mod = (await import(/* @vite-ignore */ resolvedToolUrl)) as MountModule;
        if (this.#stale(signal)) return;

        const fn = mod.default;
        if (typeof fn !== "function") {
          throw new TypeError("module default export must be a function (element) => cleanup?");
        }

        const dispose = fn(this);
        if (this.#stale(signal)) {
          if (typeof dispose === "function") dispose();
          return;
        }

        this.#cleanup = typeof dispose === "function" ? dispose : null;
        this.dispatchEvent(new Event("mounted", { bubbles: true }));
      } catch (err) {
        if (this.#stale(signal)) return;
        this.#showError(err);
      }
    }
  }

  customElements.define("ref-view", RefViewElement);
}

function parentRefView(el: HTMLElement): RefViewHostElement | null {
  const host = el.parentElement?.closest("ref-view");
  return (host as RefViewHostElement | null) ?? null;
}

async function resolveToolUrlFromView(filesystem: Filesystem, viewUrl: string): Promise<string> {
  if (!viewUrl.endsWith(".json")) {
    return viewUrl;
  }
  const raw = await filesystem.readFile(viewUrl);
  const descriptor: ViewDescriptor = JSON.parse(raw);
  if (!descriptor.toolUrl) {
    throw new Error(`view descriptor ${viewUrl} has no toolUrl`);
  }
  const folderPath = viewUrl.includes("/") ? viewUrl.slice(0, viewUrl.lastIndexOf("/")) : "";
  return folderPath ? `${folderPath}/${descriptor.toolUrl}` : descriptor.toolUrl;
}
