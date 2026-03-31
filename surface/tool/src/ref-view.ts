import { findRef, Ref } from "./ref";
import type { Schema } from "./schema";
import type { Filesystem } from "./filesystem";
import type { PluginRegistry } from "./plugins";
import type { Repo } from "@automerge/automerge-repo";

console.log("ref-view.ts loaded");

const ATTR_TOOL = "tool-url";
const ATTR_REF = "ref-url";

export type RefViewHostElement = HTMLElement & {
  readonly ref: Ref;
  readonly parent: RefViewHostElement | null;
  readonly filesystem: Filesystem;
  readonly plugins: PluginRegistry;
};

type MountModule = {
  default: (element: RefViewHostElement) => void | (() => void);
  schema?: Schema<unknown>;
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
    #toolRef: Ref<string> | null = null;
    #toolUnsub: (() => void) | null = null;
    #folderCleanup: (() => void) | null = null;

    get filesystem(): Filesystem {
      return filesystem;
    }

    get plugins(): PluginRegistry {
      return pluginRegistry;
    }

    static get observedAttributes(): string[] {
      return [ATTR_TOOL, ATTR_REF];
    }

    get ref(): Ref {
      if (!this.#ref) throw new Error("ref-view: ref not ready (called before mount resolved)");
      return this.#ref;
    }

    get parent(): RefViewElement | null {
      const host = this.parentElement?.closest("ref-view");
      return (host as RefViewElement | null) ?? null;
    }

    get toolUrl(): string {
      return this.getAttribute(ATTR_TOOL) ?? "";
    }

    set toolUrl(value: string | Ref<string> | null | undefined) {
      if (value instanceof Ref) {
        this.#toolRef = value as Ref<string>;
        this.removeAttribute(ATTR_TOOL);
        if (this.isConnected) this.#scheduleMount();
        return;
      }
      this.#toolRef = null;
      const v = value == null ? "" : String(value);
      const cur = this.getAttribute(ATTR_TOOL) ?? "";
      if (v === cur) return;
      if (v === "") this.removeAttribute(ATTR_TOOL);
      else this.setAttribute(ATTR_TOOL, v);
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
      if (this.#toolUnsub) {
        this.#toolUnsub();
        this.#toolUnsub = null;
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

      let toolUrl: string;
      if (this.#toolRef) {
        const val = this.#toolRef.value();
        if (typeof val !== "string" || !val) {
          this.replaceChildren();
          return;
        }
        toolUrl = val;

        let current = toolUrl;
        this.#toolUnsub = this.#toolRef.subscribe((newVal) => {
          const newUrl = typeof newVal === "string" ? newVal : "";
          if (newUrl && newUrl !== current) {
            current = newUrl;
            this.#scheduleMount();
          }
        });
      } else {
        toolUrl = this.toolUrl;
        if (!toolUrl) {
          this.replaceChildren();
          return;
        }
      }

      this.replaceChildren();

      try {
        const ref = await findRef(repo, refUrl);
        if (this.#stale(signal)) return;

        this.#ref = ref;

        console.log("[ref-view] resolving toolUrl:", toolUrl);
        const resolvedToolUrl = await filesystem.resolveToolUrl(toolUrl);
        if (this.#stale(signal)) return;
        console.log("[ref-view] resolved →", resolvedToolUrl);

        const toolParts = toolUrl.split("/");
        const watchPath = toolParts.length > 1 ? toolParts[0] : toolUrl;
        const folderHandle = await filesystem.getDocHandle(watchPath);
        if (this.#stale(signal)) return;

        let lastResolvedUrl = resolvedToolUrl;
        let lastHeads = folderHandle.heads().join("|");
        console.log("[ref-view] watching folder for", toolUrl, "path:", watchPath || "(root)", "heads:", lastHeads);
        const onFolderChange = () => {
          const newHeads = folderHandle.heads().join("|");
          const headsChanged = newHeads !== lastHeads;
          console.log("[ref-view] folder change event for", toolUrl, "headsChanged:", headsChanged, "old:", lastHeads.slice(0, 12), "new:", newHeads.slice(0, 12));
          if (!headsChanged) return;
          lastHeads = newHeads;
          void (async () => {
            try {
              const newUrl = await filesystem.resolveToolUrl(toolUrl);
              if (newUrl !== lastResolvedUrl) {
                console.log("[ref-view] remounting", toolUrl, "URL changed");
                lastResolvedUrl = newUrl;
                this.#scheduleMount();
              } else {
                console.log("[ref-view] skipping remount for", toolUrl, "URL unchanged");
              }
            } catch {
              // ignore resolution errors during change detection
            }
          })();
        };
        folderHandle.on("change", onFolderChange);
        this.#folderCleanup = () => folderHandle.off("change", onFolderChange);

        console.log("[ref-view] importing:", resolvedToolUrl);
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
      } catch (err) {
        if (this.#stale(signal)) return;
        this.#showError(err);
      }
    }
  }

  customElements.define("ref-view", RefViewElement);
}
