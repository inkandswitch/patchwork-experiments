import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';

export type RegisterPatchworkViewWithToolUrlElementParams = {
  repo: Repo;
  name?: string;
};

export function registerPatchworkViewWithToolUrlElement(
  params: RegisterPatchworkViewWithToolUrlElementParams,
): void {
  const name = params.name ?? 'patchwork-view-with-tool-url';
  const repo = params.repo;

  if (customElements.get(name)) {
    console.error(`can't redefine a custom element. defining "${name}"`);
    return;
  }

  customElements.define(
    name,
    class PatchworkViewWithToolUrlElement extends HTMLElement {
      static observedAttributes = ['doc-url', 'tool-url'];

      repo = repo;
      #docUrl: string | null = null;
      #toolUrl: string | null = null;
      #cleanup: (() => void) | null = null;

      get docUrl(): string | null {
        return this.#docUrl;
      }

      set docUrl(value: string | null) {
        if (this.#docUrl === value) return;
        this.#docUrl = value;
        if (value) {
          this.setAttribute('doc-url', value);
        } else {
          this.removeAttribute('doc-url');
        }
      }

      get toolUrl(): string | null {
        return this.#toolUrl;
      }

      set toolUrl(value: string | null) {
        if (this.#toolUrl === value) return;
        this.#toolUrl = value;
        if (value) {
          this.setAttribute('tool-url', value);
        } else {
          this.removeAttribute('tool-url');
        }
      }

      attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'doc-url') this.#docUrl = value;
        if (name === 'tool-url') this.#toolUrl = value;
        this.#mount();
      }

      connectedCallback() {
        this.#docUrl = this.getAttribute('doc-url');
        this.#toolUrl = this.getAttribute('tool-url');
        this.#mount();
      }

      disconnectedCallback() {
        this.#teardown();
      }

      async #mount() {
        this.#teardown();

        const docUrl = this.#docUrl;
        const toolUrl = this.#toolUrl;
        if (!docUrl || !toolUrl) return;

        const [toolFn, handle] = await Promise.all([
          import(/* @vite-ignore */ toolUrl).then((m) => m.default) as Promise<
            (handle: DocHandle<unknown>, element: HTMLElement) => () => void
          >,
          repo.find(docUrl as AutomergeUrl),
        ]);

        if (this.#docUrl !== docUrl || this.#toolUrl !== toolUrl) return;

        this.innerHTML = '';
        const cleanup = toolFn(handle, this);
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
