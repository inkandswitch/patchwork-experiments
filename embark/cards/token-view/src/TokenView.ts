import type { DocHandle } from "@automerge/automerge-repo";
import {
  getRegistry,
  getSupportedToolsForType,
  type LoadedTool,
  type ToolElement,
  type ToolRender,
} from "@inkandswitch/patchwork-plugins";
import "./token-view.css";

// Render a document's compact inline "token" face into the host element. The
// host is a `<patchwork-view tool-id="token-view">`, so patchwork-view has
// already resolved the handle and stamped `repo` on the element before calling
// us. We decide the face from the registry: if a `patchwork:tool` supports the
// document's datatype AND is tagged `"token"`, that tool paints the face;
// otherwise we paint a default title pill. Because tools register asynchronously
// (their module bundles load over time), a token that finds no tool yet renders
// the fallback and upgrades in place if a matching token tool registers later.
// Returns a teardown that disposes whatever was set up.
export const TokenView: ToolRender = (handle, element) => {
  let disposed = false;
  let cleanup: (() => void) | void;
  let unsubscribe: (() => void) | undefined;

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

  const type = docType(handle.doc());

  const paintWithTool = (tool: LoadedTool) => {
    dispose();
    cleanup = (tool.module as ToolRender)(handle, element as ToolElement);
  };

  void (async () => {
    const tool = type ? await loadTokenTool(type) : undefined;
    if (disposed) return;
    if (tool) {
      paintWithTool(tool);
      return;
    }

    // No token tool yet — paint the default pill, then upgrade in place if a
    // matching token tool registers afterwards (module bundles load async).
    cleanup = paintFallback(element, handle);
    if (!type) return;
    const registry = getRegistry("patchwork:tool");
    unsubscribe = registry.on("registered", () => {
      void (async () => {
        if (disposed) return;
        const upgraded = await loadTokenTool(type);
        if (disposed || !upgraded) return;
        unsubscribe?.();
        unsubscribe = undefined;
        paintWithTool(upgraded);
      })();
    });
  })();

  return () => {
    disposed = true;
    unsubscribe?.();
    dispose();
  };
};

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

// Paint the default face: a title pill. The text is the host's `fallback-label`
// attribute when set (a caller-supplied label, kept static), otherwise a
// best-effort title derived from the document and kept live as it changes.
function paintFallback(
  element: HTMLElement,
  handle: DocHandle<unknown>,
): () => void {
  element.classList.add("token-view");
  const fixedLabel = element.getAttribute("fallback-label");

  const render = () => {
    element.textContent =
      fixedLabel || docTitle(handle.doc()) || shortId(handle.url);
  };
  render();

  if (fixedLabel) {
    return () => {
      element.classList.remove("token-view");
      element.textContent = "";
    };
  }

  handle.on("change", render);
  return () => {
    handle.off("change", render);
    element.classList.remove("token-view");
    element.textContent = "";
  };
}

// The patchwork datatype a document declares (`@patchwork.type`), if any.
function docType(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}

// A best-effort display title for a document: its patchwork title, a card's
// name, its own title, or its content. Empty string becomes undefined so the
// caller can fall back to a short id.
function docTitle(doc: unknown): string | undefined {
  const record = (doc ?? {}) as {
    "@patchwork"?: { title?: unknown };
    title?: unknown;
    name?: unknown;
    content?: unknown;
  };
  const candidates = [
    record["@patchwork"]?.title,
    record.name,
    record.title,
    record.content,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return clip(value.trim());
  }
  return undefined;
}

// A short, human-scannable form of an automerge url (the last few id chars).
function shortId(url: string): string {
  const id = url.replace(/^automerge:/, "");
  return id.length > 6 ? `…${id.slice(-6)}` : id;
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
