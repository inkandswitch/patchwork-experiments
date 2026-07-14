import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import {
  getFallbackTool,
  getRegistry,
} from "@inkandswitch/patchwork-plugins";

// The document inspect mints and renders: it carries nothing but the package
// that paints the inspected embed and, for a tool (not a component), the
// document that embed shows. Inspect points a `<patchwork-view>` at each.
// With no target set (the sidebar's standing inspector before a pick) both
// urls are absent and the tool shows the whole shared context instead.
//
// `inspectedDocUrl` mirrors `documentUrl` (kept in sync by the inspect tool)
// so the inspect doc duck-types as a context-viewer doc: the Context tab pins
// the `context-viewer` tool directly at this document, and that tool reads its
// focus from `inspectedDocUrl`.
export type InspectDoc = {
  "@patchwork": { type: "inspect" };
  packageUrl?: AutomergeUrl;
  documentUrl?: AutomergeUrl;
  inspectedDocUrl?: AutomergeUrl;
};

// What `resolveInspectTarget` recovers from the embed being inspected. The
// package is absent when the view's tool isn't inspectable (an HTTP-bundle
// tool has no folder doc) — the document alone still gives the Doc and
// Context tabs something to show.
export type InspectTarget = {
  packageUrl?: AutomergeUrl;
  documentUrl?: AutomergeUrl;
};

// A package root inspect can render comes in two shapes, both discriminated by
// `@patchwork.type`: a patchwork-folder doc ("folder", with a `docs` list) or a
// pushwork vfs "directory" doc (path -> url map). Used to decide whether an
// opened link points at something the inspector can show as a package.
export function isFolderDoc(doc: unknown): boolean {
  const type = (doc as { "@patchwork"?: { type?: string } } | undefined)?.[
    "@patchwork"
  ]?.type;
  return type === "folder" || type === "directory";
}

// Find the closest rendered `<patchwork-view>` under `root` and resolve the
// package that paints it, plus the document it shows. The package is always an
// `automerge:` folder doc (a pushwork `rootUrl`): normally the registered
// tool's `importUrl`, but for a card (rendered by the shared card tool) it is
// the card's own behavior-module package, parsed out of `doc.src`. Returns null
// when nothing renderable is found (e.g. a tool whose package is an HTTP bundle).
export async function resolveInspectTarget(
  root: HTMLElement,
  repo: Repo,
): Promise<InspectTarget | null> {
  const view = root.querySelector("patchwork-view");
  return view ? resolveFromView(view, repo) : null;
}

// A tool embed: the package is the plugin's `importUrl`, the document is the
// view's `doc-url`. The tool id is read from the element when pinned, otherwise
// recovered the way the view itself resolves its fallback (see `fallbackToolId`).
// Exported for the inspect tool's target picker, which resolves the view under
// the shared pointer directly.
export async function resolveFromView(
  view: Element,
  repo: Repo,
): Promise<InspectTarget | null> {
  const rawDocUrl = view.getAttribute("doc-url");
  const documentUrl =
    rawDocUrl && isValidAutomergeUrl(rawDocUrl) ? rawDocUrl : undefined;

  // Every card renders through the one shared card tool, so its `importUrl`
  // would always name @embark/card. The package worth inspecting is the card's
  // own feature package — recover it from the card document's `src` module url.
  if (documentUrl) {
    const cardPackage = await cardPackageFromDoc(repo, documentUrl);
    if (cardPackage) return { packageUrl: cardPackage, documentUrl };
  }

  const toolId =
    view.getAttribute("tool-id") ??
    (documentUrl ? await fallbackToolId(repo, documentUrl) : undefined);
  if (!toolId) return docOnly(documentUrl);

  const importUrl = getRegistry("patchwork:tool").get(toolId)?.importUrl;
  // Only `automerge:` packages (pushwork folder docs) can be inspected; a tool
  // served from an HTTP bundle (e.g. the wildcard "raw" tool) has no folder doc
  // to render — fall back to the document alone (Doc + Context tabs).
  if (!importUrl || !isValidAutomergeUrl(importUrl)) {
    if (importUrl) {
      console.warn(
        `[inspect] tool "${toolId}" is served from a non-automerge bundle (${importUrl}); cannot inspect its package`,
      );
    }
    return docOnly(documentUrl);
  }

  return documentUrl
    ? { packageUrl: importUrl, documentUrl }
    : { packageUrl: importUrl };
}

// A target with no inspectable package: just the document, or nothing at all.
function docOnly(documentUrl: AutomergeUrl | undefined): InspectTarget | null {
  return documentUrl ? { documentUrl } : null;
}

// The tool a view falls back to for a document with no pinned tool-id. Mirrors
// exactly how `<patchwork-view>` chooses its default (`getFallbackTool`), which
// sorts specific-datatype tools ahead of wildcard (`*`) ones — a plain "first
// supported tool" pick would wrongly land on a wildcard tool (e.g. "raw") for a
// typed document like a map, naming the wrong package.
async function fallbackToolId(
  repo: Repo,
  documentUrl: AutomergeUrl,
): Promise<string | undefined> {
  try {
    const handle = await repo.find(documentUrl);
    return getFallbackTool(
      handle.doc() as Parameters<typeof getFallbackTool>[0],
    )?.id;
  } catch {
    return undefined;
  }
}

// The feature package of a card, read from its document's `src` module url, or
// undefined when the document isn't a card. A card's `src` is
// `/automerge%3A<rootUrl>/dist/card.js` (the worker-served module path), so the
// first path segment decodes to the package's folder doc; normalize to the
// stable, head-less url.
async function cardPackageFromDoc(
  repo: Repo,
  documentUrl: AutomergeUrl,
): Promise<AutomergeUrl | undefined> {
  try {
    const handle = await repo.find(documentUrl);
    const doc = handle.doc() as {
      "@patchwork"?: { type?: string };
      src?: unknown;
    };
    if (doc?.["@patchwork"]?.type !== "card") return undefined;
    if (typeof doc.src !== "string" || !doc.src) return undefined;
    const segment = doc.src.replace(/^\//, "").split("/")[0];
    const decoded = decodeURIComponent(segment);
    if (!isValidAutomergeUrl(decoded)) return undefined;
    return stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(decoded).documentId,
    });
  } catch {
    return undefined;
  }
}
