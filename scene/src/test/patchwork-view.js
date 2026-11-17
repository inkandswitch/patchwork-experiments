// A stand-in for the host's <patchwork-view doc-url tool-id> (Patchwork's
// embed element), for the tests and local probes that have no Patchwork. It
// mounts the tool `tool-id` names, else the first that supports the doc's
// type, from the plugins it's given (a package's own `plugins`), as
// Patchwork does: tool(handle, element) → cleanup, on repo.find(doc-url). It
// unmounts the tool when it's taken out of the page. A doc none of them
// shows is its title, as text.
//
// It counts what Patchwork's would do (`mounts`), so a test can see a tool
// mounted again where it should have been left alone.

/**
 * @param {{ plugins: object[], repo: () => { find(url: string): Promise<object> } }} options
 * @returns {{ mounts: string[], unmounts: string[] }}  each a `${doc-url}|${tool-id}`, in order
 */
export function defineStandInView({ plugins, repo }) {
  const log = { mounts: [], unmounts: [] };
  const tools = plugins.filter((p) => p.type === "patchwork:tool");
  class StandInView extends HTMLElement {
    #cleanup = null;
    #run = 0;
    get #key() {
      return `${this.getAttribute("doc-url")}|${this.getAttribute("tool-id") ?? ""}`;
    }
    async connectedCallback() {
      const run = ++this.#run;
      log.mounts.push(this.#key);
      const r = repo();
      const handle = await r.find(this.getAttribute("doc-url")).catch(() => null);
      const toolId = this.getAttribute("tool-id");
      const type = handle?.doc()?.["@patchwork"]?.type;
      const tool = tools.find((p) => (toolId ? p.id === toolId : p.supportedDatatypes?.includes(type)));
      const mount = handle && tool ? await tool.load() : null;
      if (run !== this.#run) return;
      if (!mount) {
        this.textContent = handle ? String(handle.doc()?.title ?? handle.doc()?.name ?? "") : "(missing)";
        return;
      }
      this.repo = r;
      this.#cleanup = mount(handle, this) ?? null;
    }
    disconnectedCallback() {
      this.#run++;
      log.unmounts.push(this.#key);
      const cleanup = this.#cleanup;
      this.#cleanup = null;
      if (typeof cleanup === "function") cleanup();
      this.replaceChildren();
    }
  }
  customElements.define("patchwork-view", StandInView);
  return log;
}
