import type { Repo } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";

// A `patchwork:component` is a handle-less view: unlike a tool it has no backing
// document, so its render contract takes only the host element (with `repo`
// stamped on, the ToolElement contract) and returns an optional teardown. Any
// state it needs lives in the shared canvas context it's mounted inside, reached
// through DOM discovery from the host element.
export type ComponentRender = (element: ToolElement) => (() => void) | void;

type ComponentModule = { default: ComponentRender };

// Import a component module by url and run it into `host`, the single place that
// turns a `componentUrl` embed into live UI. `host` gets `repo` stamped on so
// the component can reach the repo and the context it sits inside. The url is a
// stable, head-less module url (e.g. `/automerge%3A<docId>/component.js`): the
// service worker redirects it to the latest heads on every load, so a component
// embed always runs the newest published version. Returns a teardown that
// disposes the component and cancels an in-flight import.
export function renderComponentEmbed(
  host: HTMLElement,
  componentUrl: string,
  repo: Repo | undefined,
  options?: { onError?: () => void },
): () => void {
  let cleanup: (() => void) | void;
  let disposed = false;

  if (!repo) {
    options?.onError?.();
    return () => {};
  }

  (host as unknown as { repo: Repo }).repo = repo;

  void (async () => {
    try {
      const mod = (await import(/* @vite-ignore */ componentUrl)) as ComponentModule;
      if (disposed) return;
      cleanup =
        typeof mod.default === "function"
          ? mod.default(host as unknown as ToolElement)
          : undefined;
    } catch {
      if (!disposed) options?.onError?.();
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
