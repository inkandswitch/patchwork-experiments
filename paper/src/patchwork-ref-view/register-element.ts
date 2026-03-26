import { findRef } from '@automerge/automerge-repo';
import type { Ref, RefUrl } from '@automerge/automerge-repo';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import type {
  LoadedRefTool,
  RefToolDescription,
  RegisterPatchworkRefViewElementParams,
} from './types.js';

export function registerPatchworkRefViewElement(
  params: RegisterPatchworkRefViewElementParams,
): void {
  const name = params.name ?? 'patchwork-ref-view';
  const repo = params.repo;

  if (customElements.get(name)) {
    console.error(`can't redefine a custom element. defining "${name}"`);
    return;
  }

  customElements.define(
    name,
    class PatchworkRefViewElement extends HTMLElement {
      static observedAttributes = ['ref-url'];

      #refUrl: string | null = null;
      #cleanup: (() => void) | null = null;

      get refUrl(): string | null {
        return this.#refUrl;
      }

      set refUrl(value: string | null) {
        if (this.#refUrl === value) return;
        this.#refUrl = value;
        const attr = this.getAttribute('ref-url');
        if (attr === value) return;
        if (value) {
          this.setAttribute('ref-url', value);
        } else {
          this.removeAttribute('ref-url');
        }
      }

      attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'ref-url') {
          this.refUrl = value;
          this.#mount();
        }
      }

      connectedCallback() {
        this.refUrl = this.getAttribute('ref-url');
        this.#mount();
      }

      disconnectedCallback() {
        this.#teardown();
      }

      async #mount() {
        this.#teardown();
        if (!this.#refUrl) return;

        const refUrl = this.#refUrl;

        const ref = await findRef(repo, refUrl as RefUrl);
        if (this.#refUrl !== refUrl) return;

        const value = ref.value() ?? (await waitForValue(ref));
        if (this.#refUrl !== refUrl) return;

        const registry = getRegistry<RefToolDescription>('patchwork:ref-tool');
        const match = registry.all().find((entry) => {
          const desc = entry as RefToolDescription;
          return desc.schema?.safeParse(value).success;
        });

        if (!match) {
          console.warn('[patchwork-ref-view] no registered ref-tool matched value', {
            refUrl,
            value,
          });
          return;
        }

        const tool = (await registry.load(match.id)) as LoadedRefTool | undefined;
        if (!tool?.module) {
          console.warn('[patchwork-ref-view] tool resolved but has no module', { refUrl });
          return;
        }

        if (this.#refUrl !== refUrl) return;

        this.innerHTML = '';
        const cleanup = tool.module(ref, this);
        if (typeof cleanup === 'function') this.#cleanup = cleanup;
      }

      #teardown() {
        this.#cleanup?.();
        this.#cleanup = null;
        this.innerHTML = '';
      }
    },
  );
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
