import { findRef } from "./ref";
import type { Ref, Schema } from "./ref";
import type { MiniCanvasFilesystem } from "./filesystem";
import type { Repo } from "@automerge/automerge-repo";

const g = globalThis as typeof globalThis & { repo?: Repo };

const ATTR_TOOL = "tool-url";
const ATTR_REF = "ref-url";

export type RefViewHostElement = HTMLElement & {
  readonly ref: Ref;
  readonly parent: RefViewHostElement | null;
  readonly filesystem: MiniCanvasFilesystem;
};

type MountModule = {
  default: (element: RefViewHostElement) => void | (() => void);
  schema?: Schema<unknown>;
};

/**
 * Defines **`ref-view`** once, with `repo` and optional default `filesystem` closed over.
 */
export function registerRefView(repo: Repo, filesystem: MiniCanvasFilesystem): void {
  if (customElements.get("ref-view")) return;

  class RefViewElement extends HTMLElement implements RefViewHostElement {
    #cleanup: (() => void) | null = null;
    #mountAbort: AbortController | null = null;
    #ref: Ref | null = null;

    get filesystem(): MiniCanvasFilesystem {
      return filesystem;
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

    set toolUrl(value: string | null | undefined) {
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

    async #mount(signal: AbortSignal): Promise<void> {
      this.#teardown();
      const toolUrl = this.toolUrl;
      const refUrl = this.refUrl;
      if (!toolUrl || !refUrl) {
        this.replaceChildren();
        return;
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
        if (signal.aborted) return;
        if (!this.isConnected) return;
        const pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent =
          err instanceof Error ? `ref-view: ${err.message}` : `ref-view: ${String(err)}`;
        this.appendChild(pre);
      }
    }
  }

  customElements.define("ref-view", RefViewElement);
}
