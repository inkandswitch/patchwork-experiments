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

        const mod = (await import(/* @vite-ignore */ toolUrl)) as MountModule;
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
