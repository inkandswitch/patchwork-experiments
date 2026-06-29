import type {
  AutomergeUrl,
  DocHandle,
  Repo,
} from "@automerge/automerge-repo";
import {
  getRegistry,
  getSupportedToolsForType,
  type ToolElement,
  type LoadedTool,
} from "@inkandswitch/patchwork-plugins";

// Paints the default face when no registered tool wants to draw the document's
// token (e.g. a title pill). Returns its own teardown.
export type EmbedFallback = (
  host: HTMLElement,
  handle: DocHandle<unknown>,
) => (() => void) | void;

// The repo stamped on the enclosing `<patchwork-view>` that hosts this editor
// or embed subtree. CodeMirror extensions pass `view.dom`; token tools read
// `element.repo` directly because the host is the view element itself.
export function repoFromView(node: Node): Repo | undefined {
  const view =
    node instanceof Element
      ? node.closest("patchwork-view")
      : node.parentElement?.closest("patchwork-view");
  return view ? (view as ToolElement).repo : undefined;
}

// Render a document's inline face into `host`, the single source of truth for
// "how does an embed token look". The token literal carries nothing but the
// document url; the face is decided by the registry: if a `patchwork:tool`
// supports the document's datatype AND is tagged `"token"`, that tool's module
// paints the face (with `repo` stamped on `host` as `ToolElement.repo`, the
// embed contract) so the same custom face shows wherever the doc is embedded.
// Otherwise `fallback` paints a default face. Because tools register
// asynchronously (their module bundles load over time), a token that finds no
// tool yet renders the fallback and upgrades in place if a matching token tool
// registers later. `onError` runs if the doc can't be resolved. Returns a
// teardown that disposes whatever was set up and cancels an in-flight resolve.
export function renderEmbedView(
  host: HTMLElement,
  url: AutomergeUrl,
  view: Node,
  options: { fallback: EmbedFallback; onError?: () => void },
): () => void {
  const repo = repoFromView(view);
  let cleanup: (() => void) | void;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  if (!repo) {
    options.onError?.();
    return () => {};
  }

  const dispose = () => {
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {
        // ignore teardown errors
      }
    }
    cleanup = undefined;
  };

  const paintWithTool = (handle: DocHandle<unknown>, tool: LoadedTool) => {
    dispose();
    host.className = "cm-embed-view";
    (host as unknown as { repo: Repo }).repo = repo;
    cleanup = (tool.module as (h: DocHandle<unknown>, el: ToolElement) => void)(
      handle,
      host as unknown as ToolElement,
    );
  };

  void (async () => {
    try {
      const handle = (await Promise.resolve(
        repo.find(url),
      )) as DocHandle<unknown>;
      if (disposed) return;
      const type = docType(handle.doc());

      const tool = type ? await loadTokenTool(type) : undefined;
      if (disposed) return;
      if (tool) {
        paintWithTool(handle, tool);
        return;
      }

      // No token tool yet — paint the default face, then upgrade in place if a
      // matching token tool registers afterwards (module bundles load async).
      cleanup = options.fallback(host, handle);
      if (!type) return;
      const registry = getRegistry("patchwork:tool");
      unsubscribe = registry.on("registered", () => {
        void (async () => {
          if (disposed) return;
          const upgraded = await loadTokenTool(type);
          if (disposed || !upgraded) return;
          unsubscribe?.();
          unsubscribe = undefined;
          paintWithTool(handle, upgraded);
        })();
      });
    } catch {
      if (!disposed) options.onError?.();
    }
  })();

  return () => {
    disposed = true;
    unsubscribe?.();
    dispose();
  };
}

// Find a registered tool that paints the token for `type` (supports the
// datatype and carries the `"token"` tag) and ensure its module is loaded.
// Returns undefined when none is registered.
async function loadTokenTool(type: string): Promise<LoadedTool | undefined> {
  const candidate = getSupportedToolsForType(type).find((tool) =>
    tool.tags?.includes("token"),
  );
  if (!candidate) return undefined;
  const loaded = await getRegistry("patchwork:tool").load(candidate.id);
  return (loaded as LoadedTool | undefined) ?? undefined;
}

// The patchwork datatype a document declares (`@patchwork.type`), if any.
function docType(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}
