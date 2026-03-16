import { findRef } from "@automerge/automerge-repo";
import type { Repo, Ref, RefUrl } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import type { RefToolDescription, LoadedRefTool } from "../canvas/ref-tool.js";

/**
 * <patchwork-ref-view> — custom element that mounts a ref-tool for an automerge ref.
 *
 * Accepts a `ref-url` attribute (automerge:docId/path). Resolves the ref, reads
 * its value, and finds the first registered `patchwork:ref-tool` whose schema
 * matches that value.
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

  get refUrl(): string | null {
    return this.#refUrl;
  }

  set refUrl(value: string | null) {
    if (this.#refUrl === value) return;
    this.#refUrl = value;
    const attr = this.getAttribute("ref-url");
    if (attr === value) return;
    if (value) {
      this.setAttribute("ref-url", value);
    } else {
      this.removeAttribute("ref-url");
    }
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "ref-url") {
      this.refUrl = value;
      this.#mount();
    }
  }

  connectedCallback() {
    this.refUrl = this.getAttribute("ref-url");
    this.#mount();
  }

  disconnectedCallback() {
    this.#teardown();
  }

  async #mount() {
    this.#teardown();
    if (!this.#refUrl || !this.#repo) return;

    const refUrl = this.#refUrl;

    const ref = await findRef(this.#repo, refUrl as RefUrl);
    if (this.#refUrl !== refUrl) return;

    const tool = await this.#findTool(ref, refUrl);
    if (!tool) return;
    if (!tool.module) {
      console.warn("[patchwork-ref-view] tool resolved but has no module", { refUrl });
      return;
    }
    if (this.#refUrl !== refUrl) return;

    this.innerHTML = "";
    const cleanup = (tool.module as (ref: Ref<unknown>, element: HTMLElement) => unknown)(
      ref,
      this,
    );
    if (typeof cleanup === "function") this.#cleanup = cleanup as () => void;
  }

  async #findTool(ref: Ref<unknown>, refUrl: string): Promise<LoadedRefTool | undefined> {
    const value = ref.value() ?? (await waitForValue(ref));
    if (this.#refUrl !== refUrl) return undefined;

    const registry = getRegistry<RefToolDescription>("patchwork:ref-tool");
    const match = registry.all().find((entry) => entry.schema.safeParse(value).success);
    if (!match) {
      console.warn("[patchwork-ref-view] no registered ref-tool matched value", { refUrl, value });
      return undefined;
    }

    return registry.load(match.id) as Promise<LoadedRefTool | undefined>;
  }

  #teardown() {
    this.#cleanup?.();
    this.#cleanup = null;
    this.innerHTML = "";
  }
}

function waitForValue(ref: Ref<unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const unsubscribe = ref.onChange((value) => {
      if (value !== undefined) {
        unsubscribe();
        resolve(value);
      }
    });
  });
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
