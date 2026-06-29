import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";

// The shape a render module must default-export. It receives a ToolElement-like
// host (with `repo` stamped on) and the card handle, and may return a teardown.
type ViewModule = {
  default: (
    element: ToolElement,
    handle: DocHandle<unknown>,
  ) => (() => void) | void;
};

// Paints the default face when the document has no `viewUrl` of its own (e.g. a
// title pill). Returns its own teardown.
export type EmbedFallback = (
  host: HTMLElement,
  handle: DocHandle<unknown>,
) => (() => void) | void;

// Render a document's inline face into `host`, the single source of truth for
// "how does an embed token look". If the resolved doc carries a string
// `viewUrl`, that render module is imported and run against `host` (with `repo`
// stamped on as `ToolElement.repo`, the embed contract) so the same face shows
// wherever the doc is embedded — a token, a command-menu preview, anywhere.
// Otherwise `fallback` paints a default face. `onError` runs if the doc or its
// module can't be resolved. Returns a teardown that disposes whatever was set up
// and cancels an in-flight resolve.
export function renderEmbedView(
  host: HTMLElement,
  url: AutomergeUrl,
  repo: Repo | undefined,
  options: { fallback: EmbedFallback; onError?: () => void },
): () => void {
  let cleanup: (() => void) | void;
  let disposed = false;

  if (!repo) {
    options.onError?.();
    return () => {};
  }

  void (async () => {
    try {
      const handle = (await Promise.resolve(
        repo.find(url),
      )) as DocHandle<unknown>;
      if (disposed) return;
      const viewUrl = (handle.doc() as { viewUrl?: unknown } | undefined)
        ?.viewUrl;
      if (typeof viewUrl === "string" && viewUrl) {
        host.className = "cm-embed-view";
        (host as unknown as { repo: Repo }).repo = repo;
        const mod = (await import(/* @vite-ignore */ viewUrl)) as ViewModule;
        if (disposed) return;
        cleanup =
          typeof mod.default === "function"
            ? mod.default(host as unknown as ToolElement, handle)
            : options.fallback(host, handle);
      } else {
        cleanup = options.fallback(host, handle);
      }
    } catch {
      if (!disposed) options.onError?.();
    }
  })();

  return () => {
    disposed = true;
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {
        // ignore teardown errors
      }
    }
  };
}
